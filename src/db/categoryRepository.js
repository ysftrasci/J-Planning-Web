import { getDb } from './database';
import { triggerAutoCloudSyncForCurrentUser } from '../services/cloudSyncService';

function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Modül seviyesinde tek-uçuş (single-flight) ve operasyon kuyruğu değişkenleri
let inFlightEnsurePromise = null;
const inFlightFindOrCreateMap = new Map();
let categoryOpQueue = Promise.resolve();

function serializeCategoryOp(operation) {
  const next = categoryOpQueue.then(
    () => operation(),
    () => operation()
  );
  categoryOpQueue = next.catch(() => {});
  return next;
}

async function executeBatchStatements(db, statements) {
  if (!statements || statements.length === 0) return;
  if (typeof db.batchAsync === 'function') {
    await db.batchAsync(statements);
    return;
  }
  // batchAsync olmayan motorlar için yedekleme (fallback)
  await db.runAsync('BEGIN TRANSACTION');
  try {
    for (const stmt of statements) {
      if (typeof stmt === 'string') {
        await db.runAsync(stmt);
      } else {
        await db.runAsync(stmt.sql, stmt.args || []);
      }
    }
    await db.runAsync('COMMIT');
  } catch (err) {
    try {
      await db.runAsync('ROLLBACK');
    } catch {}
    throw err;
  }
}

export async function createCategory(name, color) {
  const cleanName = (name || '').trim();
  if (!cleanName) {
    throw new Error('Lütfen kategori adı gir.');
  }

  return serializeCategoryOp(async () => {
    const db = getDb();
    const existing = (await db.getAllAsync('SELECT * FROM categories')) || [];
    const targetKey = cleanName.toLocaleLowerCase('tr-TR');
    const duplicate = existing.find(
      (c) => (c.name || '').trim().toLocaleLowerCase('tr-TR') === targetKey
    );
    if (duplicate) {
      throw new Error('Bu isimde bir kategori zaten var.');
    }

    const id = generateId();
    await db.runAsync('INSERT INTO categories (id, name, color, createdAt) VALUES (?, ?, ?, ?)', [
      id,
      cleanName,
      color ?? '#C98A2C',
      Date.now(),
    ]);
    triggerAutoCloudSyncForCurrentUser();
    return id;
  });
}

export async function getCategories() {
  const db = getDb();
  return db.getAllAsync('SELECT * FROM categories ORDER BY createdAt ASC');
}

/**
 * İsimle kategori arar (büyük/küçük harf duyarsız, baştaki/sondaki boşluk kırpılmış).
 * Varsa mevcut kategorinin ID'sini döner; yoksa varsayılan renkle (#C98A2C) yeni kategori oluşturur.
 * Eşzamanlı çağrılar tek-uçuş (single-flight) promise'i paylaşır.
 */
export async function findOrCreateCategoryByName(categoryName) {
  if (!categoryName || typeof categoryName !== 'string') return null;
  const cleanName = categoryName.trim();
  if (!cleanName) return null;

  const lowerClean = cleanName.toLocaleLowerCase('tr-TR');
  if (inFlightFindOrCreateMap.has(lowerClean)) {
    return inFlightFindOrCreateMap.get(lowerClean);
  }

  const promise = (async () => {
    if (inFlightEnsurePromise) {
      try {
        await inFlightEnsurePromise;
      } catch {}
    }

    return serializeCategoryOp(async () => {
      let db;
      try {
        db = getDb();
      } catch {
        return null;
      }
      if (!db) return null;

      const allCategories = (await db.getAllAsync('SELECT * FROM categories')) || [];
      const match = allCategories.find(
        (c) => (c.name || '').trim().toLocaleLowerCase('tr-TR') === lowerClean
      );
      if (match) return match.id;

      const id = generateId();
      await db.runAsync('INSERT INTO categories (id, name, color, createdAt) VALUES (?, ?, ?, ?)', [
        id,
        cleanName,
        '#C98A2C',
        Date.now(),
      ]);
      triggerAutoCloudSyncForCurrentUser();
      return id;
    });
  })().finally(() => {
    inFlightFindOrCreateMap.delete(lowerClean);
  });

  inFlightFindOrCreateMap.set(lowerClean, promise);
  return promise;
}

