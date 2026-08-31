// J-Planning — Veri Migrasyon Servisi (Faz 5)
//
// Kullanıcının tarayıcısındaki yerel IndexedDB (jplanning-sqlite-store) veya
// Firestore bulut yedeğindeki (users/{uid}/user_backup/latest) geçmiş verilerini
// Turso veritabanına taşır, ID-bazlı matematiksel doğrulama yapar ve tek seferlik bayrağı koyar.

import initSqlJs from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { openDB } from 'idb';
import { doc, getDoc } from 'firebase/firestore';
import { db as firestoreDb } from '../services/firebase';

const IDB_NAME = 'jplanning-sqlite-store';
const IDB_VERSION = 1;
const IDB_STORE = 'databases';

const TARGET_TABLES = [
  'categories',
  'tasks',
  'task_records',
  'wallet',
  'wallet_transactions',
  'rewards',
  'friends',
  'focus_sessions',
  'daily_notes',
  'task_study_logs',
];

const TABLE_PRIMARY_KEYS = {
  categories: 'id',
  tasks: 'id',
  task_records: 'id',
  wallet: 'userId',
  wallet_transactions: 'id',
  rewards: 'id',
  friends: 'id',
  focus_sessions: 'id',
  daily_notes: 'id',
  task_study_logs: 'id',
};

let sqlJsModule = null;

async function getSqlJs() {
  if (!sqlJsModule) {
    sqlJsModule = await initSqlJs({ locateFile: () => sqlWasmUrl });
  }
  return sqlJsModule;
}

/**
 * 1. Kaynak: IndexedDB'den (jplanning-sqlite-store) binary SQLite byte'larını okur.
 * Tarihsel anahtar formatları:
 * - jplanning_{safeUid}.db
 * - jplanning_{safeUid}
 * - jplanning_{uid}.db
 * - jplanning_{uid}
 */
async function readFromIndexedDb(uid) {
  try {
    const idb = await openDB(IDB_NAME, IDB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(IDB_STORE)) {
          database.createObjectStore(IDB_STORE);
        }
      },
    });

    const allKeys = await idb.getAllKeys(IDB_STORE);
    if (!allKeys || allKeys.length === 0) {
      console.log('[Migration] IndexedDB deposunda hiç anahtar bulunamadı.');
      return null;
    }

    const safeUid = String(uid).replace(/[^a-zA-Z0-9_-]/g, '');

    // Aday anahtarları öncelik sırasına göre diz
    const candidateKeys = [];

    for (const k of allKeys) {
      const keyStr = String(k);
      if (
        keyStr === `jplanning_${safeUid}.db` ||
        keyStr === `jplanning_${safeUid}` ||
        keyStr === `jplanning_${uid}.db` ||
        keyStr === `jplanning_${uid}` ||
        keyStr === `jplanning-user-${uid}` ||
        keyStr === uid
      ) {
        candidateKeys.unshift(k); // En yüksek öncelik
      } else if (keyStr.includes(safeUid) || keyStr.includes(uid)) {
        candidateKeys.push(k);
      }
    }

    // Eğer UID ile eşleşen bir anahtar bulunamadıysa yabancı veritabanı okuma riskini önlemek için sonlandır
    if (candidateKeys.length === 0) {
      console.log(`[Migration] IndexedDB deposunda '${uid}' için eşleşen anahtar bulunamadı.`);
      return null;
    }

    const SQL = await getSqlJs();

    // Aday anahtarları tek tek dene; en çok veri içeren veritabanını seç
    let bestResult = null;
    let maxFoundRows = 0;

    for (const key of candidateKeys) {
      try {
        const bytes = await idb.get(IDB_STORE, key);
        if (!bytes || !(bytes instanceof Uint8Array) || bytes.length === 0) {
          continue;
        }

        const legacyDb = new SQL.Database(bytes);
        const tables = {};
        let totalFoundRows = 0;

        for (const tableName of TARGET_TABLES) {
          const tableCheckStmt = legacyDb.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
          );
          tableCheckStmt.bind([tableName]);
          const tableExists = tableCheckStmt.step();
          tableCheckStmt.free();

          if (!tableExists) {
            tables[tableName] = [];
            continue;
          }

          const stmt = legacyDb.prepare(`SELECT * FROM ${tableName}`);
          const rows = [];
          while (stmt.step()) {
            rows.push(stmt.getAsObject());
          }
          stmt.free();

          tables[tableName] = rows;
          totalFoundRows += rows.length;
        }

        legacyDb.close();

        if (totalFoundRows > maxFoundRows) {
          maxFoundRows = totalFoundRows;
          bestResult = {
            source: 'IndexedDB (Yerel Tarayıcı Deposu)',
            sourceDetails: `Anahtar: ${key} (${bytes.length} bytes, Toplam ${totalFoundRows} satır)`,
            tables,
          };
        }
      } catch (e) {
        console.warn(`[Migration] Anahtar ${key} okunurken hata:`, e);
      }
    }

    return bestResult;
  } catch (err) {
    console.warn('[Migration] IndexedDB okuma uyarısı:', err);
    return null;
  }
}

