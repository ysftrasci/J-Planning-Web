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

export async function createCategory(name, color) {
  const db = getDb();
  const id = generateId();
  await db.runAsync('INSERT INTO categories (id, name, color, createdAt) VALUES (?, ?, ?, ?)', [
    id,
    name.trim(),
    color ?? '#C98A2C',
    Date.now(),
  ]);
  triggerAutoCloudSyncForCurrentUser();
  return id;
}

export async function getCategories() {
  const db = getDb();
  return db.getAllAsync('SELECT * FROM categories ORDER BY createdAt ASC');
}

export async function deleteCategory(id) {
  const db = getDb();
  await db.runAsync('UPDATE tasks SET categoryId = NULL WHERE categoryId = ?', [id]);
  await db.runAsync('DELETE FROM categories WHERE id = ?', [id]);
  triggerAutoCloudSyncForCurrentUser();
}

/**
 * Varsayılan kategorileri kontrol eder, mükerrer (duplicate) olanları temizler
 * ve görev referanslarını korur.
 */
export async function ensureDefaultCategories() {
  const db = getDb();
  const existing = await getCategories();

  if (existing && existing.length >= 4) {
    return;
  }

  // 1. Mükerrer (duplicate) isimdeki kategorileri temizle, task'ları ana ID'ye bağla
  const seenNames = new Map();
  const duplicatesToDelete = [];

  for (const cat of existing) {
    const lowerName = (cat.name || '').trim().toLowerCase();
    if (!lowerName) continue;

    if (seenNames.has(lowerName)) {
      const canonicalId = seenNames.get(lowerName);
      await db.runAsync('UPDATE tasks SET categoryId = ? WHERE categoryId = ?', [canonicalId, cat.id]);
      duplicatesToDelete.push(cat.id);
    } else {
      seenNames.set(lowerName, cat.id);
    }
  }

  for (const dupId of duplicatesToDelete) {
    await db.runAsync('DELETE FROM categories WHERE id = ?', [dupId]);
  }

  // 2. Eksik olan varsayılan kategorileri sadece yoksa ekle
  const currentCategories = await getCategories();
  const currentNameSet = new Set(currentCategories.map((c) => (c.name || '').trim().toLowerCase()));

  const defaults = [
    { name: 'Kişisel', color: '#C98A2C' },
    { name: 'İş', color: '#5B8A6B' },
    { name: 'Sağlık', color: '#C4512E' },
    { name: 'YKS', color: '#8B5CF6' },
  ];

  for (const c of defaults) {
    if (!currentNameSet.has(c.name.toLowerCase())) {
      await createCategory(c.name, c.color);
    }
  }
}
