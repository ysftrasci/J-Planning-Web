// J-Planning — Bildirim Servisi (Web)
//
// Web ortamında zamanlamalar localStorage üzerinde saklanır.
// Web Notification API ile tarayıcı bildirimi gönderilmesi ve arka plan
// kontrol döngüsü sağlanır.

const STORAGE_KEY = 'jplanning:notification_schedules';
let lastTriggeredMinuteKey = '';

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

export async function getSchedules() {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

async function saveSchedules(schedules) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(schedules));
}

export async function addSchedule(schedule) {
  const schedules = await getSchedules();
  const newSchedule = { id: uuid(), ...schedule };
  schedules.push(newSchedule);
  await saveSchedules(schedules);
  return newSchedule.id;
}

export async function updateSchedule(scheduleId, updatedData) {
  const schedules = await getSchedules();
  const updated = schedules.map((s) =>
    s.id === scheduleId ? { ...s, ...updatedData } : s
  );
  await saveSchedules(updated);
}

export async function removeSchedule(scheduleId) {
  const schedules = await getSchedules();
  const updated = schedules.filter((s) => s.id !== scheduleId);
  await saveSchedules(updated);
}

export async function removeAllSchedules() {
  await saveSchedules([]);
}

export function weekdayLabel(value) {
  return WEEKDAYS.find((w) => w.value === value)?.label || '';
}

export function formatTime(hour, minute) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

// Zamanlanmış bildirim kontrolü (Uygulama açıkken veya PWA ortamında zamanı gelen bildirimi tetikler)
export async function checkAndTriggerSchedules() {
  const now = new Date();
  // 1 = Pazar, 2 = Pazartesi ... 7 = Cumartesi (Expo/JS Date standardı)
  const currentWeekday = now.getDay() + 1;
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  const minuteKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${currentHour}:${currentMinute}`;
  if (lastTriggeredMinuteKey === minuteKey) return;

  const schedules = await getSchedules();
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
