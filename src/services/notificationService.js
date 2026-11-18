import { getToken, onMessage } from 'firebase/messaging';
import { doc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { db, messaging, messagingReady, auth } from './firebase';
import { getDb } from '../db/database';

const WORKER_URL = (import.meta.env.VITE_WORKER_URL || '/api/worker').replace(/\/+$/, '');

const FCM_TOKEN_KEY = 'jplanning:current_fcm_token';
const FCM_OWNER_KEY = 'jplanning:fcm_token_owner';
// Aynı cihaz + aynı kullanıcı + aynı token için Firestore'a en fazla günde bir kez yazılır.
const FCM_REWRITE_INTERVAL_MS = 24 * 60 * 60 * 1000;

function readFcmOwner() {
  try {
    const raw = localStorage.getItem(FCM_OWNER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Bu cihazın FCM token'ını alır ve kullanıcının Firestore profiline kaydeder.
 * Bildirim izni verilmemişse hiçbir şey yapmaz (izin İSTEMEZ).
 * @param {string} userUid
 * @param {{ force?: boolean }} [options] force=true ise günlük yazma sınırını atlar.
 */
export async function registerFCMPushToken(userUid, options = {}) {
  if (typeof window === 'undefined') return null;
  if (!('Notification' in window) || Notification.permission !== 'granted') return null;
  const messagingInstance = messaging || (await messagingReady);
  if (!messagingInstance) return null;

  try {
    let serviceWorkerRegistration;
    if ('serviceWorker' in navigator) {
      serviceWorkerRegistration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
      });
      await navigator.serviceWorker.ready;
    }

    const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY || undefined;
    const token = await getToken(messagingInstance, {
      vapidKey,
      serviceWorkerRegistration,
    });

    if (token && userUid) {
      // Token alınırken kullanıcı çıkış yaptıysa/değiştiyse yanlış hesaba yazma.
      if (auth.currentUser?.uid !== userUid) return null;

      const owner = readFcmOwner();
      const alreadyFresh =
        !options.force &&
        owner &&
        owner.uid === userUid &&
        owner.token === token &&
        Date.now() - (Number(owner.at) || 0) < FCM_REWRITE_INTERVAL_MS;

      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(FCM_TOKEN_KEY, token);
      }
      if (alreadyFresh) return token;

      const userRef = doc(db, 'users', userUid);
      let written = false;
      try {
        await updateDoc(userRef, {
          fcmTokens: arrayUnion(token),
          lastPushTokenAt: Date.now(),
        });
        written = true;
      } catch (writeErr) {
        console.warn('FCM token Firestore profiline yazılamadı:', writeErr?.code || writeErr);
      }
      if (written && typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(FCM_OWNER_KEY, JSON.stringify({ uid: userUid, token, at: Date.now() }));
        } catch {}
      }
    }
    return token;
  } catch (err) {
    console.warn('FCM Push Token alınamadı:', err);
    return null;
  }
}

export async function unregisterFCMPushToken(userUid) {
  if (!userUid) return false;

  try {
    let token = null;
    const messagingInstance = messaging || (await messagingReady);
    if (messagingInstance && 'Notification' in window && Notification.permission === 'granted') {
      let serviceWorkerRegistration;
      if ('serviceWorker' in navigator) {
        serviceWorkerRegistration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
        });
        await navigator.serviceWorker.ready;
      }
      const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY || undefined;
      token = await getToken(messagingInstance, {
        vapidKey,
        serviceWorkerRegistration,
      }).catch(() => null);
    }

    const storedToken = typeof localStorage !== 'undefined' ? localStorage.getItem(FCM_TOKEN_KEY) : null;
    const targetToken = token || storedToken;

    if (targetToken && userUid) {
      const userRef = doc(db, 'users', userUid);
      await updateDoc(userRef, {
        fcmTokens: arrayRemove(targetToken),
      }).catch(() => {});
    }

    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(FCM_TOKEN_KEY);
      localStorage.removeItem(FCM_OWNER_KEY);
    }
    return true;
  } catch (err) {
    console.warn('FCM Push Token silinemedi:', err);
    return false;
  }
}

