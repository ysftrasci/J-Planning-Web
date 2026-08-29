// J-Planning — Görev Repository
// Tüm görev CRUD işlemleri ve iş kuralları (tamamlama, geç işaretleme, JP kazanımı,
// alt görev/sıklık) burada.
//
// ALT GÖREV (subtask) MANTIĞI:
// Bir görevin periyodu (gün/hafta/ay) birden fazla "alt adım" içerebilir
// (ör. diş fırçalama: sabah + akşam = 2 alt adım). subtaskCount=1 ise eski
// (basit) davranışla birebir aynıdır. Bir periyot ancak TÜM alt adımlar
// tamamlanınca SUCCESSFUL sayılır ve JP verilir — kısmi tamamlamada JP
// verilmez (kullanıcı kararı).

import { getDb } from './database';
import {
  getPeriodKey,
  getPeriodEndTimestamp,
  isWithinLateMarkWindow,
  getPreviousPeriodKey,
} from '../utils/period';
import { calculateStreakUpTo } from '../utils/streak';
import { calculateTaskJP, calculateOnceTaskJP } from '../utils/rewards';
import { triggerAutoCloudSyncForCurrentUser } from '../services/cloudSyncService';
import { deleteAssignedTaskInFirestore } from '../services/taskAssignmentService';

function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function createTask({ title, description, categoryId, priority, period, subtaskCount, subtaskLabels, assignedByUserId, assignedByName }) {
  const db = getDb();
  const id = uuid();
  const now = Date.now();
  const count = Math.max(1, parseInt(subtaskCount, 10) || 1);
  const labelsJson = subtaskLabels && subtaskLabels.some((l) => l && l.trim())
    ? JSON.stringify(subtaskLabels.map((l) => (l || '').trim()))
    : null;

  const descText = typeof description === 'string' && description.trim() ? description.trim() : null;

  await db.runAsync(
    `INSERT INTO tasks (id, title, description, categoryId, priority, period, ownerUserId, assignedByUserId, assignedByName, assignmentStatus, subtaskCount, subtaskLabels, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, 'me', ?, ?, ?, ?, ?, ?)`,
    [
      id,
      title,
      descText,
      categoryId ?? null,
      priority ?? 'MEDIUM',
      period ?? 'DAILY',
      assignedByUserId ?? null,
      assignedByName ?? null,
      assignedByUserId ? 'PENDING_ACCEPT' : 'NONE',
      count,
      labelsJson,
      now,
    ]
  );
  triggerAutoCloudSyncForCurrentUser();
  return id;
}

export async function getActiveTasks() {
  const db = getDb();
  return db.getAllAsync(
    `SELECT * FROM tasks WHERE isArchived = 0 AND assignmentStatus != 'PENDING_ACCEPT' ORDER BY createdAt DESC`
  );
}

// Firestore'da (services/taskAssignmentService.js) kabul edilen bir arkadaş
// ataması, kendi yerel görev listesine ACCEPTED durumunda eklenir — böylece
// normal görev gibi tamamlanabilir. Kabul sonrası silinemez (bkz. deleteTask).
// direction: 'RECEIVED' (bana atandı, ben yürütüyorum) — bu fonksiyon her zaman
// atanan/alan tarafın kendi cihazında çağrılır.
export async function createTaskFromAssignment(assignedTask) {
  const db = getDb();
  const existing = await db.getFirstAsync(
    'SELECT id FROM tasks WHERE firestoreAssignmentId = ?',
    [assignedTask.id]
  );
  if (existing) return existing.id;

  const id = uuid();
  const now = Date.now();
  const count = Math.max(1, parseInt(assignedTask.subtaskCount, 10) || 1);
  const labelsJson = assignedTask.subtaskLabels && assignedTask.subtaskLabels.length
    ? JSON.stringify(assignedTask.subtaskLabels)
    : null;
  const descText = typeof assignedTask.description === 'string' && assignedTask.description.trim()
    ? assignedTask.description.trim()
    : null;

  await db.runAsync(
    `INSERT INTO tasks (id, title, description, categoryId, priority, period, ownerUserId, assignedByUserId, assignedByName, assignmentDirection, assignmentStatus, subtaskCount, subtaskLabels, firestoreAssignmentId, createdAt)
     VALUES (?, ?, ?, NULL, ?, ?, 'me', ?, ?, 'RECEIVED', 'ACCEPTED', ?, ?, ?, ?)`,
    [id, assignedTask.title, descText, assignedTask.priority, assignedTask.period, assignedTask.assignedByUid, assignedTask.assignedByName, count, labelsJson, assignedTask.id, now]
  );
  return id;
}

