import { getToken, onMessage } from 'firebase/messaging';
import { doc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { db, messaging, auth } from './firebase';

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

export async function registerFCMPushToken(userUid) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return null;
  if (!messaging) return null;

  try {
    let serviceWorkerRegistration;
    if ('serviceWorker' in navigator) {
      serviceWorkerRegistration = await navigator.serviceWorker.ready;
    }

    const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY || undefined;
    const token = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration,
    });

    if (token && userUid) {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('jplanning:current_fcm_token', token);
      }
      const userRef = doc(db, 'users', userUid);
      await updateDoc(userRef, {
        fcmTokens: arrayUnion(token),
        lastPushTokenAt: Date.now(),
      }).catch(() => {});
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
    if (messaging && 'Notification' in window && Notification.permission === 'granted') {
      let serviceWorkerRegistration;
      if ('serviceWorker' in navigator) {
        serviceWorkerRegistration = await navigator.serviceWorker.ready;
      }
      const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY || undefined;
      token = await getToken(messaging, {
        vapidKey,
        serviceWorkerRegistration,
      }).catch(() => null);
    }

    const storedToken = typeof localStorage !== 'undefined' ? localStorage.getItem('jplanning:current_fcm_token') : null;
    const targetToken = token || storedToken;

    if (targetToken && userUid) {
      const userRef = doc(db, 'users', userUid);
      await updateDoc(userRef, {
        fcmTokens: arrayRemove(targetToken),
      }).catch(() => {});
    }

    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('jplanning:current_fcm_token');
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
export async function sendWebNotification(title, body) {
  if (!('Notification' in window)) return false;
  if (Notification.permission !== 'granted') return false;

  const payload = {
    title,
    body: body || 'Görevlerine göz atmayı unutma!',
    icon: '/favicon.svg',
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
    new Notification(payload.title, { body: payload.body, icon: payload.icon });
    return true;
  } catch (e) {
    console.warn('Web bildirim hatası:', e);
  }

  return false;
}

export async function getSchedules(uid) {
  const key = getStorageKey(uid);
  if (!key) return [];
  const raw = localStorage.getItem(key);
  return raw ? JSON.parse(raw) : [];
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
  for (const schedule of schedules) {
    if (
      schedule.weekdays.includes(currentWeekday) &&
      schedule.hour === currentHour &&
      schedule.minute === currentMinute
    ) {
      lastTriggeredMinuteKey = minuteKey;
      await sendWebNotification(
        'J-Planning Hatırlatması 🔔',
        schedule.label || schedule.body || 'Görevlerine göz atmayı unutma!'
      );
      break;
    }
  }
}

// Uygulama açık olduğu sürece her 15 saniyede bir zamanlamaları kontrol et
if (typeof window !== 'undefined') {
  setInterval(checkAndTriggerSchedules, 15000);
}