export function listenForegroundFCM(callback) {
  if (!messaging) return () => {};
  return onMessage(messaging, (payload) => {
    if (callback) callback(payload);
  });
}

export const WEEKDAYS = [
  { value: 1, label: 'Pazar', short: 'Paz' },
  { value: 2, label: 'Pazartesi', short: 'Pzt' },
  { value: 3, label: 'Salı', short: 'Sal' },
  { value: 4, label: 'Çarşamba', short: 'Çar' },
  { value: 5, label: 'Perşembe', short: 'Per' },
  { value: 6, label: 'Cuma', short: 'Cum' },
  { value: 7, label: 'Cumartesi', short: 'Cmt' },
];

export async function requestNotificationPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  const permission = await Notification.requestPermission();
  return permission === 'granted';
}

export async function getNotificationPermissionStatus() {
  if (!('Notification' in window)) return 'denied';
  return Notification.permission;
}

// Not: Android/mobil Chrome (PWA dahil) new Notification() çağrısını
// desteklemez — bu ortamlarda bildirim sadece Service Worker üzerinden
// (registration.showNotification) gösterilebilir. Bu yüzden önce Service
// Worker'ı deniyoruz, o yoksa/başarısız olursa masaüstü için new Notification()'a düşüyoruz.
export async function sendWebNotification(title, body, tag) {
  if (!('Notification' in window)) return false;
  if (Notification.permission !== 'granted') return false;

  const payload = {
    title,
    body: body || 'Görevlerine göz atmayı unutma!',
    icon: '/favicon.svg',
    tag: tag || 'j-planning-notification',
  };

  // 1. Yöntem: Service Worker üzerinden göster (mobil dahil her yerde çalışır)
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.ready;
      if (registration && registration.active) {
        registration.active.postMessage({ type: 'SHOW_NOTIFICATION', payload });
        return true;
      }
    } catch (e) {
      console.warn('Service Worker bildirim hatası:', e);
    }
  }

  // 2. Yöntem (yedek): Doğrudan new Notification() — çoğunlukla masaüstünde çalışır
  try {
    new Notification(payload.title, { body: payload.body, icon: payload.icon, tag: payload.tag });
    return true;
  } catch (e) {
    console.warn('Web bildirim hatası:', e);
  }

  return false;
}

// ─── Bildirim zamanlamaları ────────────────────────────────────────────────
// Zamanlamalar sunucuda (Worker) tutulur ve Worker'ın 5 dakikalık cron'u push bildirimi
// olarak gönderir: tüm cihazlarda ve uygulama kapalıyken çalışır.
// Eski sürümler zamanlamaları bu cihazın localStorage'ında tutuyordu; girişte bunlar
// bir kez sunucuya taşınır (syncNotificationSetup).

export const SCHEDULE_MINUTE_STEP = 5;

export function getDeviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Istanbul';
  } catch {
    return 'Europe/Istanbul';
  }
}

