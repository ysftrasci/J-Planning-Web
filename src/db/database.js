// J-Planning — SQLite Veritabanı Katmanı (Web)
// Mobildeki src/db/database.js dosyasının web karşılığı. Şema ve migration
// mantığı BİREBİR aynı — sadece motor expo-sqlite yerine sql.js + IndexedDB
// (bkz. sqliteEngine.js).
//
// ÖNEMLİ: Veritabanı KULLANICIYA ÖZELDİR. Aynı tarayıcıda birden fazla hesaba
// (ör. aile üyeleri) giriş yapılabildiği için, her kullanıcının görevleri
// ayrı bir sql.js veritabanında saklanır (jplanning_{uid}.db — bu isim artık
// bir dosya değil, IndexedDB'deki anahtar/kayıt adıdır). Bu sayede bir
// hesaptan çıkıp başka hesapla girildiğinde görevler asla karışmaz.
// initDatabase(uid) uygulama açılışında DEĞİL, kullanıcı giriş yaptıktan
// SONRA (AuthContext üzerinden) çağrılmalıdır.
//
// FARK (mobile -> web): expo-sqlite'ın openDatabaseSync'i senkrondu; sql.js'in
// ilk yüklenmesi (wasm) ve IndexedDB'den okuma asenkron olduğu için
// switchToUserDatabase ve initDatabase burada ASYNC fonksiyonlardır. Bunun
// dışında (execSync/runSync/getFirstSync/getAllSync) tüm çağrılar senkron
// kalmaya devam eder — repository dosyaları neredeyse değişmeden taşınabildi.

import { openSqliteConnection, deleteDatabaseBytes } from './sqliteEngine';

let dbInstance = null;
let currentUid = null;

function dbNameForUser(uid) {
  // İsimde sorun çıkarabilecek karakterleri (Firebase uid'leri genelde
  // güvenlidir ama önlem amaçlı) temizle.
  const safeUid = String(uid).replace(/[^a-zA-Z0-9_-]/g, '');
  return `jplanning_${safeUid}.db`;
}

export function getDb() {
  if (!dbInstance) {
    throw new Error('Veritabanı henüz başlatılmadı. Önce initDatabase(uid) çağrılmalı.');
  }
  return dbInstance;
}

// Kullanıcı değiştiğinde (giriş/çıkış) önceki bağlantıyı kapatıp, yeni
// kullanıcının kendi veritabanını açar. Aynı kullanıcı için tekrar
// çağrılırsa (ör. React StrictMode / hot reload) mevcut bağlantı yeniden kullanılır.
export async function switchToUserDatabase(uid) {
  if (currentUid === uid && dbInstance) {
    return dbInstance;
  }
  if (dbInstance) {
    try {
      dbInstance.closeSync();
    } catch (e) {
      // Bağlantı zaten kapalıysa görmezden gel.
    }
  }
  dbInstance = await openSqliteConnection(dbNameForUser(uid));
  currentUid = uid;
  return dbInstance;
}

// Hesap silme akışında (services/deleteAccountService.js) kullanılır.
// Kullanıcının yerel SQLite veritabanını (görevler, kategoriler, ödüller,
// odaklanma geçmişi) IndexedDB'den tamamen kaldırır. Önce açık bağlantı
// varsa kapatılır, aksi halde IndexedDB üzerinde kilit/tutarsızlık oluşabilir.
export async function deleteUserDatabase(uid) {
  if (currentUid === uid && dbInstance) {
    try {
      dbInstance.closeSync();
    } catch (e) {
      // Bağlantı zaten kapalıysa görmezden gel.
    }
    dbInstance = null;
    currentUid = null;
  }
  await deleteDatabaseBytes(dbNameForUser(uid));
}

// Görev periyodu: DAILY | WEEKLY | MONTHLY
// Görev durumu: PENDING (süresi devam ediyor) | SUCCESSFUL | FAILED
// Öncelik: HIGH | MEDIUM | LOW  (JP karşılığı: 5 / 3 / 1 — bkz. utils/rewards.js)
// Alt görev (subtask): bir periyodun kaç kez yapılması gerektiği (ör. diş fırçalama
// günde 2 kez). subtaskCount=1 ise normal (eski) davranışla birebir aynı.

const CURRENT_SCHEMA_VERSION = 4;

