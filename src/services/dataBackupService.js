// J-Planning — Veri Yedekleme ve Geri Yükleme Servisi (Web)
//
// Kullanıcının TÜM yerel verilerini (kategoriler, görevler, periyot kayıtları,
// cüzdan bakiyesi, işlem geçmişi, ödüller, arkadaşlar, odaklanma seansları,
// bildirim tercihleri) tek bir JSON dosyası olarak dışa aktarır ve doğrulanmış
// olarak geri yükler.

import { getDb } from '../db/database';
import { getSchedules, replaceAllSchedules } from './notificationService';

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
    // Zamanlamalar sunucudadır; okunamazsa yedek yine de alınır.
    notificationSchedules: await getSchedules().catch(() => []),
  };

  const jsonString = JSON.stringify(backupData, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  // Dosya adındaki tarih YEREL güne göre (toISOString UTC verir, gece yarısından sonra dünü gösterirdi)
  const nowLocal = new Date();
  const dateStr = `${nowLocal.getFullYear()}-${String(nowLocal.getMonth() + 1).padStart(2, '0')}-${String(nowLocal.getDate()).padStart(2, '0')}`;
  const fileName = `jplanning-backup-${dateStr}.json`;

  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Hemen iptal edilirse bazı mobil tarayıcılarda indirme başlamadan kesilir
  setTimeout(() => URL.revokeObjectURL(url), 10000);
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
  const FUTURE_LIMIT = Date.now() + 8640000000;

  // ÖNEMLİ: Önce TÜM ifadeler bellekte hazırlanır ve doğrulanır, sonra TEK atomik
  // işlemde (batch) çalıştırılır. Böylece işlem yarıda kesilirse (ağ kopması, bozuk
  // satır) mevcut veriler OLDUĞU GİBİ kalır; "silindi ama geri yüklenemedi" durumu oluşmaz.
  const deletes = [];
  const inserts = [];

  // Silme sırası: önce bağımlı (çocuk) tablolar, sonra ana tablolar.
  if (Array.isArray(tables.task_study_logs)) deletes.push({ sql: 'DELETE FROM task_study_logs', args: [] });
  if (Array.isArray(tables.task_records)) deletes.push({ sql: 'DELETE FROM task_records', args: [] });
  if (Array.isArray(tables.tasks)) {
    // Görevler değişiyorsa, eski görevlere bağlı kayıtlar yedekte olmasa bile öksüz kalmasın.
    if (!Array.isArray(tables.task_study_logs)) deletes.push({ sql: 'DELETE FROM task_study_logs', args: [] });
    if (!Array.isArray(tables.task_records)) deletes.push({ sql: 'DELETE FROM task_records', args: [] });
    deletes.push({ sql: 'DELETE FROM tasks', args: [] });
  }
  if (Array.isArray(tables.categories)) {
    // Kategoriler yenilenirken yedekte görev tablosu yoksa, mevcut görevlerin kategori bağı koparılır.
    if (!Array.isArray(tables.tasks)) deletes.push({ sql: 'UPDATE tasks SET categoryId = NULL', args: [] });
    deletes.push({ sql: 'DELETE FROM categories', args: [] });
  }
  if (Array.isArray(tables.wallet_transactions)) deletes.push({ sql: 'DELETE FROM wallet_transactions', args: [] });
  if (Array.isArray(tables.wallet)) deletes.push({ sql: 'DELETE FROM wallet', args: [] });
  if (Array.isArray(tables.rewards)) deletes.push({ sql: 'DELETE FROM rewards', args: [] });
  if (Array.isArray(tables.focus_sessions)) deletes.push({ sql: 'DELETE FROM focus_sessions', args: [] });
  if (Array.isArray(tables.daily_notes)) deletes.push({ sql: 'DELETE FROM daily_notes', args: [] });

  // Ekleme sırası: önce ana tablolar (kategori → görev), sonra bağımlılar.
  const categoryIds = new Set();
  if (Array.isArray(tables.categories)) {
    for (const row of tables.categories) {
      if (!row || !row.id || !row.name) continue;
      const id = sanitizeString(row.id, 100);
      if (categoryIds.has(id)) continue; // mükerrer birincil anahtar tüm işlemi düşürmesin
      categoryIds.add(id);
      inserts.push({
        sql: 'INSERT INTO categories (id, name, color, createdAt) VALUES (?, ?, ?, ?)',
        args: [
          id,
          sanitizeString(row.name, 100),
          row.color ? sanitizeString(row.color, 30) : '#C98A2C',
          sanitizeInt(row.createdAt, 0, FUTURE_LIMIT, Date.now()),
        ],
      });
    }
  }

  const taskIds = new Set();
  if (Array.isArray(tables.tasks)) {
    for (const row of tables.tasks) {
      if (!row || !row.id || !row.title) continue;
      const id = sanitizeString(row.id, 100);
      if (taskIds.has(id)) continue;
      taskIds.add(id);
      const period = sanitizeEnum(row.period, VALID_PERIODS, 'DAILY');
      // Kategori yedekte de yenileniyorsa ve bu kategori yedekte yoksa bağı kopar (geçersiz referans olmasın)
      let categoryId = row.categoryId ? sanitizeString(row.categoryId, 100) : null;
      if (categoryId && Array.isArray(tables.categories) && !categoryIds.has(categoryId)) categoryId = null;
      inserts.push({
        sql: `INSERT INTO tasks (id, title, description, notes, categoryId, priority, period, intervalValue, ownerUserId, assignedByUserId, assignedByName, assignedToUserId, assignedToName, assignmentDirection, firestoreAssignmentId, assignmentStatus, subtaskCount, subtaskLabels, isArchived, createdAt)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id,
          sanitizeString(row.title, 300),
          row.description ? sanitizeString(row.description, 1000) : null,
          row.notes ? sanitizeString(row.notes, 5000) : null,
          categoryId,
          sanitizeEnum(row.priority, VALID_PRIORITIES, 'MEDIUM'),
          period,
          // "N günde/haftada/ayda bir" aralığı. Eski yedeklerde bu alan yoksa 1 kabul edilir.
          period === 'ONCE' ? 1 : sanitizeInt(row.intervalValue, 1, 365, 1),
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
          sanitizeInt(row.createdAt, 0, FUTURE_LIMIT, Date.now()),
        ],
      });
    }
  }

  if (Array.isArray(tables.task_records)) {
    const seenIds = new Set();
    const seenPairs = new Set(); // UNIQUE(taskId, periodKey)
    for (const row of tables.task_records) {
      if (!row || !row.id || !row.taskId || !row.periodKey) continue;
      const id = sanitizeString(row.id, 100);
      const taskId = sanitizeString(row.taskId, 100);
      const periodKey = sanitizeString(row.periodKey, 30);
      const pairKey = `${taskId}|${periodKey}`;
      if (seenIds.has(id) || seenPairs.has(pairKey)) continue;
      // Görevi yedekte bulunmayan kayıtları atla (öksüz kayıt / yabancı anahtar hatası olmasın)
      if (Array.isArray(tables.tasks) && !taskIds.has(taskId)) continue;
      seenIds.add(id);
      seenPairs.add(pairKey);
      let recordStatus = sanitizeString(row.status || 'FAILED', 30);
      if (recordStatus === 'FROZEN') {
        recordStatus = 'FAILED';
      }
      inserts.push({
        sql: `INSERT INTO task_records (id, taskId, periodKey, status, completedSubtasks, completedAt, isLateMarked, lateMarkedAt, jpEarned, streakBonusEarned)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id,
          taskId,
          periodKey,
          recordStatus,
          sanitizeInt(row.completedSubtasks, 0, 100, 0),
          row.completedAt ? sanitizeInt(row.completedAt, 0, FUTURE_LIMIT, Date.now()) : null,
          row.isLateMarked ? 1 : 0,
          row.lateMarkedAt ? sanitizeInt(row.lateMarkedAt, 0, FUTURE_LIMIT, Date.now()) : null,
          sanitizeInt(row.jpEarned, 0, 10000, 0),
          sanitizeInt(row.streakBonusEarned, 0, 1000, 0),
        ],
      });
    }
  }

  if (Array.isArray(tables.wallet)) {
    const seen = new Set();
    for (const row of tables.wallet) {
      if (!row) continue;
      const userId = sanitizeString(row.userId || 'me', 100);
      if (seen.has(userId)) continue;
      seen.add(userId);
      inserts.push({
        sql: 'INSERT INTO wallet (userId, balance) VALUES (?, ?)',
        args: [userId, sanitizeInt(row.balance, 0, 1000000, 0)],
      });
    }
    // Yedekte cüzdan satırı yoksa bile uygulamanın beklediği 'me' cüzdanı var olsun
    if (!seen.has('me')) {
      inserts.push({ sql: "INSERT INTO wallet (userId, balance) VALUES ('me', 0)", args: [] });
    }
  }

  if (Array.isArray(tables.wallet_transactions)) {
    const seen = new Set();
    for (const row of tables.wallet_transactions) {
      if (!row || !row.id) continue;
      const id = sanitizeString(row.id, 100);
      if (seen.has(id)) continue;
      seen.add(id);
      inserts.push({
        sql: `INSERT INTO wallet_transactions (id, userId, amount, reason, relatedTaskId, relatedRewardId, createdAt)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id,
          sanitizeString(row.userId || 'me', 100),
          sanitizeInt(row.amount, -100000, 100000, 0),
          sanitizeString(row.reason || 'TRANSACTION', 50),
          row.relatedTaskId ? sanitizeString(row.relatedTaskId, 100) : null,
          row.relatedRewardId ? sanitizeString(row.relatedRewardId, 100) : null,
          sanitizeInt(row.createdAt, 0, FUTURE_LIMIT, Date.now()),
        ],
      });
    }
  }

  if (Array.isArray(tables.rewards)) {
    const seen = new Set();
    for (const row of tables.rewards) {
      if (!row || !row.id || !row.title) continue;
      const id = sanitizeString(row.id, 100);
      if (seen.has(id)) continue;
      seen.add(id);
      inserts.push({
        sql: `INSERT INTO rewards (id, title, description, cost, ownerUserId, assignedByUserId, assignedByName, assignmentStatus, isRedeemed, redeemedAt, createdAt)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id,
          sanitizeString(row.title, 300),
          row.description ? sanitizeString(row.description, 1000) : null,
          sanitizeInt(row.cost, 0, 100000, 0),
          sanitizeString(row.ownerUserId || 'me', 100),
          row.assignedByUserId ? sanitizeString(row.assignedByUserId, 100) : null,
          row.assignedByName ? sanitizeString(row.assignedByName, 100) : null,
          sanitizeString(row.assignmentStatus || 'NONE', 30),
          row.isRedeemed ? 1 : 0,
          row.redeemedAt ? sanitizeInt(row.redeemedAt, 0, FUTURE_LIMIT, Date.now()) : null,
          sanitizeInt(row.createdAt, 0, FUTURE_LIMIT, Date.now()),
        ],
      });
    }
  }

  if (Array.isArray(tables.focus_sessions)) {
    const seen = new Set();
    for (const row of tables.focus_sessions) {
      if (!row || !row.id) continue;
      const id = sanitizeString(row.id, 100);
      if (seen.has(id)) continue;
      seen.add(id);
      const completedAt = sanitizeInt(row.completedAt, 0, FUTURE_LIMIT, Date.now());
      const fallbackDate = new Date(completedAt);
      const fallbackMonthKey = `${fallbackDate.getFullYear()}-${String(fallbackDate.getMonth() + 1).padStart(2, '0')}`;
      inserts.push({
        sql: `INSERT INTO focus_sessions (id, durationMinutes, soundKey, jpEarned, monthKey, completedAt, awardedMilestones)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id,
          sanitizeInt(row.durationMinutes, 1, 1440, 1),
          row.soundKey ? sanitizeString(row.soundKey, 50) : null,
          sanitizeInt(row.jpEarned, 0, 100, 0),
          /^\d{4}-\d{2}$/.test(String(row.monthKey || '')) ? String(row.monthKey) : fallbackMonthKey,
          completedAt,
          typeof row.awardedMilestones === 'string' ? sanitizeString(row.awardedMilestones, 200) : null,
        ],
      });
    }
  }

  if (Array.isArray(tables.daily_notes)) {
    const seenIds = new Set();
    const seenDates = new Set(); // dateKey UNIQUE
    for (const row of tables.daily_notes) {
      if (!row || !row.id || !row.dateKey || !row.content) continue;
      const id = sanitizeString(row.id, 100);
      const dateKey = sanitizeString(row.dateKey, 10);
      if (seenIds.has(id) || seenDates.has(dateKey)) continue;
      seenIds.add(id);
      seenDates.add(dateKey);
      inserts.push({
        sql: `INSERT INTO daily_notes (id, dateKey, content, studyTimeText, createdAt, updatedAt)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [
          id,
          dateKey,
          sanitizeString(row.content, 10000),
          row.studyTimeText ? sanitizeString(row.studyTimeText, 500) : null,
          sanitizeInt(row.createdAt, 0, FUTURE_LIMIT, Date.now()),
          sanitizeInt(row.updatedAt, 0, FUTURE_LIMIT, Date.now()),
        ],
      });
    }
  }

  if (Array.isArray(tables.task_study_logs)) {
    const seen = new Set();
    for (const row of tables.task_study_logs) {
      if (!row || !row.id || !row.taskId || !row.periodKey) continue;
      const id = sanitizeString(row.id, 100);
      const taskId = sanitizeString(row.taskId, 100);
      if (seen.has(id)) continue;
      if (Array.isArray(tables.tasks) && !taskIds.has(taskId)) continue;
      seen.add(id);
      inserts.push({
        sql: `INSERT INTO task_study_logs (id, taskId, periodKey, studyTimeText, createdAt, updatedAt)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [
          id,
          taskId,
          sanitizeString(row.periodKey, 30),
          sanitizeString(row.studyTimeText || '', 500),
          sanitizeInt(row.createdAt, 0, FUTURE_LIMIT, Date.now()),
          sanitizeInt(row.updatedAt, 0, FUTURE_LIMIT, Date.now()),
        ],
      });
    }
  }

  if (Array.isArray(tables.app_meta)) {
    for (const row of tables.app_meta) {
      if (!row || !row.key || row.key === 'streak_freeze_count') continue;
      inserts.push({
        sql: `INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        args: [sanitizeString(row.key, 100), sanitizeString(row.value, 1000)],
      });
    }
  }

  const allStatements = [...deletes, ...inserts];
  if (allStatements.length === 0) {
    throw new Error('Yedek dosyasında geri yüklenecek veri bulunamadı.');
  }

  try {
    if (typeof db.batchAsync === 'function') {
      await db.batchAsync(allStatements);
    } else {
      throw new Error('Veritabanı toplu yazmayı desteklemiyor.');
    }
  } catch (err) {
    console.error('Yedek geri yükleme hatası:', err);
    throw new Error(
      'Yedek geri yüklenemedi; mevcut verilerin olduğu gibi korundu. Lütfen bağlantını kontrol edip tekrar dene.'
    );
  }

  // Bildirim zamanlamaları veritabanı dışında (sunucuda) tutulur; veriler başarıyla
  // yazıldıktan sonra güncellenir. Bu adım başarısız olursa geri yükleme yine geçerlidir.
  if (Array.isArray(data.notificationSchedules)) {
    try {
      await replaceAllSchedules(data.notificationSchedules);
    } catch (e) {
      console.warn('Bildirim zamanlamaları geri yüklenemedi:', e);
    }
  }
}
