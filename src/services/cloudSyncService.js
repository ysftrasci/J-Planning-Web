// J-Planning — Gerçek Zamanlı Bulut Senkronizasyonu (Cloud Sync)
// Cihazlar (Laptop, Telefon vb.) arası veri uyumluluğu ve anlık senkronizasyon.

import { doc, getDoc, setDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { db, auth } from './firebase';
import { getDb } from '../db/database';
import { uuid } from '../db/taskRepository';

const SECRET_SALT = 'J-PLANNING_BACKUP_INTEGRITY_SALT_v1_2026';

// Bu tarayıcı/cihaz örneği için benzersiz ID
function getDeviceId() {
  let devId = localStorage.getItem('jplanning:device_instance_id');
  if (!devId) {
    devId = uuid();
    localStorage.setItem('jplanning:device_instance_id', devId);
  }
  return devId;
}

async function generateDataSignature(tablesPayload) {
  const jsonStr = JSON.stringify(tablesPayload) + SECRET_SALT;
  const encoder = new TextEncoder();
  const data = encoder.encode(jsonStr);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function sanitizeInt(val, min = 0, max = 1000000, defaultVal = 0) {
  const parsed = parseInt(val, 10);
  if (isNaN(parsed)) return defaultVal;
  return Math.max(min, Math.min(max, parsed));
}

function sanitizeString(val, maxLength = 1000) {
  if (typeof val !== 'string') return '';
  return val.slice(0, maxLength);
}

let syncTimeout = null;
let isApplyingRemoteData = false;
let lastSyncedVersionTs = 0;

export function getLocalSnapshotPayload() {
  const sqliteDb = getDb();
  return {
    categories: sqliteDb.getAllSync('SELECT * FROM categories'),
    tasks: sqliteDb.getAllSync('SELECT * FROM tasks'),
    task_records: sqliteDb.getAllSync('SELECT * FROM task_records'),
    wallet: sqliteDb.getAllSync('SELECT * FROM wallet'),
    wallet_transactions: sqliteDb.getAllSync('SELECT * FROM wallet_transactions'),
    rewards: sqliteDb.getAllSync('SELECT * FROM rewards'),
    friends: sqliteDb.getAllSync('SELECT * FROM friends'),
    focus_sessions: sqliteDb.getAllSync('SELECT * FROM focus_sessions'),
    daily_notes: sqliteDb.getAllSync('SELECT * FROM daily_notes'),
    task_study_logs: sqliteDb.getAllSync('SELECT * FROM task_study_logs'),
  };
}

export async function uploadCloudSync(uid) {
  if (!uid || isApplyingRemoteData) return;

  try {
    const tables = getLocalSnapshotPayload();
    const signature = await generateDataSignature(tables);
    const now = Date.now();
    lastSyncedVersionTs = now;

    const docRef = doc(db, 'users', uid, 'user_backup', 'latest');
    await setDoc(docRef, {
      app: 'J-Planning',
      version: 1,
      deviceId: getDeviceId(),
      updatedAtMs: now,
      signature,
      tablesJson: JSON.stringify(tables),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn('Bulut senkronizasyon yükleme uyarısı:', err);
  }
}

export function triggerAutoCloudSync(uid) {
  if (!uid || isApplyingRemoteData) return;
  if (syncTimeout) clearTimeout(syncTimeout);
  syncTimeout = setTimeout(() => {
    uploadCloudSync(uid);
  }, 600);
}

export function triggerAutoCloudSyncForCurrentUser() {
  const uid = auth.currentUser?.uid;
  if (uid) {
    triggerAutoCloudSync(uid);
  }
}

export async function applyRemoteTablesToLocal(tables) {
  const sqliteDb = getDb();
  isApplyingRemoteData = true;

  try {
    sqliteDb.execSync('BEGIN TRANSACTION;');

    if (Array.isArray(tables.categories)) {
      for (const row of tables.categories) {
        if (!row.id || !row.name) continue;
        sqliteDb.runSync(
          'INSERT OR REPLACE INTO categories (id, name, color, createdAt) VALUES (?, ?, ?, ?)',
          [
            sanitizeString(row.id, 100),
            sanitizeString(row.name, 100),
            row.color ? sanitizeString(row.color, 30) : '#C98A2C',
            sanitizeInt(row.createdAt, 0, Date.now() + 8640000000, Date.now()),
          ]
        );
      }
    }

    if (Array.isArray(tables.tasks)) {
      for (const row of tables.tasks) {
        if (!row.id || !row.title) continue;
        sqliteDb.runSync(
          `INSERT OR REPLACE INTO tasks (id, title, description, notes, categoryId, priority, period, ownerUserId, assignedByUserId, assignedByName, assignedToUserId, assignedToName, assignmentDirection, firestoreAssignmentId, assignmentStatus, subtaskCount, subtaskLabels, isArchived, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            sanitizeString(row.id, 100),
            sanitizeString(row.title, 300),
            row.description ? sanitizeString(row.description, 1000) : null,
            row.notes ? sanitizeString(row.notes, 5000) : null,
            row.categoryId ? sanitizeString(row.categoryId, 100) : null,
            sanitizeString(row.priority || 'MEDIUM', 20),
            sanitizeString(row.period || 'DAILY', 20),
            sanitizeString(row.ownerUserId || 'me', 100),
            row.assignedByUserId ? sanitizeString(row.assignedByUserId, 100) : null,
            row.assignedByName ? sanitizeString(row.assignedByName, 100) : null,
            row.assignedToUserId ? sanitizeString(row.assignedToUserId, 100) : null,
            row.assignedToName ? sanitizeString(row.assignedToName, 100) : null,
            row.assignmentDirection ? sanitizeString(row.assignmentDirection, 30) : null,
            row.firestoreAssignmentId ? sanitizeString(row.firestoreAssignmentId, 100) : null,
            sanitizeString(row.assignmentStatus || 'NONE', 30),
            sanitizeInt(row.subtaskCount, 1, 100, 1),
            row.subtaskLabels ? sanitizeString(row.subtaskLabels, 2000) : null,
            row.isArchived ? 1 : 0,
            sanitizeInt(row.createdAt, 0, Date.now() + 8640000000, Date.now()),
          ]
        );
      }
    }

    if (Array.isArray(tables.task_records)) {
      for (const row of tables.task_records) {
        if (!row.id || !row.taskId || !row.periodKey) continue;
        sqliteDb.runSync(
          `INSERT OR REPLACE INTO task_records (id, taskId, periodKey, status, completedSubtasks, completedAt, isLateMarked, lateMarkedAt, jpEarned, streakBonusEarned)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            sanitizeString(row.id, 100),
            sanitizeString(row.taskId, 100),
            sanitizeString(row.periodKey, 30),
            sanitizeString(row.status || 'FAILED', 30),
            sanitizeInt(row.completedSubtasks, 0, 100, 0),
            row.completedAt ? sanitizeInt(row.completedAt, 0, Date.now() + 8640000000, Date.now()) : null,
            row.isLateMarked ? 1 : 0,
            row.lateMarkedAt ? sanitizeInt(row.lateMarkedAt, 0, Date.now() + 8640000000, Date.now()) : null,
            sanitizeInt(row.jpEarned, 0, 10000, 0),
            sanitizeInt(row.streakBonusEarned, 0, 1000, 0),
          ]
        );
      }
    }

    if (Array.isArray(tables.wallet)) {
      for (const row of tables.wallet) {
        sqliteDb.runSync('INSERT OR REPLACE INTO wallet (userId, balance) VALUES (?, ?)', [
          sanitizeString(row.userId || 'me', 100),
          sanitizeInt(row.balance, 0, 1000000, 0),
        ]);
      }
    }

    if (Array.isArray(tables.wallet_transactions)) {
      for (const row of tables.wallet_transactions) {
        if (!row.id) continue;
        sqliteDb.runSync(
          `INSERT OR REPLACE INTO wallet_transactions (id, userId, amount, reason, relatedTaskId, relatedRewardId, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            sanitizeString(row.id, 100),
            sanitizeString(row.userId || 'me', 100),
            sanitizeInt(row.amount, -100000, 100000, 0),
            sanitizeString(row.reason || 'TRANSACTION', 50),
            row.relatedTaskId ? sanitizeString(row.relatedTaskId, 100) : null,
            row.relatedRewardId ? sanitizeString(row.relatedRewardId, 100) : null,
            sanitizeInt(row.createdAt, 0, Date.now() + 8640000000, Date.now()),
          ]
        );
      }
    }

    if (Array.isArray(tables.rewards)) {
      for (const row of tables.rewards) {
        if (!row.id || !row.title) continue;
        sqliteDb.runSync(
          `INSERT OR REPLACE INTO rewards (id, title, description, cost, ownerUserId, assignedByUserId, assignedByName, assignmentStatus, isRedeemed, redeemedAt, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            sanitizeString(row.id, 100),
            sanitizeString(row.title, 300),
            row.description ? sanitizeString(row.description, 1000) : null,
            sanitizeInt(row.cost, 0, 100000, 0),
            sanitizeString(row.ownerUserId || 'me', 100),
            row.assignedByUserId ? sanitizeString(row.assignedByUserId, 100) : null,
            row.assignedByName ? sanitizeString(row.assignedByName, 100) : null,
            sanitizeString(row.assignmentStatus || 'NONE', 30),
            row.isRedeemed ? 1 : 0,
            row.redeemedAt ? sanitizeInt(row.redeemedAt, 0, Date.now() + 8640000000, Date.now()) : null,
            sanitizeInt(row.createdAt, 0, Date.now() + 8640000000, Date.now()),
          ]
        );
      }
    }

    if (Array.isArray(tables.focus_sessions)) {
      for (const row of tables.focus_sessions) {
        if (!row.id) continue;
        sqliteDb.runSync(
          `INSERT OR REPLACE INTO focus_sessions (id, durationMinutes, soundKey, jpEarned, monthKey, completedAt)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            sanitizeString(row.id, 100),
            sanitizeInt(row.durationMinutes, 1, 1440, 1),
            row.soundKey ? sanitizeString(row.soundKey, 50) : null,
            sanitizeInt(row.jpEarned, 0, 100, 0),
            sanitizeString(row.monthKey || '2026-08', 7),
            sanitizeInt(row.completedAt, 0, Date.now() + 8640000000, Date.now()),
          ]
        );
      }
    }

    if (Array.isArray(tables.daily_notes)) {
      for (const row of tables.daily_notes) {
        if (!row.id || !row.dateKey) continue;
        sqliteDb.runSync(
          `INSERT OR REPLACE INTO daily_notes (id, dateKey, content, studyTimeText, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            sanitizeString(row.id, 100),
            sanitizeString(row.dateKey, 10),
            sanitizeString(row.content || '', 10000),
            row.studyTimeText ? sanitizeString(row.studyTimeText, 500) : null,
            sanitizeInt(row.createdAt, 0, Date.now() + 8640000000, Date.now()),
            sanitizeInt(row.updatedAt, 0, Date.now() + 8640000000, Date.now()),
          ]
        );
      }
    }

    if (Array.isArray(tables.task_study_logs)) {
      for (const row of tables.task_study_logs) {
        if (!row.id || !row.taskId || !row.periodKey) continue;
        sqliteDb.runSync(
          `INSERT OR REPLACE INTO task_study_logs (id, taskId, periodKey, studyTimeText, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            sanitizeString(row.id, 100),
            sanitizeString(row.taskId, 100),
            sanitizeString(row.periodKey, 30),
            sanitizeString(row.studyTimeText || '', 500),
            sanitizeInt(row.createdAt, 0, Date.now() + 8640000000, Date.now()),
            sanitizeInt(row.updatedAt, 0, Date.now() + 8640000000, Date.now()),
          ]
        );
      }
    }

    sqliteDb.execSync('COMMIT;');
  } catch (err) {
    sqliteDb.execSync('ROLLBACK;');
    console.error('Uzaktan gelen verileri içe aktarma hatası:', err);
    throw err;
  } finally {
    isApplyingRemoteData = false;
  }
}

function countTableItems(tables) {
  if (!tables) return 0;
  let count = 0;
  for (const key of Object.keys(tables)) {
    if (Array.isArray(tables[key])) {
      count += tables[key].length;
    }
  }
  return count;
}

export async function performInitialCloudSync(uid) {
  if (!uid) return;
  try {
    const localTables = getLocalSnapshotPayload();
    const localCount = countTableItems(localTables);

    const docRef = doc(db, 'users', uid, 'user_backup', 'latest');
    const snap = await getDoc(docRef);

    if (!snap.exists()) {
      // Bulutta henüz yedek yoksa ve yerelde veri varsa buluta yükle
      if (localCount > 0) {
        await uploadCloudSync(uid);
      }
      return;
    }

    const cloudData = snap.data();
    if (!cloudData.tablesJson || !cloudData.signature) {
      if (localCount > 0) {
        await uploadCloudSync(uid);
      }
      return;
    }

    const remoteTables = JSON.parse(cloudData.tablesJson);
    const expectedSig = await generateDataSignature(remoteTables);
    if (cloudData.signature !== expectedSig) {
      console.warn('Bulut senkronizasyon imza uyuşmazlığı, yerel veriler korundu.');
      return;
    }

    const remoteCount = countTableItems(remoteTables);

    // EĞER yerelde daha çok öge varsa (ör. telefonda 5 eski görev var ama bulutta az/hiç yok):
    // Yereldeki verileri buluta aktar!
    if (localCount > remoteCount) {
      await uploadCloudSync(uid);
      return;
    }

    // EĞER bulutta yerelden daha çok öge varsa (ör. tablet boş ama bulutta telefondan gelen 5 görev var):
    // Buluttaki veriyi indirip yerel veritabanında güncelle!
    if (remoteCount > localCount) {
      await applyRemoteTablesToLocal(remoteTables);
      lastSyncedVersionTs = cloudData.updatedAtMs || Date.now();
      window.dispatchEvent(new Event('jplanning:cloud-sync-update'));
      return;
    }

    // Öge sayıları eşitse zaman damgasına göre güncelle
    if (cloudData.updatedAtMs && cloudData.updatedAtMs > lastSyncedVersionTs) {
      await applyRemoteTablesToLocal(remoteTables);
      lastSyncedVersionTs = cloudData.updatedAtMs || Date.now();
      window.dispatchEvent(new Event('jplanning:cloud-sync-update'));
      return;
    }

    await uploadCloudSync(uid);
  } catch (err) {
    console.warn('İlk senkronizasyon kontrolü uyarısı:', err);
  }
}

export async function downloadAndApplyCloudSync(uid) {
  if (!uid) return false;
  try {
    const docRef = doc(db, 'users', uid, 'user_backup', 'latest');
    const snap = await getDoc(docRef);
    if (!snap.exists()) return false;

    const data = snap.data();
    if (!data.tablesJson || !data.signature) return false;

    const tables = JSON.parse(data.tablesJson);
    const expectedSignature = await generateDataSignature(tables);
    if (data.signature !== expectedSignature) {
      console.warn('Bulut senkronizasyon verisinin bütünlük imzası uyuşmuyor.');
      return false;
    }

    await applyRemoteTablesToLocal(tables);
    lastSyncedVersionTs = data.updatedAtMs || Date.now();
    return true;
  } catch (err) {
    console.warn('Buluttan senkron veri indirme uyarısı:', err);
    return false;
  }
}

export function listenCloudSync(uid, onRemoteUpdate) {
  if (!uid) return () => {};

  const docRef = doc(db, 'users', uid, 'user_backup', 'latest');
  return onSnapshot(docRef, async (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();

    // Kendi cihazımızın başlattığı yüklemeyi tekrar uygulamaması için cihaz kontrolü
    if (data.deviceId === getDeviceId()) return;
    if (data.updatedAtMs && data.updatedAtMs <= lastSyncedVersionTs) return;

    if (data.tablesJson && data.signature) {
      try {
        const tables = JSON.parse(data.tablesJson);
        const expectedSignature = await generateDataSignature(tables);
        if (data.signature === expectedSignature) {
          await applyRemoteTablesToLocal(tables);
          lastSyncedVersionTs = data.updatedAtMs || Date.now();
          if (onRemoteUpdate) onRemoteUpdate();
        }
      } catch (err) {
        console.error('Buluttan gelen anlık değişiklik işleme hatası:', err);
      }
    }
  });
}