// Ben bir arkadaşıma görev attığımda, kendi tarafımda da (takip edebilmem için)
// bir kayıt oluşturulur — direction: 'SENT'. Bu görev BENİM tarafımdan
// tamamlanamaz (sadece izleme amaçlı), UI'da bunu ayırt etmemiz gerekir.
export async function createSentTaskRecord({ title, description, priority, period, subtaskCount, subtaskLabels, assignedToUserId, assignedToName, firestoreAssignmentId }) {
  const db = getDb();
  const id = uuid();
  const now = Date.now();
  const count = Math.max(1, parseInt(subtaskCount, 10) || 1);
  const labelsJson = subtaskLabels && subtaskLabels.some((l) => l && l.trim())
    ? JSON.stringify(subtaskLabels.map((l) => (l || '').trim()))
    : null;
  const descText = typeof description === 'string' && description.trim() ? description.trim() : null;

  await db.runAsync(
    `INSERT INTO tasks (id, title, description, categoryId, priority, period, ownerUserId, assignedToUserId, assignedToName, assignmentDirection, assignmentStatus, subtaskCount, subtaskLabels, firestoreAssignmentId, createdAt)
     VALUES (?, ?, ?, NULL, ?, ?, 'me', ?, ?, 'SENT', 'ACCEPTED', ?, ?, ?, ?)`,
    [id, title, descText, priority, period, assignedToUserId, assignedToName, count, labelsJson, firestoreAssignmentId ?? null, now]
  );
  return id;
}

export async function findTaskByIdOrFirestoreId(idOrFirestoreId) {
  const db = getDb();
  let task = await db.getFirstAsync('SELECT * FROM tasks WHERE id = ?', [idOrFirestoreId]);
  if (!task) {
    task = await db.getFirstAsync('SELECT * FROM tasks WHERE firestoreAssignmentId = ?', [idOrFirestoreId]);
  }
  return task;
}

export async function updateTask(taskId, { title, description, categoryId, priority, period, subtaskCount, subtaskLabels }) {
  const db = getDb();
  const task = await findTaskByIdOrFirestoreId(taskId);
  if (!task) throw new Error('Görev bulunamadı.');

  if (task.assignmentDirection === 'RECEIVED') {
    throw new Error('Bu görevi bir arkadaşın sana atadığı için sadece görevi atan kişi düzenleyebilir.');
  }

  const cleanTitle = (title || '').trim();
  if (!cleanTitle) throw new Error('Lütfen görev adı girin.');

  const descText = typeof description === 'string' && description.trim() ? description.trim() : null;
  const count = Math.max(1, parseInt(subtaskCount, 10) || 1);
  const labelsJson = subtaskLabels && subtaskLabels.some((l) => l && l.trim())
    ? JSON.stringify(subtaskLabels.map((l) => (l || '').trim()))
    : null;

  await db.runAsync(
    `UPDATE tasks
     SET title = ?, description = ?, categoryId = ?, priority = ?, period = ?, subtaskCount = ?, subtaskLabels = ?
     WHERE id = ?`,
    [
      cleanTitle,
      descText,
      categoryId ?? null,
      priority ?? 'MEDIUM',
      period ?? 'DAILY',
      count,
      labelsJson,
      task.id,
    ]
  );
  triggerAutoCloudSyncForCurrentUser();
}

export async function deleteTask(taskId) {
  let db;
  try {
    db = getDb();
  } catch (e) {
    return;
  }
  if (!db) return;

  const task = await findTaskByIdOrFirestoreId(taskId);
  const realId = task ? task.id : taskId;
  const firestoreId = task ? task.firestoreAssignmentId : taskId;

  if (firestoreId) {
    deleteAssignedTaskInFirestore(firestoreId).catch((e) => {
      console.warn('Firestore assignment deletion note:', e);
    });
  }

  // 1. Önce alt bağımlı tabloları temizle (Foreign Key kısıtını sağla)
  await db.runAsync('DELETE FROM task_records WHERE taskId = ?', [realId]);
  await db.runAsync('DELETE FROM task_study_logs WHERE taskId = ?', [realId]);
  await db.runAsync('UPDATE wallet_transactions SET relatedTaskId = NULL WHERE relatedTaskId = ?', [realId]);

  // 2. Ana görevi sil
  await db.runAsync('DELETE FROM tasks WHERE id = ? OR firestoreAssignmentId = ?', [realId, realId]);
  triggerAutoCloudSyncForCurrentUser();
}

