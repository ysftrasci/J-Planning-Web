// J-Planning — Bildirim Servisi (Web)
//
// Web ortamında zamanlamalar localStorage üzerinde saklanır.
// Web Notification API (veya PWA Service Worker bildirimleri) entegrasyonu sağlar.

const STORAGE_KEY = 'jplanning:notification_schedules';

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
