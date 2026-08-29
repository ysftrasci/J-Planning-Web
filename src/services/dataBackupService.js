// J-Planning — Veri Yedekleme ve Geri Yükleme Servisi (Web)
//
// Kullanıcının TÜM yerel verilerini (kategoriler, görevler, periyot kayıtları,
// cüzdan bakiyesi, işlem geçmişi, ödüller, arkadaşlar, odaklanma seansları,
// bildirim tercihleri) tek bir JSON dosyası olarak dışa aktarır ve doğrulanmış
// olarak geri yükler.

import { getDb } from '../db/database';
import { getSchedules, saveSchedules } from './notificationService';

const VALID_PRIORITIES = ['HIGH', 'MEDIUM', 'LOW', 'ZERO', 'EASY', 'HARD'];
const VALID_PERIODS = ['DAILY', 'WEEKLY', 'MONTHLY', 'ONCE'];

// Veri Bütünlüğü Kontrolü (Checksum) için tuz değeri.
const CHECKSUM_SALT = 'J-PLANNING_BACKUP_INTEGRITY_SALT_v1_2026';

async function calculateChecksum(tablesPayload) {
  const jsonStr = JSON.stringify(tablesPayload) + CHECKSUM_SALT;
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

function sanitizeEnum(val, allowedArray, defaultVal) {
  if (typeof val === 'string' && allowedArray.includes(val.toUpperCase())) {
    return val.toUpperCase();
  }
  return defaultVal;
}

function sanitizeString(val, maxLength = 1000) {
  if (typeof val !== 'string') return '';
  return val.slice(0, maxLength);
}

export async function exportAllUserData() {
  const db = getDb();

  const [
    categories,
    tasks,
    task_records,
    wallet,
    wallet_transactions,
    rewards,
    friends,
    focus_sessions,
    daily_notes,
    task_study_logs,
  ] = await Promise.all([
    db.getAllAsync('SELECT * FROM categories'),
    db.getAllAsync('SELECT * FROM tasks'),
    db.getAllAsync('SELECT * FROM task_records'),
    db.getAllAsync('SELECT * FROM wallet'),
    db.getAllAsync('SELECT * FROM wallet_transactions'),
    db.getAllAsync('SELECT * FROM rewards'),
    db.getAllAsync('SELECT * FROM friends'),
    db.getAllAsync('SELECT * FROM focus_sessions'),
    db.getAllAsync('SELECT * FROM daily_notes'),
    db.getAllAsync('SELECT * FROM task_study_logs'),
  ]);

  const tables = {
    categories,
    tasks,
    task_records,
    wallet,
    wallet_transactions,
    rewards,
    friends,
    focus_sessions,
    daily_notes,
    task_study_logs,
  };

  const checksum = await calculateChecksum(tables);

  const backupData = {
    app: 'J-Planning',
    version: 1,
    exportedAt: new Date().toISOString(),
    checksum,
    signature: checksum,
    tables,
    notificationSchedules: await getSchedules(),
  };

  const jsonString = JSON.stringify(backupData, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const dateStr = new Date().toISOString().slice(0, 10);
  const fileName = `jplanning-backup-${dateStr}.json`;

  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export async function importUserData(jsonText) {
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch {
    throw new Error('Dosya geçerli bir JSON formatında değil.');
  }

  if (!data || data.app !== 'J-Planning' || !data.tables) {
    throw new Error('Bu dosya geçerli bir J-Planning yedek dosyası değil.');
  }

  const fileChecksum = data.checksum || data.signature;
  if (fileChecksum) {
    const expectedChecksum = await calculateChecksum(data.tables);
    if (fileChecksum !== expectedChecksum) {
      throw new Error('Yedek dosyasının bütünlüğü doğrulanamadı (dosya içeriği bozulmuş veya eksik indirilmiş olabilir).');
    }
  }

  const db = getDb();
  const tables = data.tables;

  try {
    if (Array.isArray(tables.categories)) {
      await db.runAsync('DELETE FROM categories;');
      for (const row of tables.categories) {
        if (!row.id || !row.name) continue;
        await db.runAsync(
          'INSERT INTO categories (id, name, color, createdAt) VALUES (?, ?, ?, ?)',
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
      await db.runAsync('DELETE FROM tasks;');
      for (const row of tables.tasks) {
        if (!row.id || !row.title) continue;
        await db.runAsync(
          `INSERT INTO tasks (id, title, description, notes, categoryId, priority, period, ownerUserId, assignedByUserId, assignedByName, assignedToUserId, assignedToName, assignmentDirection, firestoreAssignmentId, assignmentStatus, subtaskCount, subtaskLabels, isArchived, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            sanitizeString(row.id, 100),
            sanitizeString(row.title, 300),
            row.description ? sanitizeString(row.description, 1000) : null,
            row.notes ? sanitizeString(row.notes, 5000) : null,
            row.categoryId ? sanitizeString(row.categoryId, 100) : null,
            sanitizeEnum(row.priority, VALID_PRIORITIES, 'MEDIUM'),
            sanitizeEnum(row.period, VALID_PERIODS, 'DAILY'),
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
      await db.runAsync('DELETE FROM task_records;');
      for (const row of tables.task_records) {
        if (!row.id || !row.taskId || !row.periodKey) continue;
        await db.runAsync(
          `INSERT INTO task_records (id, taskId, periodKey, status, completedSubtasks, completedAt, isLateMarked, lateMarkedAt, jpEarned, streakBonusEarned)
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
      await db.runAsync('DELETE FROM wallet;');
      for (const row of tables.wallet) {
        await db.runAsync('INSERT INTO wallet (userId, balance) VALUES (?, ?)', [
          sanitizeString(row.userId || 'me', 100),
          sanitizeInt(row.balance, 0, 1000000, 0),
        ]);
      }
    }

    if (Array.isArray(tables.wallet_transactions)) {
      await db.runAsync('DELETE FROM wallet_transactions;');
      for (const row of tables.wallet_transactions) {
        if (!row.id) continue;
        await db.runAsync(
          `INSERT INTO wallet_transactions (id, userId, amount, reason, relatedTaskId, relatedRewardId, createdAt)
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
      await db.runAsync('DELETE FROM rewards;');
      for (const row of tables.rewards) {
        if (!row.id || !row.title) continue;
        await db.runAsync(
          `INSERT INTO rewards (id, title, description, cost, ownerUserId, assignedByUserId, assignedByName, assignmentStatus, isRedeemed, redeemedAt, createdAt)
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
      await db.runAsync('DELETE FROM focus_sessions;');
      for (const row of tables.focus_sessions) {
        if (!row.id) continue;
        await db.runAsync(
          `INSERT INTO focus_sessions (id, durationMinutes, soundKey, jpEarned, monthKey, completedAt)
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
      await db.runAsync('DELETE FROM daily_notes;');
      for (const row of tables.daily_notes) {
        if (!row.id || !row.dateKey || !row.content) continue;
        await db.runAsync(
          `INSERT INTO daily_notes (id, dateKey, content, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?)`,
          [
            sanitizeString(row.id, 100),
            sanitizeString(row.dateKey, 10),
            sanitizeString(row.content, 10000),
            sanitizeInt(row.createdAt, 0, Date.now() + 8640000000, Date.now()),
            sanitizeInt(row.updatedAt, 0, Date.now() + 8640000000, Date.now()),
          ]
        );
      }
    }

    if (Array.isArray(tables.task_study_logs)) {
      await db.runAsync('DELETE FROM task_study_logs;');
      for (const row of tables.task_study_logs) {
        if (!row.id || !row.taskId || !row.periodKey) continue;
        await db.runAsync(
          `INSERT INTO task_study_logs (id, taskId, periodKey, studyTimeText, createdAt, updatedAt)
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

    if (Array.isArray(data.notificationSchedules)) {
      await saveSchedules(data.notificationSchedules);
    }
  } catch (err) {
    console.error('Yedek geri yükleme hatası:', err);
    throw err;
  }
}