/**
 * 2. Kaynak: Firestore'daki user_backup/latest dokümanından verileri okur.
 */
async function readFromFirestoreBackup(uid) {
  try {
    const docRef = doc(firestoreDb, 'users', uid, 'user_backup', 'latest');
    const snap = await getDoc(docRef);
    if (!snap.exists()) return null;

    const data = snap.data();
    if (!data.tablesJson) return null;

    const tables = JSON.parse(data.tablesJson);
    let totalRows = 0;
    for (const key of TARGET_TABLES) {
      if (Array.isArray(tables[key])) {
        totalRows += tables[key].length;
      } else {
        tables[key] = [];
      }
    }

    if (totalRows === 0) return null;

    const timestampMs = data.updatedAtMs || (data.updatedAt?.toMillis ? data.updatedAt.toMillis() : Date.now());
    const dateFormatted = new Date(timestampMs).toLocaleString('tr-TR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    return {
      source: 'Firestore Bulut Yedeği',
      sourceDetails: `Yedek Zaman Damgası: ${dateFormatted}`,
      tables,
    };
  } catch (err) {
    console.warn('[Migration] Firestore yedek okuma uyarısı:', err);
    return null;
  }
}

/**
 * Verileri Turso'ya yazar ve her satırın ID'sini tek tek Turso'da doğrulayarak %100 matematiksel kanıt sunar.
 */