async function workerRequest(path, { method = 'GET', body } = {}) {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Oturum açmış kullanıcı bulunamadı.');
  const idToken = await currentUser.getIdToken();
  const res = await fetch(`${WORKER_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${idToken}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    throw new Error(data?.message || 'Sunucuya ulaşılamadı. Lütfen tekrar dene.');
  }
  return data;
}

function cleanSchedulePayload(schedule) {
  return {
    weekdays: Array.isArray(schedule?.weekdays) ? schedule.weekdays : [],
    hour: Number(schedule?.hour),
    minute: Number(schedule?.minute),
    label: typeof schedule?.label === 'string' ? schedule.label : '',
    timeZone: getDeviceTimeZone(),
  };
}

function sameSchedule(a, b) {
  const days = (x) => [...(x.weekdays || [])].map(Number).sort((p, q) => p - q).join(',');
  return (
    days(a) === days(b) &&
    Number(a.hour) === Number(b.hour) &&
    Number(a.minute) === Number(b.minute) &&
    (a.label || '').trim() === (b.label || '').trim()
  );
}

/** Giriş yapmış kullanıcının zamanlamaları (sunucudan). Misafirde boş liste. */
export async function getSchedules() {
  if (!auth.currentUser) return [];
  const data = await workerRequest('/user/notification-schedules');
  return Array.isArray(data?.schedules) ? data.schedules : [];
}

export async function addSchedule(schedule) {
  const data = await workerRequest('/user/notification-schedules', {
    method: 'POST',
    body: cleanSchedulePayload(schedule),
  });
  return data?.schedule?.id;
}

export async function updateSchedule(scheduleId, schedule) {
  await workerRequest(`/user/notification-schedules/${encodeURIComponent(scheduleId)}`, {
    method: 'PATCH',
    body: cleanSchedulePayload(schedule),
  });
}

export async function removeSchedule(scheduleId) {
  await workerRequest(`/user/notification-schedules/${encodeURIComponent(scheduleId)}`, { method: 'DELETE' });
}

/** Yedekten geri yüklerken: mevcut zamanlamaları yedektekilerle değiştirir. */
export async function replaceAllSchedules(schedules) {
  if (!auth.currentUser || !Array.isArray(schedules)) return;
  const existing = await getSchedules();
  for (const s of existing) {
    await removeSchedule(s.id);
  }
  for (const s of schedules.slice(0, 20)) {
    if (!s || !Array.isArray(s.weekdays) || s.weekdays.length === 0) continue;
    await addSchedule(s);
  }
}

function readLegacyLocalSchedules(uid) {
  if (typeof localStorage === 'undefined' || !uid) return { key: null, list: [] };
  const key = `jplanning:${uid}:notification_schedules`;
  try {
    let raw = localStorage.getItem(key);
    if (!raw) {
      // Daha da eski sürüm: kullanıcıya bağlı olmayan anahtar
      const legacyRaw = localStorage.getItem('jplanning:notification_schedules');
      if (legacyRaw) {
        localStorage.setItem(key, legacyRaw);
        localStorage.removeItem('jplanning:notification_schedules');
        raw = legacyRaw;
      }
    }
    const parsed = raw ? JSON.parse(raw) : [];
    return { key, list: Array.isArray(parsed) ? parsed : [] };
  } catch {
    return { key, list: [] };
  }
}

let syncInFlight = null;

/**
 * Girişte çağrılır (arka planda, ana akışı bekletmez):
 * 1. Cihaz saat dilimi değiştiyse sunucuya bildirir (hatırlatıcı ve zamanlamalar o saate göre çalışır).
 * 2. Bu cihazda eski sürümden kalan zamanlamalar varsa sunucuya taşır ve cihazdan siler.
 */
export function syncNotificationSetup(uid) {
  if (!uid) return Promise.resolve();
  if (syncInFlight) return syncInFlight;

  syncInFlight = (async () => {
    const timeZone = getDeviceTimeZone();
    const tzKey = `jplanning:${uid}:synced_time_zone`;
    try {
      if (localStorage.getItem(tzKey) !== timeZone) {
        await workerRequest('/user/timezone', { method: 'POST', body: { timeZone } });
        localStorage.setItem(tzKey, timeZone);
      }
    } catch (e) {
      console.warn('[NotificationService] Saat dilimi kaydedilemedi:', e);
    }

    const { key, list } = readLegacyLocalSchedules(uid);
    if (!key || list.length === 0) return;
    try {
      const serverList = await getSchedules();
      const remaining = [];
      for (const local of list) {
        if (!local || !Array.isArray(local.weekdays) || local.weekdays.length === 0) continue;
        if (serverList.some((s) => sameSchedule(s, local))) continue;
        try {
          await addSchedule(local);
          serverList.push(local);
        } catch (e) {
          console.warn('[NotificationService] Zamanlama taşınamadı:', e);
          remaining.push(local);
        }
      }
      if (remaining.length > 0) localStorage.setItem(key, JSON.stringify(remaining));
      else localStorage.removeItem(key);
    } catch (e) {
      console.warn('[NotificationService] Eski zamanlamalar taşınamadı:', e);
    }
  })().finally(() => {
    syncInFlight = null;
  });

  return syncInFlight;
}

export function weekdayLabel(value) {
  return WEEKDAYS.find((w) => w.value === value)?.label || '';
}

export function formatTime(hour, minute) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * Kullanıcının sunucudaki (Cloudflare Worker & Control Plane) hatırlatıcı ayarlarını çeker.
 */
export async function getUserReminderSettings() {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    return { reminderEnabled: false, reminderHour: 20 };
  }

  try {
    const idToken = await currentUser.getIdToken();
    const res = await fetch(`${WORKER_URL}/user/reminder-settings`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
    });

    if (res.ok) {
      const data = await res.json();
      return {
        reminderEnabled: Boolean(data.reminderEnabled),
        reminderHour: typeof data.reminderHour === 'number' ? data.reminderHour : 20,
        timeZone: data.timeZone || null,
      };
    }
  } catch (err) {
    console.warn('[NotificationService] Reminder ayarları Worker üzerinden alınamadı, yerel deneniyor:', err);
  }

  // Yedek: SQLite app_meta'dan oku
  try {
    const db = getDb();
    if (db) {
      const [enabledRow, hourRow] = await Promise.all([
        db.getFirstAsync("SELECT value FROM app_meta WHERE key = 'reminder_enabled' LIMIT 1;").catch(() => null),
        db.getFirstAsync("SELECT value FROM app_meta WHERE key = 'reminder_hour' LIMIT 1;").catch(() => null),
      ]);
      return {
        reminderEnabled: enabledRow ? enabledRow.value === '1' : false,
        reminderHour: hourRow ? parseInt(hourRow.value, 10) : 20,
      };
    }
  } catch {}

  return { reminderEnabled: false, reminderHour: 20 };
}

/**
 * Kullanıcının hatırlatıcı ayarlarını (açık/kapalı ve saat) günceller.
 */
export async function updateUserReminderSettings({ reminderEnabled, reminderHour }) {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Oturum açmış kullanıcı bulunamadı.');
  }

  const idToken = await currentUser.getIdToken();
  const res = await fetch(`${WORKER_URL}/user/reminder-settings`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ reminderEnabled, reminderHour, timeZone: getDeviceTimeZone() }),
  });

  if (!res.ok) {
    let errMessage = 'Hatırlatıcı ayarları kaydedilemedi.';
    try {
      const data = await res.json();
      if (data.message) errMessage = data.message;
    } catch {}
    throw new Error(errMessage);
  }

  const result = await res.json();

  // İstemci tarafı yerel SQLite app_meta'yı güncelle
  try {
    const db = getDb();
    if (db) {
      await db.runAsync(
        "INSERT INTO app_meta (key, value) VALUES ('reminder_enabled', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value;",
        [reminderEnabled ? '1' : '0']
      ).catch(() => {});
      await db.runAsync(
        "INSERT INTO app_meta (key, value) VALUES ('reminder_hour', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value;",
        [String(reminderHour)]
      ).catch(() => {});
    }
  } catch {}

  return result;
}

/**
 * Test amaçlı hatırlatıcı push bildirimini manuel tetikler (Sadece oturum açmış kullanıcının kendi hesabı).
 */
export async function triggerReminderTest() {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Oturum açmış kullanıcı bulunamadı.');
  }

  const idToken = await currentUser.getIdToken();
  const res = await fetch(`${WORKER_URL}/test/trigger-reminders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
  });

  if (!res.ok) {
    let errMessage = 'Hatırlatıcı test isteği başarısız oldu.';
    try {
      const data = await res.json();
      if (data.message) errMessage = data.message;
    } catch {}
    throw new Error(errMessage);
  }

  return res.json();
}
