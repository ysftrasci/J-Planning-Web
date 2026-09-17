// J-Planning — SQLite / Turso & Yerel Misafir Veritabanı Katmanı (Web)
//
// 1. Kayıtlı Kullanıcı Modu: Cloudflare Worker üzerinden sağlanan scoped token ile
//    kullanıcının Turso bulut veritabanına bağlanır (TursoConnection).
// 2. Misafir (Guest) Modu: Tamamen yerel WebAssembly SQLite (sql.js) + IndexedDB
//    üzerinde çalışır (LocalSqliteConnection). Worker ve Turso'ya hiçbir istek gitmez.
// 3. Repository Katmanı: getDb() üzerinden aynı asenkron arayüzle konuşur; alt motoru bilmez.

import { openTursoConnection } from './sqliteEngine';
import { openGuestLocalDatabase } from './localSqliteEngine';
import { ensureDefaultCategories } from './categoryRepository';
import { migrateLegacyDataIfNeeded } from './migrationService';
import { auth } from '../services/firebase';

let dbInstance = null;
let currentUid = null;
let currentSession = null; // { dbUrl, token, expiresAt, uid }

const WORKER_URL = (import.meta.env.VITE_WORKER_URL || '/api/worker').replace(/\/+$/, '');

/**
 * Misafir oturumunun aktif olup olmadığını kontrol eder.
 */
export function isGuestSessionActive() {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem('jplanning_guest_mode') === 'true';
}

/**
 * Tüm repository'lerin ortak giriş noktası.
 * Misafir modunda LocalSqliteConnection, normal modda TursoConnection döndürür.
 */
export function getDb() {
  if (!dbInstance) {
    if (isGuestSessionActive()) {
      throw new Error('Misafir veritabanı henüz başlatılmadı. Önce initGuestDatabase() çağrılmalı.');
    }
    throw new Error('Veritabanı henüz başlatılmadı. Önce initDatabase(uid) çağrılmalı.');
  }
  return dbInstance;
}

/**
 * Worker'dan kullanıcı için DB URL ve scoped token alır (sessionStorage ile önbelleklenir).
 * Misafir modunda KESİNLİKLE çağrılamaz (korumalıdır).
 */