export async function getTaskRecords(taskId) {
  const db = getDb();
  const task = await findTaskByIdOrFirestoreId(taskId);
  const realId = task ? task.id : taskId;
  return db.getAllAsync('SELECT * FROM task_records WHERE taskId = ? ORDER BY periodKey DESC', [realId]);
}

export function getSubtaskLabels(task) {
  if (!task || !task.subtaskLabels) return null;
  try {
    return JSON.parse(task.subtaskLabels);
  } catch {
    return null;
  }
}

// Bugünün (veya görevin güncel periyodunun) durumunu ve kaç alt adımın
// tamamlandığını döndürür.
export async function getCurrentPeriodStatus(task) {
  const db = getDb();
  const periodKey = getPeriodKey(task.period, new Date());
  const record = await db.getFirstAsync(
    'SELECT * FROM task_records WHERE taskId = ? AND periodKey = ?',
    [task.id, periodKey]
  );
  if (record) return { status: record.status, completedSubtasks: record.completedSubtasks || 0 };
  return { status: 'PENDING', completedSubtasks: 0 };
}

async function recalculateAndApplyJP(db, task, periodKey, existingRecord) {
  // Tek seferlik görevlerde streak/bonus kavramı yok — sadece zorluk
  // seviyesine (priority alanı EASY/MEDIUM/HARD olarak kullanılır) göre
  // sabit JP verilir.
  if (task.period === 'ONCE') {
    const { bonus, total } = calculateOnceTaskJP(task.priority);
    return { newStreak: 0, bonus, total };
  }

  const allRecords = await db.getAllAsync('SELECT * FROM task_records WHERE taskId = ?', [task.id]);
  const recordsForCalc = allRecords.filter((r) => r.periodKey !== periodKey);
  recordsForCalc.push({ periodKey, status: 'SUCCESSFUL' });
  const newStreak = calculateStreakUpTo(task, recordsForCalc, periodKey);
  const { bonus, total } = calculateTaskJP(task.priority, newStreak);
  return { newStreak, bonus, total };
}

// Bir alt adımı tamamlar (subtaskCount=1 olan basit görevlerde tek çağrı yeterli).
// Tüm alt adımlar tamamlanınca periyot SUCCESSFUL olur ve JP verilir.
export async function completeSubtask(taskId) {
  const db = getDb();
  const task = await db.getFirstAsync('SELECT * FROM tasks WHERE id = ?', [taskId]);
  if (!task) throw new Error('Görev bulunamadı');
  if (task.assignmentDirection === 'SENT') {
    throw new Error('Bu görevi sen atadın, tamamlama işlemi arkadaşına ait.');
  }

  const periodKey = getPeriodKey(task.period, new Date());
  const existing = await db.getFirstAsync(
    'SELECT * FROM task_records WHERE taskId = ? AND periodKey = ?',
    [taskId, periodKey]
  );

  if (existing && existing.status === 'SUCCESSFUL') {
    return { alreadyComplete: true, completedSubtasks: task.subtaskCount, subtaskCount: task.subtaskCount, firestoreAssignmentId: task.firestoreAssignmentId };
  }

  const currentCompleted = existing ? existing.completedSubtasks : 0;
  const newCompleted = Math.min(task.subtaskCount, currentCompleted + 1);
  const isFullyComplete = newCompleted >= task.subtaskCount;
  const now = Date.now();

  if (!isFullyComplete) {
    // Kısmi tamamlama: JP verilmez, sadece sayaç güncellenir.
    if (existing) {
      await db.runAsync('UPDATE task_records SET completedSubtasks = ? WHERE id = ?', [newCompleted, existing.id]);
    } else {
      await db.runAsync(
        `INSERT INTO task_records (id, taskId, periodKey, status, completedSubtasks, jpEarned)
         VALUES (?, ?, ?, 'PENDING_PARTIAL', ?, 0)`,
        [uuid(), taskId, periodKey, newCompleted]
      );
    }
    triggerAutoCloudSyncForCurrentUser();
    return { alreadyComplete: false, completedSubtasks: newCompleted, subtaskCount: task.subtaskCount, fullyCompleted: false, firestoreAssignmentId: task.firestoreAssignmentId };
  }

  // Tam tamamlama: streak hesapla, JP ver.
  const { bonus, total, newStreak } = await recalculateAndApplyJP(db, task, periodKey, existing);

  if (existing) {
    await db.runAsync(
      `UPDATE task_records SET status = 'SUCCESSFUL', completedSubtasks = ?, completedAt = ?, jpEarned = ?, streakBonusEarned = ? WHERE id = ?`,
      [newCompleted, now, total, bonus, existing.id]
    );
  } else {
    await db.runAsync(
      `INSERT INTO task_records (id, taskId, periodKey, status, completedSubtasks, completedAt, isLateMarked, jpEarned, streakBonusEarned)
       VALUES (?, ?, ?, 'SUCCESSFUL', ?, ?, 0, ?, ?)`,
      [uuid(), taskId, periodKey, newCompleted, now, total, bonus]
    );
  }

  await addWalletTransaction('me', total, 'TASK_COMPLETE', taskId);
  triggerAutoCloudSyncForCurrentUser();
  return { alreadyComplete: false, completedSubtasks: newCompleted, subtaskCount: task.subtaskCount, fullyCompleted: true, bonus, total, newStreak, firestoreAssignmentId: task.firestoreAssignmentId };
}

