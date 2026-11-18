import { getToken, onMessage } from 'firebase/messaging';
import { doc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { db, messaging, messagingReady, auth } from './firebase';
import { getDb } from '../db/database';

let lastTriggeredMinuteKey = '';

function getStorageKey(uid) {
  const userUid = uid || auth.currentUser?.uid;
  if (!userUid) return null;
  const userKey = `jplanning:${userUid}:notification_schedules`;

  if (typeof localStorage !== 'undefined') {
    if (!localStorage.getItem(userKey)) {
      const legacyRaw = localStorage.getItem('jplanning:notification_schedules');
      if (legacyRaw) {
        localStorage.setItem(userKey, legacyRaw);
        localStorage.removeItem('jplanning:notification_schedules');
      }
    }
  }
  return userKey;
}

const FCM_TOKEN_KEY = 'jplanning:current_fcm_token';
const FCM_OWNER_KEY = 'jplanning:fcm_token_owner';
// Aynı cihaz + aynı kullanıcı + aynı token için Firestore'a en fazla günde bir kez yazılır.
const FCM_REWRITE_INTERVAL_MS = 24 * 60 * 60 * 1000;

function readFcmOwner() {
  try {
    const raw = localStorage.getItem(FCM_OWNER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
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
        } catch (_) {}
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

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

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

export async function getSchedules(uid) {
  const key = getStorageKey(uid);
  if (!key) return [];
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    // Bozuk kayıt tüm bildirim sayfasını kilitlemesin
    return [];
  }
}

export async function saveSchedules(schedules, uid) {
  const key = getStorageKey(uid);
  if (!key) return;
  localStorage.setItem(key, JSON.stringify(schedules));
}

export async function addSchedule(schedule, uid) {
  const schedules = await getSchedules(uid);
  const newSchedule = { id: uuid(), ...schedule };
  schedules.push(newSchedule);
  await saveSchedules(schedules, uid);
  return newSchedule.id;
}

export async function updateSchedule(scheduleId, updatedData, uid) {
  const schedules = await getSchedules(uid);
  const updated = schedules.map((s) =>
    s.id === scheduleId ? { ...s, ...updatedData } : s
  );
  await saveSchedules(updated, uid);
}

export async function removeSchedule(scheduleId, uid) {
  const schedules = await getSchedules(uid);
  const updated = schedules.filter((s) => s.id !== scheduleId);
  await saveSchedules(updated, uid);
}

export async function removeAllSchedules(uid) {
  await saveSchedules([], uid);
}

export function weekdayLabel(value) {
  return WEEKDAYS.find((w) => w.value === value)?.label || '';
}

export function formatTime(hour, minute) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

// Zamanlanmış bildirim kontrolü (Uygulama açıkken veya PWA ortamında zamanı gelen bildirimi tetikler)
export async function checkAndTriggerSchedules() {
  const activeUid = auth.currentUser?.uid;
  if (!activeUid) return;

  const now = new Date();
  // 1 = Pazar, 2 = Pazartesi ... 7 = Cumartesi (Expo/JS Date standardı)
  const currentWeekday = now.getDay() + 1;
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  const minuteKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${currentHour}:${currentMinute}`;
  if (lastTriggeredMinuteKey === minuteKey) return;

  const schedules = await getSchedules(activeUid);
  const due = schedules.filter(
    (schedule) =>
      schedule &&
      Array.isArray(schedule.weekdays) &&
      schedule.weekdays.includes(currentWeekday) &&
      Number(schedule.hour) === currentHour &&
      Number(schedule.minute) === currentMinute
  );
  if (due.length === 0) return;

  // Önce dakikayı işaretle: bildirim gösterimi sürerken ikinci tetikleme gelmesin.
  lastTriggeredMinuteKey = minuteKey;

  // Aynı dakikaya denk gelen TÜM zamanlamalar gösterilir; her biri kendi etiketiyle
  // (tag) gönderilir ki biri diğerinin üzerine yazmasın.
  for (const schedule of due) {
    await sendWebNotification(
      'J-Planning Hatırlatması 🔔',
      schedule.label || schedule.body || 'Görevlerine göz atmayı unutma!',
      `j-planning-schedule-${schedule.id || 'x'}`
    );
  }
}

// Uygulama açık olduğu sürece her 15 saniyede bir zamanlamaları kontrol et
if (typeof window !== 'undefined') {
  setInterval(checkAndTriggerSchedules, 15000);
}

const WORKER_URL = (import.meta.env.VITE_WORKER_URL || '/api/worker').replace(/\/+$/, '');

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
  } catch (_) {}

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
    body: JSON.stringify({ reminderEnabled, reminderHour }),
  });

  if (!res.ok) {
    let errMessage = 'Hatırlatıcı ayarları kaydedilemedi.';
    try {
      const data = await res.json();
      if (data.message) errMessage = data.message;
    } catch (_) {}
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
  } catch (_) {}

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
    } catch (_) {}
    throw new Error(errMessage);
  }

  return res.json();
}
