// J-Planning — Veri Yedekleme ve Geri Yükleme Servisi (Web)

import { getDb } from '../db/database';
import { getSchedules } from './notificationService';

export function exportAllUserData() {
  const db = getDb();

  const backupData = {
    app: 'J-Planning',
    version: 1,
    exportedAt: new Date().toISOString(),
    tables: {
      categories: db.getAllSync('SELECT * FROM categories'),
      tasks: db.getAllSync('SELECT * FROM tasks'),
      task_records: db.getAllSync('SELECT * FROM task_records'),
      wallet: db.getAllSync('SELECT * FROM wallet'),
      wallet_transactions: db.getAllSync('SELECT * FROM wallet_transactions'),
      rewards: db.getAllSync('SELECT * FROM rewards'),
      friends: db.getAllSync('SELECT * FROM friends'),
      focus_sessions: db.getAllSync('SELECT * FROM focus_sessions'),
    },
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
  const data = JSON.parse(jsonText);
  if (!data || data.app !== 'J-Planning' || !data.tables) {
    throw new Error('Geçersiz yedek dosyası formatı.');
  }

  const db = getDb();
  const tables = data.tables;

  // Tüm tabloları sıfırla ve verileri yükle
  db.execSync('BEGIN TRANSACTION;');
  try {
    if (tables.categories) {
      db.runSync('DELETE FROM categories;');
      for (const row of tables.categories) {
        db.runSync(
          'INSERT INTO categories (id, name, color, createdAt) VALUES (?, ?, ?, ?)',
          [row.id, row.name, row.color ?? null, row.createdAt]
        );
      }
    }

    if (tables.tasks) {
      db.runSync('DELETE FROM tasks;');
      for (const row of tables.tasks) {
        db.runSync(
          `INSERT INTO tasks (id, title, description, categoryId, priority, period, ownerUserId, assignedByUserId, assignedByName, assignedToUserId, assignedToName, assignmentDirection, firestoreAssignmentId, assignmentStatus, subtaskCount, subtaskLabels, isArchived, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            row.id,
            row.title,
            row.description ?? null,
            row.categoryId ?? null,
            row.priority,
            row.period,
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
            row.isArchived || 0,
            row.createdAt,
          ]
        );
      }
    }

    if (tables.task_records) {
      db.runSync('DELETE FROM task_records;');
      for (const row of tables.task_records) {
        db.runSync(
          `INSERT INTO task_records (id, taskId, periodKey, status, completedSubtasks, completedAt, isLateMarked, lateMarkedAt, jpEarned, streakBonusEarned)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            row.id,
            row.taskId,
            row.periodKey,
            row.status,
            row.completedSubtasks || 0,
            row.completedAt ?? null,
            row.isLateMarked || 0,
            row.lateMarkedAt ?? null,
            row.jpEarned || 0,
            row.streakBonusEarned || 0,
          ]
        );
      }
    }

    if (tables.wallet) {
      db.runSync('DELETE FROM wallet;');
      for (const row of tables.wallet) {
        db.runSync('INSERT INTO wallet (userId, balance) VALUES (?, ?)', [row.userId, row.balance]);
      }
    }

    if (tables.wallet_transactions) {
      db.runSync('DELETE FROM wallet_transactions;');
      for (const row of tables.wallet_transactions) {
        db.runSync(
          `INSERT INTO wallet_transactions (id, userId, amount, reason, relatedTaskId, relatedRewardId, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [row.id, row.userId, row.amount, row.reason, row.relatedTaskId ?? null, row.relatedRewardId ?? null, row.createdAt]
        );
      }
    }

    if (tables.rewards) {
      db.runSync('DELETE FROM rewards;');
      for (const row of tables.rewards) {
        db.runSync(
          `INSERT INTO rewards (id, title, description, cost, ownerUserId, assignedByUserId, assignedByName, assignmentStatus, isRedeemed, redeemedAt, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [row.id, row.title, row.description ?? null, row.cost, row.ownerUserId || 'me', row.assignedByUserId ?? null, row.assignedByName ?? null, row.assignmentStatus || 'NONE', row.isRedeemed || 0, row.redeemedAt ?? null, row.createdAt]
        );
      }
    }

    if (tables.focus_sessions) {
      db.runSync('DELETE FROM focus_sessions;');
      for (const row of tables.focus_sessions) {
        db.runSync(
          `INSERT INTO focus_sessions (id, durationMinutes, soundKey, jpEarned, monthKey, completedAt)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [row.id, row.durationMinutes, row.soundKey ?? null, row.jpEarned || 0, row.monthKey, row.completedAt]
        );
      }
    }

    if (data.notificationSchedules) {
      localStorage.setItem('jplanning:notification_schedules', JSON.stringify(data.notificationSchedules));
    }

    db.execSync('COMMIT;');
  } catch (err) {
    db.execSync('ROLLBACK;');
    throw err;
  }
}