// Yanlışlıkla basılan bir tamamlamayı geri alır. Eğer periyot SUCCESSFUL
// durumdaysa (tüm alt adımlar bitmişse), JP geri alınır ve durum PENDING'e
// döner (bir alt adım geri açılır). Streak otomatik olarak bir sonraki
// hesaplamada düzelir (bu periyot artık SUCCESSFUL olmadığı için).
export async function uncompleteSubtask(taskId) {
  const db = getDb();
  const task = await db.getFirstAsync('SELECT * FROM tasks WHERE id = ?', [taskId]);
  if (!task) throw new Error('Görev bulunamadı');

  const periodKey = getPeriodKey(task.period, new Date());
  const existing = await db.getFirstAsync(
    'SELECT * FROM task_records WHERE taskId = ? AND periodKey = ?',
    [taskId, periodKey]
  );
  if (!existing || existing.completedSubtasks <= 0) {
    return { completedSubtasks: 0, subtaskCount: task.subtaskCount, firestoreAssignmentId: task.firestoreAssignmentId };
  }

  const wasSuccessful = existing.status === 'SUCCESSFUL';
  const newCompleted = existing.completedSubtasks - 1;

  if (wasSuccessful && existing.jpEarned) {
    await addWalletTransaction('me', -existing.jpEarned, 'TASK_COMPLETE', taskId);
  }

  if (newCompleted <= 0) {
    // Hiç alt adım kalmadıysa kaydı tamamen sil (periyot yeniden PENDING sayılır).
    await db.runAsync('DELETE FROM task_records WHERE id = ?', [existing.id]);
  } else {
    await db.runAsync(
      `UPDATE task_records SET status = 'PENDING_PARTIAL', completedSubtasks = ?, completedAt = NULL, jpEarned = 0, streakBonusEarned = 0 WHERE id = ?`,
      [newCompleted, existing.id]
    );
  }

  triggerAutoCloudSyncForCurrentUser();
  return { completedSubtasks: Math.max(0, newCompleted), subtaskCount: task.subtaskCount, firestoreAssignmentId: task.firestoreAssignmentId };
}

