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
import { findOrCreateCategoryByName } from './categoryRepository';

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

// Aynı görev üzerinde art arda gelen işlemleri (hızlı çift dokunuş vb.) sıraya koyar.
// Böylece "oku → hesapla → yaz" adımları iç içe girip çift JP / kayıp güncelleme üretmez.
const taskOperationQueues = new Map();
function withTaskLock(taskId, fn) {
  const previous = taskOperationQueues.get(taskId) || Promise.resolve();
  const next = previous.catch(() => {}).then(fn);
  const tracked = next.finally(() => {
    if (taskOperationQueues.get(taskId) === tracked) taskOperationQueues.delete(taskId);
  });
  // Zincir hatası bir sonraki işlemi engellemesin; hata çağırana "next" üzerinden gider.
  tracked.catch(() => {});
  taskOperationQueues.set(taskId, tracked);
  return next;
}

// Birden fazla ifadeyi TEK atomik işlemde çalıştırır (ya hepsi yazılır ya hiçbiri).
async function runAtomic(db, stmts) {
  if (!stmts || stmts.length === 0) return;
  if (typeof db.batchAsync === 'function') {
    await db.batchAsync(stmts);
    return;
  }
  for (const s of stmts) {
    await db.runAsync(s.sql, s.args || []);
  }
}