async function transferTablesToTurso(tables, tursoDb) {
  const auditResults = {};

  // 1. categories
  if (Array.isArray(tables.categories)) {
    for (const row of tables.categories) {
      if (!row.id || !row.name) continue;
      await tursoDb.runAsync(
        'INSERT OR REPLACE INTO categories (id, name, color, createdAt) VALUES (?, ?, ?, ?)',
        [row.id, row.name, row.color || '#C98A2C', row.createdAt || Date.now()]
      );
    }
  }

  // 2. tasks
  if (Array.isArray(tables.tasks)) {
    for (const row of tables.tasks) {
      if (!row.id || !row.title) continue;
      await tursoDb.runAsync(
        `INSERT OR REPLACE INTO tasks (id, title, description, notes, categoryId, priority, period, ownerUserId, assignedByUserId, assignedByName, assignedToUserId, assignedToName, assignmentDirection, firestoreAssignmentId, assignmentStatus, subtaskCount, subtaskLabels, isArchived, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id,
          row.title,
          row.description ?? null,
          row.notes ?? null,
          row.categoryId ?? null,
          row.priority || 'MEDIUM',
          row.period || 'DAILY',
          row.ownerUserId || 'me',
          row.assignedByUserId ?? null,
          row.assignedByName ?? null,
          row.assignedToUserId ?? null,
          row.assignedToName ?? null,
          row.assignmentDirection ?? null,
          row.firestoreAssignmentId ?? null,
          row.assignmentStatus || 'NONE',
          row.subtaskCount || 1,
          row.subtaskLabels ?? null,
          row.isArchived ? 1 : 0,
          row.createdAt || Date.now(),
        ]
      );
    }
  }

  // 3. task_records
  if (Array.isArray(tables.task_records)) {
    for (const row of tables.task_records) {
      if (!row.id || !row.taskId || !row.periodKey) continue;
      await tursoDb.runAsync(
        `INSERT OR REPLACE INTO task_records (id, taskId, periodKey, status, completedSubtasks, completedAt, isLateMarked, lateMarkedAt, jpEarned, streakBonusEarned)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id,
          row.taskId,
          row.periodKey,
          row.status || 'FAILED',
          row.completedSubtasks || 0,
          row.completedAt ?? null,
          row.isLateMarked ? 1 : 0,
          row.lateMarkedAt ?? null,
          row.jpEarned || 0,
          row.streakBonusEarned || 0,
        ]
      );
    }
  }

  // 4. wallet
  if (Array.isArray(tables.wallet)) {
    for (const row of tables.wallet) {
      await tursoDb.runAsync(
        `INSERT INTO wallet (userId, balance) VALUES (?, ?)
         ON CONFLICT(userId) DO UPDATE SET balance = excluded.balance`,
        [row.userId || 'me', row.balance || 0]
      );
    }
  }

  // 5. wallet_transactions
  if (Array.isArray(tables.wallet_transactions)) {
    for (const row of tables.wallet_transactions) {
      if (!row.id) continue;
      await tursoDb.runAsync(
        `INSERT OR REPLACE INTO wallet_transactions (id, userId, amount, reason, relatedTaskId, relatedRewardId, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id,
          row.userId || 'me',
          row.amount || 0,
          row.reason || 'TRANSACTION',
          row.relatedTaskId ?? null,
          row.relatedRewardId ?? null,
          row.createdAt || Date.now(),
        ]
      );
    }
  }

  // 6. rewards
  if (Array.isArray(tables.rewards)) {
    for (const row of tables.rewards) {
      if (!row.id || !row.title) continue;
      await tursoDb.runAsync(
        `INSERT OR REPLACE INTO rewards (id, title, description, cost, ownerUserId, assignedByUserId, assignedByName, assignmentStatus, isRedeemed, redeemedAt, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id,
          row.title,
          row.description ?? null,
          row.cost || 0,
          row.ownerUserId || 'me',
          row.assignedByUserId ?? null,
          row.assignedByName ?? null,
          row.assignmentStatus || 'NONE',
          row.isRedeemed ? 1 : 0,
          row.redeemedAt ?? null,
          row.createdAt || Date.now(),
        ]
      );
    }
  }

  // 7. friends (schema.sql ile %100 uyumlu sütunlar)
  if (Array.isArray(tables.friends)) {
    for (const row of tables.friends) {
      if (!row.id) continue;
      const friendUserId = row.friendUserId || row.friendUid || '';
      const friendDisplayName = row.friendDisplayName || row.friendName || 'Arkadaş';
      const friendCode = row.friendCode || row.friendUserCode || '';
      const status = row.status || 'ACCEPTED';
      const createdAt = row.createdAt || Date.now();

      if (!friendUserId) continue;

      await tursoDb.runAsync(
        `INSERT OR REPLACE INTO friends (id, friendUserId, friendDisplayName, friendCode, status, createdAt)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          row.id,
          friendUserId,
          friendDisplayName,
          friendCode,
          status,
          createdAt,
        ]
      );
    }
  }

  // 8. focus_sessions
  if (Array.isArray(tables.focus_sessions)) {
    for (const row of tables.focus_sessions) {
      if (!row.id) continue;
      await tursoDb.runAsync(
        `INSERT OR REPLACE INTO focus_sessions (id, durationMinutes, soundKey, jpEarned, monthKey, completedAt)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          row.id,
          row.durationMinutes || 1,
          row.soundKey ?? null,
          row.jpEarned || 0,
          row.monthKey || '2026-08',
          row.completedAt || Date.now(),
        ]
      );
    }
  }

  // 9. daily_notes
  if (Array.isArray(tables.daily_notes)) {
    for (const row of tables.daily_notes) {
      if (!row.id || !row.dateKey) continue;
      await tursoDb.runAsync(
        `INSERT OR REPLACE INTO daily_notes (id, dateKey, content, studyTimeText, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          row.id,
          row.dateKey,
          row.content || '',
          row.studyTimeText ?? null,
          row.createdAt || Date.now(),
          row.updatedAt || Date.now(),
        ]
      );
    }
  }

  // 10. task_study_logs
  if (Array.isArray(tables.task_study_logs)) {
    for (const row of tables.task_study_logs) {
      if (!row.id || !row.taskId || !row.periodKey) continue;
      await tursoDb.runAsync(
        `INSERT OR REPLACE INTO task_study_logs (id, taskId, periodKey, studyTimeText, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          row.id,
          row.taskId,
          row.periodKey,
          row.studyTimeText ?? null,
          row.createdAt || Date.now(),
          row.updatedAt || Date.now(),
        ]
      );
    }
  }

  // %100 KESİN DOĞRULAMA (ID-Bazlı Varlık ve Satır Denetimi)
  let allMatched = true;
  for (const tableName of TARGET_TABLES) {
    const sourceRows = Array.isArray(tables[tableName]) ? tables[tableName] : [];
    const pk = TABLE_PRIMARY_KEYS[tableName];

    // Kaynaktaki tüm tekil anahtarları topla
    const sourceKeys = sourceRows.map((r) => r[pk]).filter(Boolean);

    // Turso'daki mevcut tüm anahtarları çek
    const tursoKeyRows = (await tursoDb.getAllAsync(`SELECT ${pk} FROM ${tableName}`)) || [];
    const tursoKeySet = new Set(tursoKeyRows.map((r) => r[pk]));

    // Kaynaktaki HER BİR satırın Turso'da gerçekten var olduğunu doğrula
    const missingKeys = sourceKeys.filter((key) => !tursoKeySet.has(key));
    const isMatch = missingKeys.length === 0;

    if (!isMatch) {
      allMatched = false;
      console.error(`[Migration] Uyuşmazlık: '${tableName}' tablosunda aktarılamayan ID'ler:`, missingKeys);
    }

    auditResults[tableName] = {
      sourceCount: sourceRows.length,
      tursoTotalCount: tursoKeyRows.length,
      verifiedCount: sourceKeys.length - missingKeys.length,
      ok: isMatch,
    };
  }

  return { allMatched, auditResults };
}