// Geçmişe dönük düzeltme (1 hafta / 7 gün sınırı).
export async function lateMarkTaskComplete(taskId, periodKey) {
  const db = getDb();
  const task = await db.getFirstAsync('SELECT * FROM tasks WHERE id = ?', [taskId]);
  if (!task) throw new Error('Görev bulunamadı');

  const periodEnd = getPeriodEndTimestamp(task.period, periodKey);
  if (!isWithinLateMarkWindow(periodEnd)) {
    throw new Error('Bu görev 7 günden (1 hafta) eski olduğu için artık değiştirilemez.');
  }

  const existing = await db.getFirstAsync(
    'SELECT * FROM task_records WHERE taskId = ? AND periodKey = ?',
    [taskId, periodKey]
  );
  if (existing && existing.status === 'SUCCESSFUL') return;

  if (existing && existing.jpEarned) {
    await addWalletTransaction('me', -existing.jpEarned, 'TASK_COMPLETE', taskId);
  }

  const { bonus, total, newStreak } = await recalculateAndApplyJP(db, task, periodKey, existing);
  const now = Date.now();

  if (existing) {
    await db.runAsync(
      `UPDATE task_records SET status = 'SUCCESSFUL', completedSubtasks = ?, completedAt = ?, isLateMarked = 1, lateMarkedAt = ?, jpEarned = ?, streakBonusEarned = ? WHERE id = ?`,
      [task.subtaskCount, now, now, total, bonus, existing.id]
    );
  } else {
    await db.runAsync(
      `INSERT INTO task_records (id, taskId, periodKey, status, completedSubtasks, completedAt, isLateMarked, lateMarkedAt, jpEarned, streakBonusEarned)
       VALUES (?, ?, ?, 'SUCCESSFUL', ?, ?, 1, ?, ?, ?)`,
      [uuid(), taskId, periodKey, task.subtaskCount, now, now, total, bonus]
    );
  }

  await addWalletTransaction('me', total, 'TASK_COMPLETE', taskId);
  return { newStreak, total };
}

export async function lateMarkTaskUncomplete(taskId, periodKey) {
  const db = getDb();
  const task = await db.getFirstAsync('SELECT * FROM tasks WHERE id = ?', [taskId]);
  if (!task) throw new Error('Görev bulunamadı');

  const periodEnd = getPeriodEndTimestamp(task.period, periodKey);
  if (!isWithinLateMarkWindow(periodEnd)) {
    throw new Error('Bu görev 7 günden (1 hafta) eski olduğu için artık değiştirilemez.');
  }

  const existing = await db.getFirstAsync(
    'SELECT * FROM task_records WHERE taskId = ? AND periodKey = ?',
    [taskId, periodKey]
  );
  if (!existing || existing.status !== 'SUCCESSFUL') return;

  if (existing.jpEarned) {
    await addWalletTransaction('me', -existing.jpEarned, 'TASK_COMPLETE', taskId);
  }

  await db.runAsync(
    `UPDATE task_records SET status = 'FAILED', completedSubtasks = 0, completedAt = NULL, jpEarned = 0, streakBonusEarned = 0 WHERE id = ?`,
    [existing.id]
  );
}

export async function getStreakFreezeCount() {
  const db = getDb();
  const row = await db.getFirstAsync(`SELECT value FROM app_meta WHERE key = 'streak_freeze_count'`);
  return row ? Math.max(0, parseInt(row.value, 10) || 0) : 0;
}

