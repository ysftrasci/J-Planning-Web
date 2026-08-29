-- ============================================================================
-- J-Planning SQLite / Turso Canonical Schema (v4 Birleşik Hali)
-- ============================================================================

-- 1. KATEGORİLER
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT,
  createdAt INTEGER NOT NULL
);

-- 2. GÖREVLER (v1 + v2 subtask/assigned + v3 notes + v4 description birleşik)
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  notes TEXT,
  categoryId TEXT,
  priority TEXT NOT NULL DEFAULT 'MEDIUM',       -- HIGH | MEDIUM | LOW
  period TEXT NOT NULL DEFAULT 'DAILY',          -- DAILY | WEEKLY | MONTHLY
  ownerUserId TEXT NOT NULL DEFAULT 'me',        -- 'me' ya da arkadaşın userId'si
  assignedByUserId TEXT,                         -- görevi atayan kişi (sosyal özellik)
  assignedByName TEXT,
  assignedToUserId TEXT,                         -- görevi kabul edip yürüten kişi (ben)
  assignedToName TEXT,
  assignmentDirection TEXT,                      -- NULL | 'SENT' (ben attım) | 'RECEIVED' (bana atandı)
  firestoreAssignmentId TEXT,                     -- RECEIVED görevlerde: Firestore'daki assignedTasks/{id} referansı
  assignmentStatus TEXT NOT NULL DEFAULT 'NONE', -- NONE | PENDING_ACCEPT | ACCEPTED
  subtaskCount INTEGER NOT NULL DEFAULT 1,       -- bir periyotta kaç kez yapılması gerektiği
  subtaskLabels TEXT,                            -- JSON dizi, ör: '["Sabah","Akşam"]'; boşsa sadece sayı gösterilir
  isArchived INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL,
  FOREIGN KEY (categoryId) REFERENCES categories(id)
);

-- 3. GÖREV PERİYOT KAYITLARI (Her gün/hafta/ay için tekil kayıt)
CREATE TABLE IF NOT EXISTS task_records (
  id TEXT PRIMARY KEY,
  taskId TEXT NOT NULL,
  periodKey TEXT NOT NULL,                       -- YYYY-MM-DD
  status TEXT NOT NULL,                          -- SUCCESSFUL | FAILED
  completedSubtasks INTEGER NOT NULL DEFAULT 0,  -- bu periyotta kaç alt adım tamamlandı
  completedAt INTEGER,                           -- gerçekten (tamamen) işaretlendiği an
  isLateMarked INTEGER NOT NULL DEFAULT 0,       -- 1.5 kuralı: geçmişe dönük düzeltme mi?
  lateMarkedAt INTEGER,
  jpEarned INTEGER NOT NULL DEFAULT 0,
  streakBonusEarned INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (taskId) REFERENCES tasks(id),
  UNIQUE(taskId, periodKey)
);

-- 4. CÜZDAN
CREATE TABLE IF NOT EXISTS wallet (
  userId TEXT PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 0
);

-- 5. CÜZDAN İŞLEMLERİ (Hareket geçmişi)
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  amount INTEGER NOT NULL,                       -- pozitif: kazanç, negatif: harcama
  reason TEXT NOT NULL,                          -- 'TASK_COMPLETE' | 'STREAK_BONUS' | 'REWARD_REDEEM' | 'FOCUS_SESSION'
  relatedTaskId TEXT,
  relatedRewardId TEXT,
  createdAt INTEGER NOT NULL
);

-- 6. ÖDÜLLER
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

-- 7. ARKADAŞLAR
CREATE TABLE IF NOT EXISTS friends (
  id TEXT PRIMARY KEY,
  friendUserId TEXT NOT NULL,
  friendDisplayName TEXT NOT NULL,
  friendCode TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACCEPTED',        -- PENDING_SENT | PENDING_RECEIVED | ACCEPTED
  createdAt INTEGER NOT NULL
);

-- 8. ODAKLANMA SEANSLARI
CREATE TABLE IF NOT EXISTS focus_sessions (
  id TEXT PRIMARY KEY,
  durationMinutes INTEGER NOT NULL,
  soundKey TEXT,
  jpEarned INTEGER NOT NULL DEFAULT 0,
  monthKey TEXT NOT NULL,                        -- YYYY-MM
  completedAt INTEGER NOT NULL
);

-- 9. DERS ÇALIŞMA SÜRE KAYITLARI (Görev bazlı)
CREATE TABLE IF NOT EXISTS task_study_logs (
  id TEXT PRIMARY KEY,
  taskId TEXT NOT NULL,
  periodKey TEXT NOT NULL,
  studyTimeText TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  FOREIGN KEY (taskId) REFERENCES tasks(id)
);

-- 10. GÜNLÜK NOTLAR (v1 + v3 studyTimeText birleşik)
CREATE TABLE IF NOT EXISTS daily_notes (
  id TEXT PRIMARY KEY,
  dateKey TEXT UNIQUE NOT NULL,                  -- YYYY-MM-DD
  content TEXT NOT NULL,
  studyTimeText TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

-- 11. UYGULAMA METAVERİLERİ (Versiyon takibi vb.)
CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- 12. BAŞLANGIÇ TEMEL KAYITLARI
INSERT OR IGNORE INTO app_meta (key, value) VALUES ('schema_version', '4');
INSERT OR IGNORE INTO wallet (userId, balance) VALUES ('me', 0);
