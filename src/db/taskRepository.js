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

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function createTask({ title, description, categoryId, priority, period, subtaskCount, subtaskLabels, assignedByUserId, assignedByName }) {
  const db = getDb();
  const id = uuid();
  const now = Date.now();
  const count = Math.max(1, parseInt(subtaskCount, 10) || 1);
  const labelsJson = subtaskLabels && subtaskLabels.some((l) => l && l.trim())
    ? JSON.stringify(subtaskLabels.map((l) => (l || '').trim()))
    : null;

  const descText = typeof description === 'string' && description.trim() ? description.trim() : null;

  db.runSync(
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
  return id;
}

export function getActiveTasks() {
  const db = getDb();
  return db.getAllSync(
    `SELECT * FROM tasks WHERE isArchived = 0 AND assignmentStatus != 'PENDING_ACCEPT' ORDER BY createdAt DESC`
  );
}

// Firestore'da (services/taskAssignmentService.js) kabul edilen bir arkadaş
// ataması, kendi yerel görev listesine ACCEPTED durumunda eklenir — böylece
// normal görev gibi tamamlanabilir. Kabul sonrası silinemez (bkz. deleteTask).
// direction: 'RECEIVED' (bana atandı, ben yürütüyorum) — bu fonksiyon her zaman
// atanan/alan tarafın kendi cihazında çağrılır.
export function createTaskFromAssignment(assignedTask) {
  const db = getDb();
  const existing = db.getFirstSync(
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

  db.runSync(
    `INSERT INTO tasks (id, title, categoryId, priority, period, ownerUserId, assignedByUserId, assignedByName, assignmentDirection, assignmentStatus, subtaskCount, subtaskLabels, firestoreAssignmentId, createdAt)
     VALUES (?, ?, NULL, ?, ?, 'me', ?, ?, 'RECEIVED', 'ACCEPTED', ?, ?, ?, ?)`,
    [id, assignedTask.title, assignedTask.priority, assignedTask.period, assignedTask.assignedByUid, assignedTask.assignedByName, count, labelsJson, assignedTask.id, now]
  );
  return id;
}

// Ben bir arkadaşıma görev attığımda, kendi tarafımda da (takip edebilmem için)
// bir kayıt oluşturulur — direction: 'SENT'. Bu görev BENİM tarafımdan
// tamamlanamaz (sadece izleme amaçlı), UI'da bunu ayırt etmemiz gerekir.
export function createSentTaskRecord({ title, priority, period, subtaskCount, subtaskLabels, assignedToUserId, assignedToName }) {
  const db = getDb();
  const id = uuid();
  const now = Date.now();
  const count = Math.max(1, parseInt(subtaskCount, 10) || 1);
  const labelsJson = subtaskLabels && subtaskLabels.some((l) => l && l.trim())
    ? JSON.stringify(subtaskLabels.map((l) => (l || '').trim()))
    : null;

  db.runSync(
    `INSERT INTO tasks (id, title, categoryId, priority, period, ownerUserId, assignedToUserId, assignedToName, assignmentDirection, assignmentStatus, subtaskCount, subtaskLabels, createdAt)
     VALUES (?, ?, NULL, ?, ?, 'me', ?, ?, 'SENT', 'ACCEPTED', ?, ?, ?)`,
    [id, title, priority, period, assignedToUserId, assignedToName, count, labelsJson, now]
  );
  return id;
}

// Not: Kabul edilmiş, arkadaştan atanan görevler bu fonksiyonla silinemez (kural: kabul sonrası silinemez).
export function deleteTask(taskId) {
  const db = getDb();
  const task = db.getFirstSync('SELECT * FROM tasks WHERE id = ?', [taskId]);
  if (task && task.assignmentDirection === 'RECEIVED' && task.assignmentStatus === 'ACCEPTED') {
    throw new Error('Kabul edilen atanmış görevler silinemez.');
  }
  db.runSync('DELETE FROM tasks WHERE id = ?', [taskId]);
  db.runSync('DELETE FROM task_records WHERE taskId = ?', [taskId]);
}

export function getTaskRecords(taskId) {
  const db = getDb();
  return db.getAllSync('SELECT * FROM task_records WHERE taskId = ? ORDER BY periodKey DESC', [taskId]);
}

export function getSubtaskLabels(task) {
  if (!task.subtaskLabels) return null;
  try {
    return JSON.parse(task.subtaskLabels);
  } catch {
    return null;
  }
}

// Bugünün (veya görevin güncel periyodunun) durumunu ve kaç alt adımın
// tamamlandığını döndürür.
export function getCurrentPeriodStatus(task) {
  const db = getDb();
  const periodKey = getPeriodKey(task.period, new Date());
  const record = db.getFirstSync(
    'SELECT * FROM task_records WHERE taskId = ? AND periodKey = ?',
    [task.id, periodKey]
  );
  if (record) return { status: record.status, completedSubtasks: record.completedSubtasks || 0 };
  return { status: 'PENDING', completedSubtasks: 0 };
}

function recalculateAndApplyJP(db, task, periodKey, existingRecord) {
  // Tek seferlik görevlerde streak/bonus kavramı yok — sadece zorluk
  // seviyesine (priority alanı EASY/MEDIUM/HARD olarak kullanılır) göre
  // sabit JP verilir.
  if (task.period === 'ONCE') {
    const { bonus, total } = calculateOnceTaskJP(task.priority);
    return { newStreak: 0, bonus, total };
  }

  const allRecords = db.getAllSync('SELECT * FROM task_records WHERE taskId = ?', [task.id]);
  const recordsForCalc = allRecords.filter((r) => r.periodKey !== periodKey);
  recordsForCalc.push({ periodKey, status: 'SUCCESSFUL' });
  const newStreak = calculateStreakUpTo(task, recordsForCalc, periodKey);
  const { bonus, total } = calculateTaskJP(task.priority, newStreak);
  return { newStreak, bonus, total };
}

// Bir alt adımı tamamlar (subtaskCount=1 olan basit görevlerde tek çağrı yeterli).
// Tüm alt adımlar tamamlanınca periyot SUCCESSFUL olur ve JP verilir.
export function completeSubtask(taskId) {
  const db = getDb();
  const task = db.getFirstSync('SELECT * FROM tasks WHERE id = ?', [taskId]);
  if (!task) throw new Error('Görev bulunamadı');
  if (task.assignmentDirection === 'SENT') {
    throw new Error('Bu görevi sen atadın, tamamlama işlemi arkadaşına ait.');
  }

  const periodKey = getPeriodKey(task.period, new Date());
  const existing = db.getFirstSync(
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
      db.runSync('UPDATE task_records SET completedSubtasks = ? WHERE id = ?', [newCompleted, existing.id]);
    } else {
      db.runSync(
        `INSERT INTO task_records (id, taskId, periodKey, status, completedSubtasks, jpEarned)
         VALUES (?, ?, ?, 'PENDING_PARTIAL', ?, 0)`,
        [uuid(), taskId, periodKey, newCompleted]
      );
    }
    return { alreadyComplete: false, completedSubtasks: newCompleted, subtaskCount: task.subtaskCount, fullyCompleted: false, firestoreAssignmentId: task.firestoreAssignmentId };
  }

  // Tam tamamlama: streak hesapla, JP ver.
  const { bonus, total, newStreak } = recalculateAndApplyJP(db, task, periodKey, existing);

  if (existing) {
    db.runSync(
      `UPDATE task_records SET status = 'SUCCESSFUL', completedSubtasks = ?, completedAt = ?, jpEarned = ?, streakBonusEarned = ? WHERE id = ?`,
      [newCompleted, now, total, bonus, existing.id]
    );
  } else {
    db.runSync(
      `INSERT INTO task_records (id, taskId, periodKey, status, completedSubtasks, completedAt, isLateMarked, jpEarned, streakBonusEarned)
       VALUES (?, ?, ?, 'SUCCESSFUL', ?, ?, 0, ?, ?)`,
      [uuid(), taskId, periodKey, newCompleted, now, total, bonus]
    );
  }

  addWalletTransaction('me', total, 'TASK_COMPLETE', taskId);
  return { alreadyComplete: false, completedSubtasks: newCompleted, subtaskCount: task.subtaskCount, fullyCompleted: true, bonus, total, newStreak, firestoreAssignmentId: task.firestoreAssignmentId };
}

// Yanlışlıkla basılan bir tamamlamayı geri alır. Eğer periyot SUCCESSFUL
// durumdaysa (tüm alt adımlar bitmişse), JP geri alınır ve durum PENDING'e
// döner (bir alt adım geri açılır). Streak otomatik olarak bir sonraki
// hesaplamada düzelir (bu periyot artık SUCCESSFUL olmadığı için).
export function uncompleteSubtask(taskId) {
  const db = getDb();
  const task = db.getFirstSync('SELECT * FROM tasks WHERE id = ?', [taskId]);
  if (!task) throw new Error('Görev bulunamadı');

  const periodKey = getPeriodKey(task.period, new Date());
  const existing = db.getFirstSync(
    'SELECT * FROM task_records WHERE taskId = ? AND periodKey = ?',
    [taskId, periodKey]
  );
  if (!existing || existing.completedSubtasks <= 0) {
    return { completedSubtasks: 0, subtaskCount: task.subtaskCount, firestoreAssignmentId: task.firestoreAssignmentId };
  }

  const wasSuccessful = existing.status === 'SUCCESSFUL';
  const newCompleted = existing.completedSubtasks - 1;

  if (wasSuccessful && existing.jpEarned) {
    addWalletTransaction('me', -existing.jpEarned, 'TASK_COMPLETE', taskId);
  }

  if (newCompleted <= 0) {
    // Hiç alt adım kalmadıysa kaydı tamamen sil (periyot yeniden PENDING sayılır).
    db.runSync('DELETE FROM task_records WHERE id = ?', [existing.id]);
  } else {
    db.runSync(
      `UPDATE task_records SET status = 'PENDING_PARTIAL', completedSubtasks = ?, completedAt = NULL, jpEarned = 0, streakBonusEarned = 0 WHERE id = ?`,
      [newCompleted, existing.id]
    );
  }

  return { completedSubtasks: Math.max(0, newCompleted), subtaskCount: task.subtaskCount, firestoreAssignmentId: task.firestoreAssignmentId };
}

// Geçmişe dönük düzeltme (1 hafta / 7 gün sınırı).
export function lateMarkTaskComplete(taskId, periodKey) {
  const db = getDb();
  const task = db.getFirstSync('SELECT * FROM tasks WHERE id = ?', [taskId]);
  if (!task) throw new Error('Görev bulunamadı');

  const periodEnd = getPeriodEndTimestamp(task.period, periodKey);
  if (!isWithinLateMarkWindow(periodEnd)) {
    throw new Error('Bu görev 7 günden (1 hafta) eski olduğu için artık değiştirilemez.');
  }

  const existing = db.getFirstSync(
    'SELECT * FROM task_records WHERE taskId = ? AND periodKey = ?',
    [taskId, periodKey]
  );
  if (existing && existing.status === 'SUCCESSFUL') return;

  if (existing && existing.jpEarned) {
    addWalletTransaction('me', -existing.jpEarned, 'TASK_COMPLETE', taskId);
  }

  const { bonus, total, newStreak } = recalculateAndApplyJP(db, task, periodKey, existing);
  const now = Date.now();

  if (existing) {
    db.runSync(
      `UPDATE task_records SET status = 'SUCCESSFUL', completedSubtasks = ?, completedAt = ?, isLateMarked = 1, lateMarkedAt = ?, jpEarned = ?, streakBonusEarned = ? WHERE id = ?`,
      [task.subtaskCount, now, now, total, bonus, existing.id]
    );
  } else {
    db.runSync(
      `INSERT INTO task_records (id, taskId, periodKey, status, completedSubtasks, completedAt, isLateMarked, lateMarkedAt, jpEarned, streakBonusEarned)
       VALUES (?, ?, ?, 'SUCCESSFUL', ?, ?, 1, ?, ?, ?)`,
      [uuid(), taskId, periodKey, task.subtaskCount, now, now, total, bonus]
    );
  }

  addWalletTransaction('me', total, 'TASK_COMPLETE', taskId);
  return { newStreak, total };
}

export function lateMarkTaskUncomplete(taskId, periodKey) {
  const db = getDb();
  const task = db.getFirstSync('SELECT * FROM tasks WHERE id = ?', [taskId]);
  if (!task) throw new Error('Görev bulunamadı');

  const periodEnd = getPeriodEndTimestamp(task.period, periodKey);
  if (!isWithinLateMarkWindow(periodEnd)) {
    throw new Error('Bu görev 7 günden (1 hafta) eski olduğu için artık değiştirilemez.');
  }

  const existing = db.getFirstSync(
    'SELECT * FROM task_records WHERE taskId = ? AND periodKey = ?',
    [taskId, periodKey]
  );
  if (!existing || existing.status !== 'SUCCESSFUL') return;

  if (existing.jpEarned) {
    addWalletTransaction('me', -existing.jpEarned, 'TASK_COMPLETE', taskId);
  }

  db.runSync(
    `UPDATE task_records SET status = 'FAILED', completedSubtasks = 0, completedAt = NULL, jpEarned = 0, streakBonusEarned = 0 WHERE id = ?`,
    [existing.id]
  );
}

export function getStreakFreezeCount() {
  const db = getDb();
  const row = db.getFirstSync(`SELECT value FROM app_meta WHERE key = 'streak_freeze_count'`);
  return row ? Math.max(0, parseInt(row.value, 10) || 0) : 0;
}

export function buyStreakFreeze(cost = 50) {
  const balance = getWalletBalance('me');
  if (balance < cost) {
    throw new Error(`Seri dondurma rozeti almak için en az ${cost} JP gerekiyor.`);
  }
  addWalletTransaction('me', -cost, 'BUY_STREAK_FREEZE');
  const db = getDb();
  const current = getStreakFreezeCount();
  db.runSync(
    `INSERT INTO app_meta (key, value) VALUES ('streak_freeze_count', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [String(current + 1)]
  );
}

export function consumeStreakFreeze() {
  const current = getStreakFreezeCount();
  if (current <= 0) return false;
  const db = getDb();
  db.runSync(
    `INSERT INTO app_meta (key, value) VALUES ('streak_freeze_count', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [String(current - 1)]
  );
  return true;
}

export function cleanupInvalidPastRecords() {
  let db;
  try {
    db = getDb();
  } catch (e) {
    return;
  }
  if (!db) return;

  const tasks = db.getAllSync(`SELECT id, period, createdAt FROM tasks`);
  for (const task of tasks) {
    if (!task.createdAt) continue;
    const startPeriodKey = getPeriodKey(task.period, new Date(task.createdAt));
    db.runSync(
      `DELETE FROM task_records WHERE taskId = ? AND periodKey < ?`,
      [task.id, startPeriodKey]
    );
  }
}

// Süresi dolan ama işaretlenmemiş periyotları otomatik FAILED yapar.
// Eğer kullanıcının Seri Dondurma Hakkı (streak freeze) varsa, 1 dondurma hakkı
// harcanarak seri korunur ('FROZEN' durumu).
export function processExpiredPeriods() {
  let db;
  try {
    db = getDb();
  } catch (e) {
    return;
  }
  if (!db) return;

  // Önce geçmişteki hatalı kayıtları temizle
  cleanupInvalidPastRecords();

  const tasks = db.getAllSync(
    `SELECT * FROM tasks WHERE isArchived = 0 AND assignmentStatus != 'PENDING_ACCEPT' AND (assignmentDirection IS NULL OR assignmentDirection != 'SENT') AND period != 'ONCE'`
  );
  const now = Date.now();

  for (const task of tasks) {
    const startPeriodKey = getPeriodKey(task.period, new Date(task.createdAt || Date.now()));
    const periodKey = getPeriodKey(task.period, new Date());
    let checkKey = periodKey;

    for (let i = 0; i < 60; i++) {
      // Görevin oluşturulma periyodundan daha eski zamanlar için kayıt oluşturma
      if (checkKey < startPeriodKey) break;

      const endTs = getPeriodEndTimestamp(task.period, checkKey);
      if (endTs > now) {
        checkKey = getPreviousPeriodKey(task.period, checkKey);
        continue;
      }

      const existing = db.getFirstSync(
        'SELECT * FROM task_records WHERE taskId = ? AND periodKey = ?',
        [task.id, checkKey]
      );
      if (!existing) {
        // Günü kaçırdı — dondurma hakkı var mı?
        if (consumeStreakFreeze()) {
          db.runSync(
            `INSERT INTO task_records (id, taskId, periodKey, status, jpEarned) VALUES (?, ?, ?, 'FROZEN', 0)`,
            [uuid(), task.id, checkKey]
          );
        } else {
          db.runSync(
            `INSERT INTO task_records (id, taskId, periodKey, status, jpEarned) VALUES (?, ?, ?, 'FAILED', 0)`,
            [uuid(), task.id, checkKey]
          );
        }
      } else if (existing.status === 'PENDING_PARTIAL') {
        if (consumeStreakFreeze()) {
          db.runSync(`UPDATE task_records SET status = 'FROZEN' WHERE id = ?`, [existing.id]);
        } else {
          db.runSync(`UPDATE task_records SET status = 'FAILED' WHERE id = ?`, [existing.id]);
        }
      }
      checkKey = getPreviousPeriodKey(task.period, checkKey);
    }
  }
}

// Bu görevden (bugüne kadar) net kazanılan toplam JP. Geri alınan (uncomplete)
// tamamlamalar negatif işlemler olarak zaten wallet_transactions'a yazıldığı
// için, burada basitçe TASK_COMPLETE işlemlerinin toplamı alınır — bu net
// (geri alınanlar düşülmüş) toplamı verir.
export function getTotalJPEarnedForTask(taskId) {
  const db = getDb();
  const row = db.getFirstSync(
    `SELECT COALESCE(SUM(amount), 0) as total FROM wallet_transactions WHERE relatedTaskId = ? AND reason = 'TASK_COMPLETE'`,
    [taskId]
  );
  return row ? row.total : 0;
}

export function getWalletBalance(userId = 'me') {
  const db = getDb();
  const row = db.getFirstSync('SELECT balance FROM wallet WHERE userId = ?', [userId]);
  return row ? row.balance : 0;
}

export function addWalletTransaction(userId, amount, reason, relatedTaskId = null, relatedRewardId = null) {
  const db = getDb();
  db.runSync(
    `INSERT INTO wallet_transactions (id, userId, amount, reason, relatedTaskId, relatedRewardId, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [uuid(), userId, amount, reason, relatedTaskId, relatedRewardId, Date.now()]
  );
  db.runSync(
    `INSERT INTO wallet (userId, balance) VALUES (?, ?)
     ON CONFLICT(userId) DO UPDATE SET balance = balance + excluded.balance`,
    [userId, amount]
  );
}

export function getWalletHistory(userId = 'me') {
  const db = getDb();
  return db.getAllSync(
    'SELECT * FROM wallet_transactions WHERE userId = ? ORDER BY createdAt DESC',
    [userId]
  );
}

export function updateTaskNotes(taskId, notes) {
  const db = getDb();
  db.runSync('UPDATE tasks SET notes = ? WHERE id = ?', [notes ?? '', taskId]);
}

export function getTaskStudyLog(taskId, periodKey) {
  const db = getDb();
  return db.getFirstSync(
    'SELECT * FROM task_study_logs WHERE taskId = ? AND periodKey = ?',
    [taskId, periodKey]
  );
}

export function saveTaskStudyLog(taskId, periodKey, studyTimeText) {
  const db = getDb();
  const existing = getTaskStudyLog(taskId, periodKey);
  const now = Date.now();
  if (existing) {
    db.runSync(
      'UPDATE task_study_logs SET studyTimeText = ?, updatedAt = ? WHERE id = ?',
      [studyTimeText ?? '', now, existing.id]
    );
  } else {
    db.runSync(
      'INSERT INTO task_study_logs (id, taskId, periodKey, studyTimeText, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
      [uuid(), taskId, periodKey, studyTimeText ?? '', now, now]
    );
  }
}

export { uuid };