/**
 * Migrasyon bayrağını sıfırlamak için yardımcı fonksiyon.
 */
export async function resetMigrationFlag(uid, tursoDb) {
  const localKey = `jplanning:${uid}:migrated_to_turso_v1`;
  localStorage.removeItem(localKey);
  localStorage.removeItem(`jplanning:${uid}:migrated_to_turso`);
  if (tursoDb) {
    try {
      await tursoDb.runAsync("DELETE FROM app_meta WHERE key = 'legacy_data_migrated_v1'");
    } catch (_) {}
  }
  console.log('[Migration] Migrasyon bayrağı sıfırlandı.');
}

/**
 * Ana Migrasyon Fonksiyonu: initDatabase tarafından çağrılır.
 */
export async function migrateLegacyDataIfNeeded(uid, tursoDb) {
  if (!uid || !tursoDb) return;

  // Geliştirici / Konsol için kolay sıfırlama komutu ata
  if (typeof window !== 'undefined') {
    window.__resetMigration = async () => {
      await resetMigrationFlag(uid, tursoDb);
      console.log('[Migration] Sıfırlama tamamlandı. Lütfen sayfayı yenileyin (F5).');
    };
  }

  const localKey = `jplanning:${uid}:migrated_to_turso_v1`;
  if (localStorage.getItem(localKey) === 'true') {
    return;
  }

  // 1. Adım: Turso app_meta kontrolü
  try {
    const metaRow = await tursoDb.getFirstAsync(
      "SELECT value FROM app_meta WHERE key = 'legacy_data_migrated_v1'"
    );
    if (metaRow && metaRow.value === 'true') {
      localStorage.setItem(localKey, 'true');
      return;
    }
  } catch (err) {
    console.warn('[Migration] app_meta kontrol uyarısı:', err);
  }

  console.log('[Migration] Geçmiş veriler kontrol ediliyor...');

  // 2. Adım: Önce yerel IndexedDB'yi tara
  let legacyData = await readFromIndexedDb(uid);

  // 3. Adım: IndexedDB boşsa Firestore yedeğini tara
  if (!legacyData) {
    legacyData = await readFromFirestoreBackup(uid);
  }

  // 4. Adım: Hiçbir yerde geçmiş veri yoksa (Yeni Kullanıcı) -> Bayrağı koy ve bitir
  if (!legacyData) {
    console.log('[Migration] Aktarılacak geçmiş veri bulunamadı (Yeni kullanıcı). Migrasyon bayrağı ayarlandı.');
    await tursoDb.runAsync(
      "INSERT INTO app_meta (key, value) VALUES ('legacy_data_migrated_v1', 'true') ON CONFLICT(key) DO UPDATE SET value = 'true'"
    );
    localStorage.setItem(localKey, 'true');
    return;
  }

  console.log(`[Migration] Bulunan Kaynak: ${legacyData.source} (${legacyData.sourceDetails})`);

  // 5. Adım: Verileri Turso'ya aktar ve ID bazlı doğrula
  const { allMatched, auditResults } = await transferTablesToTurso(legacyData.tables, tursoDb);

  // Sayısal ve ID-Bazlı Doğrulama Raporunu Logla
  console.group('[Migration] ID-Bazlı Matematiksel Doğrulama Raporu:');
  for (const [table, res] of Object.entries(auditResults)) {
    console.log(
      `  ├── ${table.padEnd(20)}: Kaynak = ${String(res.sourceCount).padEnd(3)} | Turso'da Doğrulanan = ${String(res.verifiedCount).padEnd(3)} (Turso Toplam: ${String(res.tursoTotalCount).padEnd(3)}) ${res.ok ? '✅' : '❌'}`
    );
  }
  console.groupEnd();

  if (!allMatched) {
    console.error('[Migration] HATA: Bazı satırlar Turso veritabanında doğrulanamadı! Migrasyon bayrağı KONULMADI.');
    window.dispatchEvent(
      new CustomEvent('jplanning:migration-error', {
        detail: { message: 'Verilerinizin bir kısmı aktarılırken uyuşmazlık tespit edildi.' },
      })
    );
    return;
  }

  // 6. Adım: %100 Doğrulandıktan sonra bayrağı Turso ve LocalStorage'a yaz
  await tursoDb.runAsync(
    "INSERT INTO app_meta (key, value) VALUES ('legacy_data_migrated_v1', 'true') ON CONFLICT(key) DO UPDATE SET value = 'true'"
  );
  localStorage.setItem(localKey, 'true');

  console.log('[Migration] ✅ 10/10 tablodaki TÜM satırların ID varlığı %100 doğrulandı ve migrasyon tamamlandı.');
}