export async function deleteCategory(id) {
  return serializeCategoryOp(async () => {
    const db = getDb();
    const statements = [
      { sql: 'UPDATE tasks SET categoryId = NULL WHERE categoryId = ?', args: [id] },
      { sql: 'DELETE FROM categories WHERE id = ?', args: [id] },
    ];
    await executeBatchStatements(db, statements);
    triggerAutoCloudSyncForCurrentUser();
  });
}

/**
 * Varsayılan kategorileri kontrol eder, mükerrer (duplicate) olanları temizler,
 * görev referanslarını korunan kategoriye taşır ve eksik varsayılanları ekler.
 * Kategori sayısından bağımsız olarak HER çağrıda mükerrer temizliği yapılır.
 * Eşzamanlı çağrılar tek-uçuş (single-flight) promise'i paylaşır.
 */
export async function ensureDefaultCategories() {
  if (inFlightEnsurePromise) {
    return inFlightEnsurePromise;
  }

  inFlightEnsurePromise = (async () => {
    return serializeCategoryOp(async () => {
      let db;
      try {
        db = getDb();
      } catch {
        return;
      }
      if (!db) return;

      let hasChanges = false;

      // 1. Mükerrer (duplicate) isimdeki kategorileri temizle, task referanslarını en eskiye taşı
      const existing = (await db.getAllAsync('SELECT * FROM categories')) || [];

      // En eski olanı korumak için createdAt ASC (ve tutarlılık için id ASC) sırala
      existing.sort((a, b) => {
        const timeDiff = (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0);
        if (timeDiff !== 0) return timeDiff;
        return String(a.id || '').localeCompare(String(b.id || ''));
      });

      // İsme göre grupla: trim + toLocaleLowerCase('tr-TR')
      const groups = new Map();
      for (const cat of existing) {
        const key = (cat.name || '').trim().toLocaleLowerCase('tr-TR');
        if (!key) continue;
        if (!groups.has(key)) {
          groups.set(key, []);
        }
        groups.get(key).push(cat);
      }

      const dedupeStatements = [];
      const canonicalCategories = [];

      for (const [, group] of groups.entries()) {
        const canonical = group[0];
        canonicalCategories.push(canonical);

        if (group.length > 1) {
          hasChanges = true;
          for (let i = 1; i < group.length; i++) {
            const duplicate = group[i];
            dedupeStatements.push({
              sql: 'UPDATE tasks SET categoryId = ? WHERE categoryId = ?',
              args: [canonical.id, duplicate.id],
            });
            dedupeStatements.push({
              sql: 'DELETE FROM categories WHERE id = ?',
              args: [duplicate.id],
            });
          }
        }
      }

      if (dedupeStatements.length > 0) {
        await executeBatchStatements(db, dedupeStatements);
      }

      // 2. Eksik varsayılan kategorileri ekle (batchAsync ile)
      const existingKeySet = new Set(
        canonicalCategories.map((c) => (c.name || '').trim().toLocaleLowerCase('tr-TR'))
      );

      const defaults = [
        { name: 'Kişisel', color: '#C98A2C' },
        { name: 'İş', color: '#5B8A6B' },
        { name: 'Sağlık', color: '#C4512E' },
        { name: 'YKS', color: '#8B5CF6' },
      ];

      const missingDefaults = defaults.filter(
        (d) => !existingKeySet.has(d.name.trim().toLocaleLowerCase('tr-TR'))
      );

      if (missingDefaults.length > 0) {
        hasChanges = true;
        const now = Date.now();
        const insertStatements = missingDefaults.map((d, index) => ({
          sql: 'INSERT INTO categories (id, name, color, createdAt) VALUES (?, ?, ?, ?)',
          args: [generateId(), d.name.trim(), d.color, now + index],
        }));
        await executeBatchStatements(db, insertStatements);
      }

      if (hasChanges) {
        triggerAutoCloudSyncForCurrentUser();
      }
    });
  })().finally(() => {
    inFlightEnsurePromise = null;
  });

  return inFlightEnsurePromise;
}