async function requestWorkerSession(forceFreshIdToken = false) {
  if (isGuestSessionActive()) {
    throw new Error('[Database] Misafir modunda Worker oturumu açılamaz.');
  }

  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Oturum açmış bir Firebase kullanıcısı bulunamadı.');
  }

  // Önbellek kontrolü (en az 5 dakika geçerli token varsa Worker'a tekrar gitme)
  if (!forceFreshIdToken) {
    try {
      const cachedStr = sessionStorage.getItem(`jplanning_session_${currentUser.uid}`);
      if (cachedStr) {
        const cached = JSON.parse(cachedStr);
        const nowSec = Math.floor(Date.now() / 1000);
        if (cached.dbUrl && cached.token && cached.expiresAt && cached.expiresAt > nowSec + 300) {
          return cached;
        }
      }
    } catch (_) {}
  }

  const idToken = await currentUser.getIdToken(forceFreshIdToken);
  const response = await fetch(`${WORKER_URL}/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
  });

  if (!response.ok) {
    if (response.status === 401 && !forceFreshIdToken) {
      // Profil güncellemesi veya ilk kayıt anındaki geçici token yarışında 400ms bekleyip taze token ile 1 kez yeniden dene
      await new Promise((resolve) => setTimeout(resolve, 400));
      return requestWorkerSession(true);
    }

    let errMessage = `Worker oturum hatası (${response.status})`;
    let errCode = null;
    try {
      const errData = await response.json();
      if (errData.message) errMessage = errData.message;
      if (errData.error) errCode = errData.error;
    } catch (_) {}

    if (response.status === 403 && (errCode === 'ACCOUNT_DISABLED' || errMessage.includes('askıya'))) {
      resetDatabaseSession();
      window.dispatchEvent(
        new CustomEvent('jplanning:force-logout', {
          detail: { reason: 'ACCOUNT_DISABLED', message: errMessage },
        })
      );
    }
    throw new Error(errMessage);
  }

  const data = await response.json();
  if (!data.dbUrl || !data.token) {
    throw new Error('Worker yanıtında dbUrl veya token bulunamadı.');
  }

  const session = {
    dbUrl: data.dbUrl,
    token: data.token,
    expiresAt: data.expiresAt || Math.floor(Date.now() / 1000) + 3600,
    uid: currentUser.uid,
  };

  try {
    sessionStorage.setItem(`jplanning_session_${currentUser.uid}`, JSON.stringify(session));
  } catch (_) {}

  return session;
}

/**
 * Token Yöneticisi: Proaktif ve reaktif token tazeleme (Sadece Turso için)
 */
const tokenManager = {
  getToken: () => currentSession?.token || null,
  getDbUrl: () => currentSession?.dbUrl || null,
  getExpiresAt: () => currentSession?.expiresAt || 0,
  refreshToken: async () => {
    const session = await requestWorkerSession(true);
    currentSession = session;
    return session.token;
  },
};

/**
 * Belirtilen UID için Turso bağlantısını açar veya mevcut olanı döndürür.
 * Misafir modunda KESİNLİKLE çağrılamaz.
 */
export async function switchToUserDatabase(uid) {
  if (isGuestSessionActive()) {
    throw new Error('[Database] Misafir modunda Turso veritabanına geçilemez.');
  }

  if (dbInstance && currentUid === uid) {
    const token = await tokenManager.getToken();
    if (token) return dbInstance;
  }

  if (dbInstance) {
    try {
      dbInstance.close();
    } catch (_) {}
  }

  const session = await requestWorkerSession();
  currentSession = session;
  currentUid = uid;

  dbInstance = openTursoConnection(session.dbUrl, session.token, tokenManager);
  return dbInstance;
}

/**
 * Yerel misafir veritabanını başlatır.
 * Worker'a veya Turso'ya hiçbir istek gitmez.
 */
export async function initGuestDatabase() {
  if (dbInstance && currentUid === 'guest') {
    return dbInstance;
  }

  if (dbInstance) {
    try {
      dbInstance.close();
    } catch (_) {}
  }

  const localDb = await openGuestLocalDatabase();
  dbInstance = localDb;
  currentUid = 'guest';
  currentSession = null;

  // Varsayılan kategorileri ve 0 bakiyeli cüzdanı yerel motorda hazırla
  await Promise.all([
    ensureDefaultCategories().catch((e) => console.warn('[GuestDB] Varsayılan kategoriler uyarısı:', e)),
    dbInstance.getFirstAsync('SELECT userId FROM wallet WHERE userId = ?', ['me'])
      .then((existing) => {
        if (!existing) {
          return dbInstance.runAsync('INSERT INTO wallet (userId, balance) VALUES (?, 0)', ['me']);
        }
      })
      .catch((e) => console.warn('[GuestDB] Cüzdan kontrolü uyarısı:', e)),
  ]);

  return dbInstance;
}

/**
 * Kayıtlı kullanıcı için Turso veritabanını başlatır, gerekirse eski verileri taşır.
 */
export async function initDatabase(uid) {
  if (isGuestSessionActive()) {
    return initGuestDatabase();
  }

  const db = await switchToUserDatabase(uid);

  // 1. Önce eski verileri (IndexedDB veya Firestore'dan) Turso'ya taşı
  try {
    await migrateLegacyDataIfNeeded(uid, db);
  } catch (migErr) {
    console.error('[Migration] Migrasyon sırasında beklenmeyen hata:', migErr);
  }

  // 2. Varsayılan kategorileri ve cüzdanı paralel kontrol et
  await Promise.all([
    ensureDefaultCategories().catch((e) => console.warn('Varsayılan kategoriler uyarısı:', e)),
    db.getFirstAsync('SELECT userId FROM wallet WHERE userId = ?', ['me'])
      .then((existing) => {
        if (!existing) {
          return db.runAsync('INSERT INTO wallet (userId, balance) VALUES (?, 0)', ['me']);
        }
      })
      .catch((e) => console.warn('Cüzdan kontrolü uyarısı:', e)),
  ]);

  return db;
}

/**
 * Çıkış (signOut) veya kullanıcı değişiminde veritabanı bağlantısını kapatır,
 * bellek değişkenlerini ve sessionStorage önbelleklerini temizler.
 */
export function resetDatabaseSession(targetUid = null) {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch (_) {}
  }
  dbInstance = null;
  currentUid = null;
  currentSession = null;

  if (typeof sessionStorage !== 'undefined') {
    try {
      if (targetUid) {
        sessionStorage.removeItem(`jplanning_session_${targetUid}`);
      } else {
        const keysToRemove = [];
        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i);
          if (key && key.startsWith('jplanning_session_')) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach((k) => sessionStorage.removeItem(k));
      }
    } catch (_) {}
  }
}

/**
 * Hesap silme akışında bağlantıyı kapatır ve oturumu temizler.
 */
export async function deleteUserDatabase(uid) {
  resetDatabaseSession(uid);
}

/**
 * Veritabanı motorunun başlatılıp kullanıma hazır olup olmadığını bildirir.
 */
export function isDatabaseReady() {
  return Boolean(dbInstance);
}
