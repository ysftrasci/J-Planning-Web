// J-Planning — SQLite / Turso Veritabanı Katmanı (Web)
//
// Cloudflare Worker üzerinden sağlanan scoped token ile kullanıcının
// Turso veritabanına bağlanır. Şema kurulumu ilk açılışta Worker tarafından
// yapıldığı için istemci sadece bağlantıyı kurar ve varsayılan kayıtları garanti eder.

import { openTursoConnection } from './sqliteEngine';
import { ensureDefaultCategories } from './categoryRepository';
import { migrateLegacyDataIfNeeded } from './migrationService';
import { auth } from '../services/firebase';

let dbInstance = null;
let currentUid = null;
let currentSession = null; // { dbUrl, token, expiresAt, uid }

const WORKER_URL = (import.meta.env.VITE_WORKER_URL || 'https://jplanning-auth-worker.ysftrasci.workers.dev').replace(/\/+$/, '');

export function getDb() {
  if (!dbInstance) {
    throw new Error('Veritabanı henüz başlatılmadı. Önce initDatabase(uid) çağrılmalı.');
  }
  return dbInstance;
}

/**
 * Worker'dan kullanıcı için DB URL ve scoped token alır (sessionStorage ile önbelleklenir).
 */
async function requestWorkerSession(forceFreshIdToken = false) {
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
    let errMessage = `Worker oturum hatası (${response.status})`;
    try {
      const errData = await response.json();
      if (errData.message) errMessage = errData.message;
    } catch (_) {}
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
 * Token Yöneticisi: Proaktif ve reaktif token tazeleme
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
 */
export async function switchToUserDatabase(uid) {
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
 * Veritabanını başlatır, gerekirse eski verileri taşır ve varsayılan kayıtları kontrol eder.
 */
export async function initDatabase(uid) {
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
