import { getDb } from '../db/database';

const VALID_PRIORITIES = ['HIGH', 'MEDIUM', 'LOW', 'ZERO'];
const VALID_PERIODS = ['DAILY', 'WEEKLY', 'MONTHLY', 'ONCE'];
const SECRET_SALT = 'J-PLANNING_BACKUP_INTEGRITY_SALT_v1_2026';

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

  const tables = {
    categories: db.getAllSync('SELECT * FROM categories'),
    tasks: db.getAllSync('SELECT * FROM tasks'),
    task_records: db.getAllSync('SELECT * FROM task_records'),
    wallet: db.getAllSync('SELECT * FROM wallet'),
    wallet_transactions: db.getAllSync('SELECT * FROM wallet_transactions'),
    rewards: db.getAllSync('SELECT * FROM rewards'),
    friends: db.getAllSync('SELECT * FROM friends'),
    focus_sessions: db.getAllSync('SELECT * FROM focus_sessions'),
    daily_notes: db.getAllSync('SELECT * FROM daily_notes'),
    task_study_logs: db.getAllSync('SELECT * FROM task_study_logs'),
  };

  const signature = await generateDataSignature(tables);

  const backupData = {
    app: 'J-Planning',
    version: 1,
    exportedAt: new Date().toISOString(),
    signature,
    tables,
    notificationSchedules: JSON.parse(localStorage.getItem('jplanning:notification_schedules') || '[]'),
  };

  const jsonString = JSON.stringify(backupData, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const dateStr = new Date().toISOString().slice(0, 10);
  const a = document.createElement('a');
  a.href = url;
  a.download = `j-planning-yedek-${dateStr}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function importUserData(jsonText) {
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch (e) {
    throw new Error('Yedek dosyası geçerli bir JSON formatında değil.');
  }

  if (!data || data.app !== 'J-Planning' || !data.tables || typeof data.tables !== 'object') {
    throw new Error('Geçersiz yedek dosyası formatı.');
  }

  // Kriptografik İmza Doğrulaması (Tamper Proofing)
  if (!data.signature) {
    throw new Error('Yedek dosyasında güvenlik imzası bulunamadı! Dosya bütünlüğü doğrulanamadı.');
  }

  const expectedSignature = await generateDataSignature(data.tables);
  if (data.signature !== expectedSignature) {
    throw new Error('Yedek dosyası üzerinde elle değişiklik yapılmış veya dosya bütünlüğü bozulmuş! Güvenlik nedeniyle içe aktarma reddedildi.');
  }

  const db = getDb();
  const tables = data.tables;

  // Tüm tabloları sıfırla ve verileri doğrulanmış olarak yükle
  db.execSync('BEGIN TRANSACTION;');
  try {
    if (Array.isArray(tables.categories)) {
      db.runSync('DELETE FROM categories;');
      for (const row of tables.categories) {
        if (!row.id || !row.name) continue;
        db.runSync(
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
      db.runSync('DELETE FROM tasks;');
      for (const row of tables.tasks) {
        if (!row.id || !row.title) continue;
        db.runSync(
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
      db.runSync('DELETE FROM task_records;');
      for (const row of tables.task_records) {
        if (!row.id || !row.taskId || !row.periodKey) continue;
        db.runSync(
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
      db.runSync('DELETE FROM wallet;');
      for (const row of tables.wallet) {
        db.runSync('INSERT INTO wallet (userId, balance) VALUES (?, ?)', [
          sanitizeString(row.userId || 'me', 100),
          sanitizeInt(row.balance, 0, 1000000, 0),
        ]);
      }
    }

    if (Array.isArray(tables.wallet_transactions)) {
      db.runSync('DELETE FROM wallet_transactions;');
      for (const row of tables.wallet_transactions) {
        if (!row.id) continue;
        db.runSync(
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
      db.runSync('DELETE FROM rewards;');
      for (const row of tables.rewards) {
        if (!row.id || !row.title) continue;
        db.runSync(
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
      db.runSync('DELETE FROM focus_sessions;');
      for (const row of tables.focus_sessions) {
        if (!row.id) continue;
        db.runSync(
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
      db.runSync('DELETE FROM daily_notes;');
      for (const row of tables.daily_notes) {
        if (!row.id || !row.dateKey || !row.content) continue;
        db.runSync(
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
      db.runSync('DELETE FROM task_study_logs;');
      for (const row of tables.task_study_logs) {
        if (!row.id || !row.taskId || !row.periodKey) continue;
        db.runSync(
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
      localStorage.setItem('jplanning:notification_schedules', JSON.stringify(data.notificationSchedules));
    }

    db.execSync('COMMIT;');
  } catch (err) {
    db.execSync('ROLLBACK;');
    throw err;
  }
}