export async function buyStreakFreeze(cost = 50) {
  const balance = await getWalletBalance('me');
  if (balance < cost) {
    throw new Error(`Seri dondurma rozeti almak için en az ${cost} JP gerekiyor.`);
  }
  await addWalletTransaction('me', -cost, 'BUY_STREAK_FREEZE');
  const db = getDb();
  const current = await getStreakFreezeCount();
  await db.runAsync(
    `INSERT INTO app_meta (key, value) VALUES ('streak_freeze_count', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [String(current + 1)]
  );
}

export async function consumeStreakFreeze() {
  const current = await getStreakFreezeCount();
  if (current <= 0) return false;
  const db = getDb();
  await db.runAsync(
    `INSERT INTO app_meta (key, value) VALUES ('streak_freeze_count', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [String(current - 1)]
  );
  return true;
}

export async function cleanupInvalidPastRecords() {
  let db;
  try {
    db = getDb();
  } catch (e) {
    return;
  }
  if (!db) return;

  const tasks = await db.getAllAsync(`SELECT id, period, createdAt FROM tasks`);
  for (const task of tasks) {
    if (!task.createdAt) continue;
    const startPeriodKey = getPeriodKey(task.period, new Date(task.createdAt));
    await db.runAsync(
      `DELETE FROM task_records WHERE taskId = ? AND periodKey < ?`,
      [task.id, startPeriodKey]
    );
  }
}

export async function getAllTaskRecords() {
  const db = getDb();
  return db.getAllAsync('SELECT * FROM task_records ORDER BY periodKey DESC');
}

// Süresi dolan ama işaretlenmemiş periyotları otomatik FAILED yapar.
// Toplu çekme ve bellek-içi Map indeksleme ile optimize edilmiştir (N+1 sorgu çözümü).
export async function processExpiredPeriods() {
  let db;
  try {
    db = getDb();
  } catch (e) {
    return;
  }
  if (!db) return;

  const [tasks, allRecords] = await Promise.all([
    db.getAllAsync(
      `SELECT * FROM tasks WHERE isArchived = 0 AND assignmentStatus != 'PENDING_ACCEPT' AND (assignmentDirection IS NULL OR assignmentDirection != 'SENT') AND period != 'ONCE'`
    ),
    db.getAllAsync('SELECT * FROM task_records'),
  ]);

  if (!tasks || tasks.length === 0) return;

  const recordsMap = new Map();
  for (const r of (allRecords || [])) {
    recordsMap.set(`${r.taskId}_${r.periodKey}`, r);
  }

  const now = Date.now();
  const missingInserts = [];
  const partialUpdates = [];

  for (const task of tasks) {
    const startPeriodKey = getPeriodKey(task.period, new Date(task.createdAt || Date.now()));
    const periodKey = getPeriodKey(task.period, new Date());
    let checkKey = periodKey;

    for (let i = 0; i < 60; i++) {
      if (checkKey < startPeriodKey) break;

      const endTs = getPeriodEndTimestamp(task.period, checkKey);
      if (endTs > now) {
        checkKey = getPreviousPeriodKey(task.period, checkKey);
        continue;
      }

      const existing = recordsMap.get(`${task.id}_${checkKey}`);
      if (!existing) {
        missingInserts.push({ taskId: task.id, periodKey: checkKey });
      } else if (existing.status === 'PENDING_PARTIAL') {
        partialUpdates.push(existing.id);
      }
      checkKey = getPreviousPeriodKey(task.period, checkKey);
    }
  }

  if (missingInserts.length > 0) {
    let availableFreezes = await getStreakFreezeCount();
    await Promise.all(
      missingInserts.map(async (rec) => {
        let status = 'FAILED';
        if (availableFreezes > 0) {
          availableFreezes--;
          await consumeStreakFreeze();
          status = 'FROZEN';
        }
        return db.runAsync(
          `INSERT OR IGNORE INTO task_records (id, taskId, periodKey, status, jpEarned) VALUES (?, ?, ?, ?, 0)`,
          [uuid(), rec.taskId, rec.periodKey, status]
        );
      })
    );
  }

  if (partialUpdates.length > 0) {
    await Promise.all(
      partialUpdates.map((id) =>
        db.runAsync(`UPDATE task_records SET status = 'FAILED' WHERE id = ?`, [id])
      )
    );
  }
}

// Bu görevden (bugüne kadar) net kazanılan toplam JP. Geri alınan (uncomplete)
// tamamlamalar negatif işlemler olarak zaten wallet_transactions'a yazıldığı
// için, burada basitçe TASK_COMPLETE işlemlerinin toplamı alınır — bu net
// (geri alınanlar düşülmüş) toplamı verir.
export async function getTotalJPEarnedForTask(taskId) {
  const db = getDb();
  const row = await db.getFirstAsync(
    `SELECT COALESCE(SUM(amount), 0) as total FROM wallet_transactions WHERE relatedTaskId = ? AND reason = 'TASK_COMPLETE'`,
    [taskId]
  );
  return row ? row.total : 0;
}

export async function getWalletBalance(userId = 'me') {
  const db = getDb();
  const row = await db.getFirstAsync('SELECT balance FROM wallet WHERE userId = ?', [userId]);
  return row ? row.balance : 0;
}

export async function addWalletTransaction(userId, amount, reason, relatedTaskId = null, relatedRewardId = null) {
  const db = getDb();
  await db.runAsync(
    `INSERT INTO wallet_transactions (id, userId, amount, reason, relatedTaskId, relatedRewardId, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [uuid(), userId, amount, reason, relatedTaskId, relatedRewardId, Date.now()]
  );
  await db.runAsync(
    `INSERT INTO wallet (userId, balance) VALUES (?, ?)
     ON CONFLICT(userId) DO UPDATE SET balance = balance + excluded.balance`,
    [userId, amount]
  );
}

export async function getWalletHistory(userId = 'me') {
  const db = getDb();
  return db.getAllAsync(
    'SELECT * FROM wallet_transactions WHERE userId = ? ORDER BY createdAt DESC',
    [userId]
  );
}

export async function updateTaskNotes(taskId, notes) {
  const db = getDb();
  const task = await findTaskByIdOrFirestoreId(taskId);
  const realId = task ? task.id : taskId;
  await db.runAsync('UPDATE tasks SET notes = ? WHERE id = ?', [notes ?? '', realId]);
  triggerAutoCloudSyncForCurrentUser();
}

export async function updateTaskFromAssignment(assignedTaskDoc) {
  if (!assignedTaskDoc || !assignedTaskDoc.id) return;
  const db = getDb();
  const firestoreId = assignedTaskDoc.id;
  const existing = await db.getFirstAsync('SELECT * FROM tasks WHERE firestoreAssignmentId = ?', [firestoreId]);
  if (!existing) return;

  const count = Math.max(1, assignedTaskDoc.subtaskCount || 1);
  const rawLabels = Array.isArray(assignedTaskDoc.subtaskLabels)
    ? JSON.stringify(assignedTaskDoc.subtaskLabels)
    : null;
  const descText = typeof assignedTaskDoc.description === 'string' && assignedTaskDoc.description.trim()
    ? assignedTaskDoc.description.trim()
    : null;

  await db.runAsync(
    `UPDATE tasks
     SET title = ?, description = ?, priority = ?, period = ?, subtaskCount = ?, subtaskLabels = ?
     WHERE id = ?`,
    [
      assignedTaskDoc.title,
      descText,
      assignedTaskDoc.priority || 'MEDIUM',
      assignedTaskDoc.period || 'DAILY',
      count,
      rawLabels,
      existing.id,
    ]
  );
}

// Atanan kişi: Firestore'da silinmiş veya artık aktif olmayan görevleri kendi SQLite veritabanından kaldırır
export async function syncReceivedTasksWithFirestore(activeFirestoreAssignedTasks) {
  let db;
  try {
    db = getDb();
  } catch (e) {
    return;
  }
  if (!db) return;

  const localReceived = await db.getAllAsync(
    `SELECT id, firestoreAssignmentId FROM tasks WHERE assignmentDirection = 'RECEIVED' AND firestoreAssignmentId IS NOT NULL`
  );
  if (!localReceived || localReceived.length === 0) return;

  const activeDocIds = new Set(
    Array.isArray(activeFirestoreAssignedTasks)
      ? activeFirestoreAssignedTasks.map((t) => t.id)
      : []
  );

  let deletedAny = false;
  for (const localTask of localReceived) {
    if (!activeDocIds.has(localTask.firestoreAssignmentId)) {
      await db.runAsync('DELETE FROM task_records WHERE taskId = ?', [localTask.id]);
      await db.runAsync('DELETE FROM task_study_logs WHERE taskId = ?', [localTask.id]);
      await db.runAsync('DELETE FROM tasks WHERE id = ?', [localTask.id]);
      deletedAny = true;
    }
  }
  if (deletedAny) {
    triggerAutoCloudSyncForCurrentUser();
  }
}

export async function getTaskStudyLog(taskId, periodKey) {
  const db = getDb();
  return db.getFirstAsync(
    'SELECT * FROM task_study_logs WHERE taskId = ? AND periodKey = ?',
    [taskId, periodKey]
  );
}

export async function saveTaskStudyLog(taskId, periodKey, studyTimeText) {
  const db = getDb();
  const existing = await getTaskStudyLog(taskId, periodKey);
  const now = Date.now();
  if (existing) {
    await db.runAsync(
      'UPDATE task_study_logs SET studyTimeText = ?, updatedAt = ? WHERE id = ?',
      [studyTimeText ?? '', now, existing.id]
    );
  } else {
    await db.runAsync(
      'INSERT INTO task_study_logs (id, taskId, periodKey, studyTimeText, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
      [uuid(), taskId, periodKey, studyTimeText ?? '', now, now]
    );
  }
}

export { uuid };