export async function initDatabase(uid) {
  const db = await switchToUserDatabase(uid);

  db.execSync(`
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT,
      createdAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      categoryId TEXT,
      priority TEXT NOT NULL DEFAULT 'MEDIUM',       -- HIGH | MEDIUM | LOW
      period TEXT NOT NULL DEFAULT 'DAILY',          -- DAILY | WEEKLY | MONTHLY
      ownerUserId TEXT NOT NULL DEFAULT 'me',        -- 'me' ya da arkadaşın userId'si
      assignedByUserId TEXT,                         -- görevi atayan kişi (sosyal özellik)
      assignedByName TEXT,
      assignedToUserId TEXT,                         -- görevi kabul edip yürüten kişi (ben)
      assignedToName TEXT,
      assignmentDirection TEXT,                      -- NULL | 'SENT' (ben attım) | 'RECEIVED' (bana atandı)
      firestoreAssignmentId TEXT,                     -- RECEIVED görevlerde: Firestore'daki assignedTasks/{id} referansı.
                                                       -- Tamamlama/geri alma işlemleri bu ID üzerinden Firestore'a da yansıtılır,
                                                       -- böylece atayan taraf gerçek zamanlı olarak görebilir.
      assignmentStatus TEXT NOT NULL DEFAULT 'NONE', -- NONE | PENDING_ACCEPT | ACCEPTED
      subtaskCount INTEGER NOT NULL DEFAULT 1,       -- bir periyotta kaç kez yapılması gerektiği
      subtaskLabels TEXT,                            -- JSON dizi, ör: '["Sabah","Akşam"]'; boşsa sadece sayı gösterilir
      isArchived INTEGER NOT NULL DEFAULT 0,
      createdAt INTEGER NOT NULL,
      FOREIGN KEY (categoryId) REFERENCES categories(id)
    );

    -- Her periyot (gün/hafta/ay) için tek kayıt tutulur. periodKey = o periyodun başlangıç tarihi (YYYY-MM-DD)
    CREATE TABLE IF NOT EXISTS task_records (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL,
      periodKey TEXT NOT NULL,
      status TEXT NOT NULL,               -- SUCCESSFUL | FAILED
      completedSubtasks INTEGER NOT NULL DEFAULT 0,  -- bu periyotta kaç alt adım tamamlandı
      completedAt INTEGER,                -- gerçekten (tamamen) işaretlendiği an
      isLateMarked INTEGER NOT NULL DEFAULT 0,  -- 1.5 kuralı: geçmişe dönük düzeltme mi?
      lateMarkedAt INTEGER,
      jpEarned INTEGER NOT NULL DEFAULT 0,
      streakBonusEarned INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (taskId) REFERENCES tasks(id),
      UNIQUE(taskId, periodKey)
    );

    CREATE TABLE IF NOT EXISTS wallet (
      userId TEXT PRIMARY KEY,
      balance INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      amount INTEGER NOT NULL,           -- pozitif: kazanç, negatif: harcama
      reason TEXT NOT NULL,              -- 'TASK_COMPLETE' | 'STREAK_BONUS' | 'REWARD_REDEEM' | 'FOCUS_SESSION'
      relatedTaskId TEXT,
      relatedRewardId TEXT,
      createdAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rewards (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      cost INTEGER NOT NULL,
      ownerUserId TEXT NOT NULL DEFAULT 'me',
      assignedByUserId TEXT,
      assignedByName TEXT,
      assignmentStatus TEXT NOT NULL DEFAULT 'NONE',  -- NONE | PENDING_ACCEPT | ACCEPTED
      isRedeemed INTEGER NOT NULL DEFAULT 0,
      redeemedAt INTEGER,
      createdAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS friends (
      id TEXT PRIMARY KEY,
      friendUserId TEXT NOT NULL,
      friendDisplayName TEXT NOT NULL,
      friendCode TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACCEPTED', -- PENDING_SENT | PENDING_RECEIVED | ACCEPTED
      createdAt INTEGER NOT NULL
    );

    -- Her başarıyla tamamlanan (erken bitirilmemiş) odaklanma seansı ayrı bir
    -- kayıt olarak saklanır. Görevlerdeki gibi periyot/tekrar kavramı yok —
    -- her seans bağımsız bir olay. monthKey (YYYY-MM) ile ay bazlı filtreleme
    -- kolaylaştırılır.
    CREATE TABLE IF NOT EXISTS focus_sessions (
      id TEXT PRIMARY KEY,
      durationMinutes INTEGER NOT NULL,
      soundKey TEXT,
      jpEarned INTEGER NOT NULL DEFAULT 0,
      monthKey TEXT NOT NULL,
      completedAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  runMigrations(db);

  // Var olan tüm veritabanlarında description sütununun varlığından emin ol
  tryAddColumn(db, 'tasks', 'description TEXT');

  // "me" için cüzdan kaydı yoksa oluştur
  const existing = db.getFirstSync('SELECT userId FROM wallet WHERE userId = ?', ['me']);
  if (!existing) {
    db.runSync('INSERT INTO wallet (userId, balance) VALUES (?, 0)', ['me']);
  }
}

// Eski (v1) yüklemelerde eksik olan sütunları güvenli şekilde ekler.
// SQLite'ta "ADD COLUMN IF NOT EXISTS" yok, bu yüzden hata yutularak denenir.
function tryAddColumn(db, table, columnDef) {
  try {
    db.execSync(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
  } catch (e) {
    // Sütun zaten varsa hata verir, bu beklenen ve zararsızdır.
  }
}

function runMigrations(db) {
  const row = db.getFirstSync(`SELECT value FROM app_meta WHERE key = 'schema_version'`);
  const currentVersion = row ? parseInt(row.value, 10) : 1;

  if (currentVersion < 2) {
    tryAddColumn(db, 'tasks', 'assignedToUserId TEXT');
    tryAddColumn(db, 'tasks', 'assignedToName TEXT');
    tryAddColumn(db, 'tasks', "assignmentDirection TEXT");
    tryAddColumn(db, 'tasks', 'subtaskCount INTEGER NOT NULL DEFAULT 1');
    tryAddColumn(db, 'tasks', 'subtaskLabels TEXT');
    tryAddColumn(db, 'task_records', 'completedSubtasks INTEGER NOT NULL DEFAULT 0');
  }

  if (currentVersion < 4) {
    tryAddColumn(db, 'tasks', 'description TEXT');
  }

  db.runSync(
    `INSERT INTO app_meta (key, value) VALUES ('schema_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [String(CURRENT_SCHEMA_VERSION)]
  );
}