// Cüzdan hareketi + bakiye güncellemesi için atomik batch ifadeleri üretir.
function buildWalletStatements(userId, amount, reason, relatedTaskId = null, relatedRewardId = null) {
  return [
    {
      sql: `INSERT INTO wallet_transactions (id, userId, amount, reason, relatedTaskId, relatedRewardId, createdAt)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [uuid(), userId, amount, reason, relatedTaskId, relatedRewardId, Date.now()],
    },
    {
      sql: `INSERT INTO wallet (userId, balance) VALUES (?, ?)
            ON CONFLICT(userId) DO UPDATE SET balance = balance + excluded.balance`,
      args: [userId, amount],
    },
  ];
}

export async function createTask({ title, description, categoryId, priority, period, intervalValue = 1, subtaskCount, subtaskLabels, assignedByUserId, assignedByName }) {
  const db = getDb();
  const id = uuid();
  const now = Date.now();
  const count = Math.max(1, parseInt(subtaskCount, 10) || 1);
  const interval = period === 'ONCE' ? 1 : Math.max(1, parseInt(intervalValue, 10) || 1);
  const labelsJson = subtaskLabels && subtaskLabels.some((l) => l && l.trim())
    ? JSON.stringify(subtaskLabels.map((l) => (l || '').trim()))
    : null;

  const descText = typeof description === 'string' && description.trim() ? description.trim() : null;

  await db.runAsync(
    `INSERT INTO tasks (id, title, description, categoryId, priority, period, intervalValue, ownerUserId, assignedByUserId, assignedByName, assignmentStatus, subtaskCount, subtaskLabels, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'me', ?, ?, ?, ?, ?, ?)`,
    [
      id,
      title,
      descText,
      categoryId ?? null,
      priority ?? 'MEDIUM',
      period ?? 'DAILY',
      interval,
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
const inFlightAssignmentCreates = new Map();
export function createTaskFromAssignment(assignedTask) {
  // Aynı atama için eşzamanlı iki çağrı (kabul butonu + arka plan eşitleyici)
  // mükerrer görev oluşturmasın: devam eden işlemi paylaş.
  const key = assignedTask?.id;
  if (!key) return Promise.reject(new Error('Geçersiz atama kaydı.'));
  const existingRun = inFlightAssignmentCreates.get(key);
  if (existingRun) return existingRun;
  const run = createTaskFromAssignmentInner(assignedTask).finally(() => {
    if (inFlightAssignmentCreates.get(key) === run) inFlightAssignmentCreates.delete(key);
  });
  inFlightAssignmentCreates.set(key, run);
  return run;
}

async function createTaskFromAssignmentInner(assignedTask) {
  const db = getDb();
  const existing = await db.getFirstAsync(
    'SELECT id FROM tasks WHERE firestoreAssignmentId = ?',
    [assignedTask.id]
  );
  if (existing) return existing.id;

  const id = uuid();
  const now = Date.now();
  const count = Math.max(1, parseInt(assignedTask.subtaskCount, 10) || 1);
  const interval = assignedTask.period === 'ONCE' ? 1 : Math.max(1, parseInt(assignedTask.intervalValue, 10) || 1);
  const labelsJson = assignedTask.subtaskLabels && assignedTask.subtaskLabels.length
    ? JSON.stringify(assignedTask.subtaskLabels)
    : null;
  const descText = typeof assignedTask.description === 'string' && assignedTask.description.trim()
    ? assignedTask.description.trim()
    : null;

  // Kategori eşleme: categoryName varsa B'nin kategorilerinde bul veya oluştur
  const categoryId = await findOrCreateCategoryByName(assignedTask.categoryName);

  await db.runAsync(
    `INSERT INTO tasks (id, title, description, categoryId, priority, period, intervalValue, ownerUserId, assignedByUserId, assignedByName, assignmentDirection, assignmentStatus, subtaskCount, subtaskLabels, firestoreAssignmentId, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'me', ?, ?, 'RECEIVED', 'ACCEPTED', ?, ?, ?, ?)`,
    [
      id,
      assignedTask.title,
      descText,
      categoryId,
      assignedTask.priority,
      assignedTask.period,
      interval,
      assignedTask.assignedByUid,
      assignedTask.assignedByName,
      count,
      labelsJson,
      assignedTask.id,
      now,
    ]
  );
  return id;
}

// Ben bir arkadaşıma görev attığımda, kendi tarafımda da (takip edebilmem için)
// bir kayıt oluşturulur — direction: 'SENT'. Bu görev BENİM tarafımdan
// tamamlanamaz (sadece izleme amaçlı), UI'da bunu ayırt etmemiz gerekir.
export async function createSentTaskRecord({ title, description, priority, period, intervalValue = 1, subtaskCount, subtaskLabels, assignedToUserId, assignedToName, firestoreAssignmentId }) {
  const db = getDb();
  const id = uuid();
  const now = Date.now();
  const count = Math.max(1, parseInt(subtaskCount, 10) || 1);
  const interval = period === 'ONCE' ? 1 : Math.max(1, parseInt(intervalValue, 10) || 1);
  const labelsJson = subtaskLabels && subtaskLabels.some((l) => l && l.trim())
    ? JSON.stringify(subtaskLabels.map((l) => (l || '').trim()))
    : null;
  const descText = typeof description === 'string' && description.trim() ? description.trim() : null;

  await db.runAsync(
    `INSERT INTO tasks (id, title, description, categoryId, priority, period, intervalValue, ownerUserId, assignedToUserId, assignedToName, assignmentDirection, assignmentStatus, subtaskCount, subtaskLabels, firestoreAssignmentId, createdAt)
     VALUES (?, ?, ?, NULL, ?, ?, ?, 'me', ?, ?, 'SENT', 'ACCEPTED', ?, ?, ?, ?)`,
    [id, title, descText, priority, period, interval, assignedToUserId, assignedToName, count, labelsJson, firestoreAssignmentId ?? null, now]
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

export async function updateTask(taskId, {
  title,
  description,
  categoryId,
  priority,
  period,
  intervalValue = 1,
  subtaskCount,
  subtaskLabels,
  resetStats = false,
}) {
  const db = getDb();
  const task = await findTaskByIdOrFirestoreId(taskId);
  if (!task) throw new Error('Görev bulunamadı.');

  if (task.assignmentDirection === 'RECEIVED') {
    throw new Error('Bu görevi bir arkadaşın sana atadığı için sadece görevi atan kişi düzenleyebilir.');
  }

  const cleanTitle = (title || '').trim();
  if (!cleanTitle) throw new Error('Lütfen bir görev adı gir.');

  const descText = typeof description === 'string' && description.trim() ? description.trim() : null;
  const isOnce = period === 'ONCE';
  const count = isOnce ? 1 : Math.max(1, parseInt(subtaskCount, 10) || 1);
  const interval = isOnce ? 1 : Math.max(1, parseInt(intervalValue, 10) || task.intervalValue || 1);
  const labelsJson = isOnce
    ? null
    : (subtaskLabels && subtaskLabels.some((l) => l && l.trim())
      ? JSON.stringify(subtaskLabels.map((l) => (l || '').trim()))
      : null);

  const periodChanged = period !== task.period;
  const intervalChanged = interval !== (task.intervalValue || 1);
  const shouldReset = resetStats || periodChanged || intervalChanged;

  if (shouldReset) {
    const now = Date.now();
    const stmts = [
      {
        sql: 'DELETE FROM task_records WHERE taskId = ?',
        args: [task.id],
      },
      {
        sql: `UPDATE tasks
              SET title = ?, description = ?, categoryId = ?, priority = ?, period = ?, intervalValue = ?, subtaskCount = ?, subtaskLabels = ?, createdAt = ?
              WHERE id = ?`,
        args: [
          cleanTitle,
          descText,
          categoryId ?? null,
          priority ?? 'MEDIUM',
          period ?? 'DAILY',
          interval,
          count,
          labelsJson,
          now,
          task.id,
        ],
      },
    ];

    if (typeof db.batchAsync === 'function') {
      await db.batchAsync(stmts);
    } else {
      await db.runAsync('BEGIN TRANSACTION;');
      try {
        for (const s of stmts) {
          await db.runAsync(s.sql, s.args);
        }
        await db.runAsync('COMMIT;');
      } catch (err) {
        try {
          await db.runAsync('ROLLBACK;');
        } catch (_) {}
        throw err;
      }
    }
  } else {
    await db.runAsync(
      `UPDATE tasks
       SET title = ?, description = ?, categoryId = ?, priority = ?, period = ?, intervalValue = ?, subtaskCount = ?, subtaskLabels = ?
       WHERE id = ?`,
      [
        cleanTitle,
        descText,
        categoryId ?? null,
        priority ?? 'MEDIUM',
        period ?? 'DAILY',
        interval,
        count,
        labelsJson,
        task.id,
      ]
    );
  }
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
  const periodKey = getPeriodKey(task, new Date());
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
export function completeSubtask(taskId) {
  return withTaskLock(taskId, () => completeSubtaskInner(taskId));
}

async function completeSubtaskInner(taskId) {
  const db = getDb();
  const task = await db.getFirstAsync('SELECT * FROM tasks WHERE id = ?', [taskId]);
  if (!task) throw new Error('Görev bulunamadı');
  if (task.assignmentDirection === 'SENT') {
    throw new Error('Bu görevi sen atadın, tamamlama işlemi arkadaşına ait.');
  }

  const periodKey = getPeriodKey(task, new Date());
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

  // Kayıt + cüzdan hareketi + bakiye TEK atomik işlemde yazılır:
  // arada bağlantı kopsa bile "tamamlandı ama JP yok" durumu oluşmaz.
  const stmts = [];
  if (existing) {
    stmts.push({
      sql: `UPDATE task_records SET status = 'SUCCESSFUL', completedSubtasks = ?, completedAt = ?, jpEarned = ?, streakBonusEarned = ? WHERE id = ?`,
      args: [newCompleted, now, total, bonus, existing.id],
    });
  } else {
    stmts.push({
      sql: `INSERT INTO task_records (id, taskId, periodKey, status, completedSubtasks, completedAt, isLateMarked, jpEarned, streakBonusEarned)
            VALUES (?, ?, ?, 'SUCCESSFUL', ?, ?, 0, ?, ?)`,
      args: [uuid(), taskId, periodKey, newCompleted, now, total, bonus],
    });
  }
  stmts.push(...buildWalletStatements('me', total, 'TASK_COMPLETE', taskId));
  await runAtomic(db, stmts);

  triggerAutoCloudSyncForCurrentUser();
  return { alreadyComplete: false, completedSubtasks: newCompleted, subtaskCount: task.subtaskCount, fullyCompleted: true, bonus, total, newStreak, firestoreAssignmentId: task.firestoreAssignmentId };
}

// Yanlışlıkla basılan bir tamamlamayı geri alır. Eğer periyot SUCCESSFUL
// durumdaysa (tüm alt adımlar bitmişse), JP geri alınır ve durum PENDING'e
// döner (bir alt adım geri açılır). Streak otomatik olarak bir sonraki
// hesaplamada düzelir (bu periyot artık SUCCESSFUL olmadığı için).
export function uncompleteSubtask(taskId) {
  return withTaskLock(taskId, () => uncompleteSubtaskInner(taskId));
}

async function uncompleteSubtaskInner(taskId) {
  const db = getDb();
  const task = await db.getFirstAsync('SELECT * FROM tasks WHERE id = ?', [taskId]);
  if (!task) throw new Error('Görev bulunamadı');

  const periodKey = getPeriodKey(task, new Date());
  const existing = await db.getFirstAsync(
    'SELECT * FROM task_records WHERE taskId = ? AND periodKey = ?',
    [taskId, periodKey]
  );
  if (!existing || existing.completedSubtasks <= 0) {
    return { completedSubtasks: 0, subtaskCount: task.subtaskCount, firestoreAssignmentId: task.firestoreAssignmentId };
  }

  const wasSuccessful = existing.status === 'SUCCESSFUL';
  const newCompleted = existing.completedSubtasks - 1;

  // JP iadesi ve kayıt güncellemesi tek atomik işlemde yapılır.
  const stmts = [];
  if (wasSuccessful && existing.jpEarned) {
    stmts.push(...buildWalletStatements('me', -existing.jpEarned, 'TASK_COMPLETE', taskId));
  }

  if (newCompleted <= 0) {
    // Hiç alt adım kalmadıysa kaydı tamamen sil (periyot yeniden PENDING sayılır).
    stmts.push({ sql: 'DELETE FROM task_records WHERE id = ?', args: [existing.id] });
  } else {
    // Kısmi tamamlama durumuna geri döndür (SUCCESSFUL -> PENDING_PARTIAL).
    stmts.push({
      sql: `UPDATE task_records SET status = 'PENDING_PARTIAL', completedSubtasks = ?, completedAt = NULL, jpEarned = 0, streakBonusEarned = 0 WHERE id = ?`,
      args: [newCompleted, existing.id],
    });
  }
  await runAtomic(db, stmts);

  triggerAutoCloudSyncForCurrentUser();
  return { completedSubtasks: newCompleted, subtaskCount: task.subtaskCount, firestoreAssignmentId: task.firestoreAssignmentId };
}

// 7 gün içinde kaçırılmış eski bir periyodu sonradan "tamamlandı" olarak işaretler.
export async function lateMarkTaskComplete(taskId, periodKey) {
  const db = getDb();
  const task = await db.getFirstAsync('SELECT * FROM tasks WHERE id = ?', [taskId]);
  if (!task) throw new Error('Görev bulunamadı');

  const periodEnd = getPeriodEndTimestamp(task, periodKey);
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

  const periodEnd = getPeriodEndTimestamp(task, periodKey);
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

export async function cleanupInvalidPastRecords() {
  let db;
  try {
    db = getDb();
  } catch (e) {
    return;
  }
  if (!db) return;

  const tasks = await db.getAllAsync(`SELECT * FROM tasks`);
  for (const task of tasks) {
    if (!task.createdAt) continue;
    const startPeriodKey = getPeriodKey(task, new Date(task.createdAt));
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
    const startPeriodKey = getPeriodKey(task, new Date(task.createdAt || Date.now()));
    const periodKey = getPeriodKey(task, new Date());
    let checkKey = periodKey;

    for (let i = 0; i < 60; i++) {
      if (checkKey < startPeriodKey) break;

      const endTs = getPeriodEndTimestamp(task, checkKey);
      if (endTs > now) {
        checkKey = getPreviousPeriodKey(task, checkKey);
        continue;
      }

      const existing = recordsMap.get(`${task.id}_${checkKey}`);
      if (!existing) {
        missingInserts.push({ taskId: task.id, periodKey: checkKey });
      } else if (existing.status === 'PENDING_PARTIAL') {
        partialUpdates.push(existing.id);
      }
      checkKey = getPreviousPeriodKey(task, checkKey);
    }
  }

  // Tüm yazmalar tek tek HTTP isteği yerine 200'lük paketlerle gönderilir
  // (uzun aradan sonra açılışta yüzlerce paralel istek atılmasını önler).
  const stmts = [
    ...missingInserts.map((rec) => ({
      sql: `INSERT OR IGNORE INTO task_records (id, taskId, periodKey, status, jpEarned) VALUES (?, ?, ?, 'FAILED', 0)`,
      args: [uuid(), rec.taskId, rec.periodKey],
    })),
    // completedSubtasks alanına dokunulmaz: yarım kalan sayı korunur.
    // calculateCompletionStats ve geçmiş listesi ("2/3 yapıldı") bu değeri kullanır.
    // "AND status = 'PENDING_PARTIAL'" koşulu: bu arada başka cihazda tamamlandıysa ezme.
    ...partialUpdates.map((id) => ({
      sql: `UPDATE task_records SET status = 'FAILED' WHERE id = ? AND status = 'PENDING_PARTIAL'`,
      args: [id],
    })),
  ];

  const CHUNK_SIZE = 200;
  for (let i = 0; i < stmts.length; i += CHUNK_SIZE) {
    await runAtomic(db, stmts.slice(i, i + CHUNK_SIZE));
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

export const WALLET_TRANSACTION_LABELS = {
  BUY_STREAK_FREEZE: 'Seri dondurma rozeti (kaldırıldı)',
  FREEZE_REFUND: 'Seri dondurma iadesi',
  TASK_COMPLETE: 'Görev tamamlama',
  STREAK_BONUS: 'Seri tamamlama bonusu',
  REWARD_REDEEM: 'Ödül kullanımı',
  FOCUS_SESSION: 'Odaklanma seansı',
};

export function formatWalletTransactionReason(reason) {
  return WALLET_TRANSACTION_LABELS[reason] || reason || 'Cüzdan hareketi';
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
  if (!assignedTaskDoc || !assignedTaskDoc.id) return false;
  let db;
  try {
    db = getDb();
  } catch (_) {
    return false;
  }
  if (!db) return false;

  const firestoreId = assignedTaskDoc.id;
  const existing = await db.getFirstAsync(
    'SELECT * FROM tasks WHERE firestoreAssignmentId = ?',
    [firestoreId]
  );
  if (!existing) return false;

  const newTitle = (assignedTaskDoc.title || '').trim();
  if (!newTitle) return false;

  const newDesc =
    typeof assignedTaskDoc.description === 'string' && assignedTaskDoc.description.trim()
      ? assignedTaskDoc.description.trim()
      : null;

  // Alt görev etiketleri (mevcut subtaskCount ile uyumlu tutulur)
  const currentCount = Math.max(1, existing.subtaskCount || 1);
  let newLabelsJson = null;
  if (Array.isArray(assignedTaskDoc.subtaskLabels)) {
    const labels = [];
    for (let i = 0; i < currentCount; i++) {
      labels.push(String(assignedTaskDoc.subtaskLabels[i] || '').trim());
    }
    newLabelsJson = JSON.stringify(labels);
  }

  // Kategori eşleme: B'nin kategorilerinde isimle ara veya yeni oluştur (yoksa null)
  let targetCategoryId = null;
  if (assignedTaskDoc.categoryName && typeof assignedTaskDoc.categoryName === 'string') {
    targetCategoryId = await findOrCreateCategoryByName(assignedTaskDoc.categoryName);
  }

  // Değişiklik kontrolü (Idempotency: Aynı değerlerle çift yazma yapma)
  const currentTitle = (existing.title || '').trim();
  const currentDesc = existing.description ? existing.description.trim() : null;
  const currentLabels = existing.subtaskLabels || null;
  const currentCategoryId = existing.categoryId || null;

  const titleChanged = currentTitle !== newTitle;
  const descChanged = currentDesc !== newDesc;
  const labelsChanged = currentLabels !== newLabelsJson;
  const categoryChanged = currentCategoryId !== targetCategoryId;

  if (!titleChanged && !descChanged && !labelsChanged && !categoryChanged) {
    return false;
  }

  // Kural: B görevi kabul ettikten sonra yerel kopyada SADECE title, description,
  // subtaskLabels ve categoryId güncellenir.
  // Periyot, intervalValue, subtaskCount, priority, kayıtlar, seri ve tamamlama durumuna DOKUNULMAZ.
  await db.runAsync(
    `UPDATE tasks
     SET title = ?, description = ?, subtaskLabels = ?, categoryId = ?
     WHERE id = ?`,
    [newTitle, newDesc, newLabelsJson, targetCategoryId, existing.id]
  );

  triggerAutoCloudSyncForCurrentUser();
  return true;
}

// Atanan kişi: Firestore'da silinmiş veya artık aktif olmayan görevleri kendi SQLite veritabanından kaldırır
export async function syncReceivedTasksWithFirestore(activeFirestoreAssignedTasks) {
  // Dönüş: { deletedAny, localAssignmentIds } — localAssignmentIds, eşitleme SONRASI
  // yerelde bulunan atama (Firestore doküman) kimlikleridir.
  const emptyResult = { deletedAny: false, localAssignmentIds: new Set() };
  let db;
  try {
    db = getDb();
  } catch (e) {
    return null;
  }
  if (!db) return null;

  // Geçerli bir liste gelmediyse hiçbir şeyi silme (boş liste "hepsi silindi" demek DEĞİLDİR
  // kararını çağıran taraf fromCache kontrolüyle verir; burada sadece tip güvenliği).
  if (!Array.isArray(activeFirestoreAssignedTasks)) return null;

  const localReceived = await db.getAllAsync(
    `SELECT id, firestoreAssignmentId FROM tasks WHERE assignmentDirection = 'RECEIVED' AND firestoreAssignmentId IS NOT NULL`
  );
  if (!localReceived || localReceived.length === 0) return emptyResult;

  const activeDocIds = new Set(
    Array.isArray(activeFirestoreAssignedTasks)
      ? activeFirestoreAssignedTasks.map((t) => t.id)
      : []
  );

  let deletedAny = false;
  const localAssignmentIds = new Set();
  for (const localTask of localReceived) {
    if (!activeDocIds.has(localTask.firestoreAssignmentId)) {
      await runAtomic(db, [
        { sql: 'DELETE FROM task_records WHERE taskId = ?', args: [localTask.id] },
        { sql: 'DELETE FROM task_study_logs WHERE taskId = ?', args: [localTask.id] },
        { sql: 'UPDATE wallet_transactions SET relatedTaskId = NULL WHERE relatedTaskId = ?', args: [localTask.id] },
        { sql: 'DELETE FROM tasks WHERE id = ?', args: [localTask.id] },
      ]);
      deletedAny = true;
    } else {
      localAssignmentIds.add(localTask.firestoreAssignmentId);
    }
  }
  if (deletedAny) {
    triggerAutoCloudSyncForCurrentUser();
  }
  return { deletedAny, localAssignmentIds };
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

// ONCE görevlerinin task_records kayıtlarını tekil 'ONCE' periodKey'ine dönüştürür (Migrasyon).
export async function migrateOnceRecords() {
  const db = getDb();
  console.log('🚀 ONCE görevleri migrasyonu başlatılıyor...');

  const onceTasks = (await db.getAllAsync(
    "SELECT id, title FROM tasks WHERE period = 'ONCE'"
  )) || [];
  console.log(`📋 Toplam ${onceTasks.length} adet ONCE görev bulundu.`);

  let totalUpdated = 0;
  let totalDeleted = 0;

  for (const task of onceTasks) {
    const records = (await db.getAllAsync(
      'SELECT id, periodKey, status, completedAt FROM task_records WHERE taskId = ? ORDER BY COALESCE(completedAt, 0) DESC, id DESC',
      [task.id]
    )) || [];

    if (records.length === 0) continue;

    const keepRecord = records[0];
    const duplicateRecords = records.slice(1);

    if (duplicateRecords.length > 0) {
      for (const dup of duplicateRecords) {
        await db.runAsync('DELETE FROM task_records WHERE id = ?', [dup.id]);
        totalDeleted++;
      }
    }

    if (keepRecord.periodKey !== 'ONCE') {
      await db.runAsync("UPDATE task_records SET periodKey = 'ONCE' WHERE id = ?", [keepRecord.id]);
      totalUpdated++;
    }
  }

  const msg = `✅ Migrasyon tamamlandı: ${totalUpdated} kayıt 'ONCE' yapıldı, ${totalDeleted} eski/mükerrer kayıt silindi.`;
  console.log(msg);
  triggerAutoCloudSyncForCurrentUser();
  return msg;
}

/**
 * Tek seferlik migrasyon: Seri dondurma (streak freeze) özelliğini kaldırır.
 * İdempotent: app_meta tablosunda 'freeze_removed_v1' anahtarı varsa hiçbir şey yapmaz.
 * 1. task_records tablosunda 'FROZEN' olan kayıtları 'FAILED' yapar.
 * 2. streak_freeze_count > 0 ise cüzdana n * 50 JP iade eder (tür: FREEZE_REFUND).
 * 3. streak_freeze_count anahtarını siler.
 * 4. freeze_removed_v1 anahtarını yazar.
 * Adım 1-4 tek bir batch/transaction içinde atomik olarak yürütülür.
 */
export async function migrateFreezeRemoval(dbInstance = null) {
  const db = dbInstance || getDb();
  if (!db) return;

  const existingMeta = await db.getFirstAsync(
    "SELECT value FROM app_meta WHERE key = 'freeze_removed_v1'"
  );
  if (existingMeta) return;

  const frozenCountRow = await db.getFirstAsync(
    "SELECT COUNT(*) as count FROM task_records WHERE status = 'FROZEN'"
  );
  const frozenCount = frozenCountRow ? (Number(frozenCountRow.count) || 0) : 0;

  const freezeCountRow = await db.getFirstAsync(
    "SELECT value FROM app_meta WHERE key = 'streak_freeze_count'"
  );
  const n = freezeCountRow ? Math.max(0, parseInt(freezeCountRow.value, 10) || 0) : 0;
  const refundAmount = n * 50;

  const stmts = [
    {
      sql: "UPDATE task_records SET status = 'FAILED' WHERE status = 'FROZEN'",
      args: [],
    },
  ];

  if (refundAmount > 0) {
    stmts.push({
      sql: `INSERT INTO wallet_transactions (id, userId, amount, reason, relatedTaskId, relatedRewardId, createdAt)
            VALUES (?, 'me', ?, 'FREEZE_REFUND', NULL, NULL, ?)`,
      args: [uuid(), refundAmount, Date.now()],
    });
    stmts.push({
      sql: `INSERT INTO wallet (userId, balance) VALUES ('me', ?)
            ON CONFLICT(userId) DO UPDATE SET balance = balance + excluded.balance`,
      args: [refundAmount],
    });
  }

  stmts.push({
    sql: "DELETE FROM app_meta WHERE key = 'streak_freeze_count'",
    args: [],
  });

  stmts.push({
    sql: "INSERT OR REPLACE INTO app_meta (key, value) VALUES ('freeze_removed_v1', 'true')",
    args: [],
  });

  if (typeof db.batchAsync === 'function') {
    await db.batchAsync(stmts);
  } else {
    await db.runAsync('BEGIN TRANSACTION;');
    try {
      for (const s of stmts) {
        await db.runAsync(s.sql, s.args);
      }
      await db.runAsync('COMMIT;');
    } catch (err) {
      try {
        await db.runAsync('ROLLBACK;');
      } catch (_) {}
      throw err;
    }
  }

  console.log(
    `[Migration] Seri dondurma özelliği kaldırıldı: ${frozenCount} kayıt FAILED yapıldı, ${refundAmount} JP iade edildi.`
  );
}

/**
 * Tek seferlik onarım migrasyonu (once_cleanup_v1):
 * - period = 'ONCE' olan görevlerin periodKey değeri 'ONCE' OLMAYAN ve status'u FAILED olan task_records satırlarını siler.
 *   (SUCCESSFUL ve PENDING_PARTIAL kayıtlara dokunmaz).
 * - period = 'ONCE' olup subtaskCount > 1 veya intervalValue > 1 olan görevlerde bu değerleri 1'e çeker.
 * - İdempotenttir, tek atomik batch içinde çalışır ve app_meta'ya 'once_cleanup_v1' bayrağını yazar.
 */
export async function migrateOnceCleanup(dbInstance = null) {
  const db = dbInstance || getDb();
  if (!db) return;

  const existingMeta = await db.getFirstAsync(
    "SELECT value FROM app_meta WHERE key = 'once_cleanup_v1'"
  );
  if (existingMeta) return;

  try {
    const recordsToDeleteRow = await db.getFirstAsync(
      `SELECT COUNT(*) as count FROM task_records
       WHERE taskId IN (SELECT id FROM tasks WHERE period = 'ONCE')
         AND periodKey != 'ONCE'
         AND status = 'FAILED'`
    );
    const deleteCount = recordsToDeleteRow ? (Number(recordsToDeleteRow.count) || 0) : 0;

    const tasksToFixRow = await db.getFirstAsync(
      `SELECT COUNT(*) as count FROM tasks
       WHERE period = 'ONCE' AND (subtaskCount > 1 OR intervalValue > 1)`
    );
    const fixCount = tasksToFixRow ? (Number(tasksToFixRow.count) || 0) : 0;

    const stmts = [
      {
        sql: `DELETE FROM task_records
              WHERE taskId IN (SELECT id FROM tasks WHERE period = 'ONCE')
                AND periodKey != 'ONCE'
                AND status = 'FAILED'`,
        args: [],
      },
      {
        sql: `UPDATE tasks
              SET subtaskCount = 1, intervalValue = 1
              WHERE period = 'ONCE' AND (subtaskCount > 1 OR intervalValue > 1)`,
        args: [],
      },
      {
        sql: "INSERT OR REPLACE INTO app_meta (key, value) VALUES ('once_cleanup_v1', 'true')",
        args: [],
      },
    ];

    if (typeof db.batchAsync === 'function') {
      await db.batchAsync(stmts);
    } else {
      await db.runAsync('BEGIN TRANSACTION;');
      try {
        for (const s of stmts) {
          await db.runAsync(s.sql, s.args);
        }
        await db.runAsync('COMMIT;');
      } catch (err) {
        try {
          await db.runAsync('ROLLBACK;');
        } catch (_) {}
        throw err;
      }
    }

    console.log(`[Migration] Tek seferlik onarım: ${deleteCount} kayıt silindi, ${fixCount} görev düzeltildi`);
    triggerAutoCloudSyncForCurrentUser();
  } catch (_) {
    // Hata durumunda hiçbir şey yazılmaz, sonraki açılışta tekrar dener
  }
}

if (typeof window !== 'undefined' && import.meta.env?.DEV) {
  window.migrateOnceRecords = migrateOnceRecords;
  window.migrateFreezeRemoval = migrateFreezeRemoval;
  window.migrateOnceCleanup = migrateOnceCleanup;
}
