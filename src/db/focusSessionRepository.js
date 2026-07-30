// J-Planning — Odaklanma Seansı Kayıtları
// Her başarıyla tamamlanan (erken bitirilmemiş) seans burada saklanır.
// Görevlerdeki periyot/tekrar kavramı yok — her seans bağımsız bir olay.
// Ay bazlı geçmiş görüntüleme için monthKey (YYYY-MM) kullanılır.

import { getDb } from './database';

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function monthKeyOf(date) {
  return date.toISOString().slice(0, 7); // "2026-07"
}

export function recordFocusSession({ durationMinutes, soundKey, jpEarned }) {
  const db = getDb();
  const now = new Date();
  db.runSync(
    `INSERT INTO focus_sessions (id, durationMinutes, soundKey, jpEarned, monthKey, completedAt)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [uuid(), durationMinutes, soundKey || null, jpEarned || 0, monthKeyOf(now), now.getTime()]
  );
}

export function getFocusSessions() {
  const db = getDb();
  return db.getAllSync('SELECT * FROM focus_sessions ORDER BY completedAt DESC');
}

export function getAvailableFocusMonths() {
  const db = getDb();
  const rows = db.getAllSync('SELECT DISTINCT monthKey FROM focus_sessions ORDER BY monthKey DESC');
  return rows.map((r) => r.monthKey);
}

export function getFocusSessionsForMonth(monthKey) {
  const db = getDb();
  return db.getAllSync(
    'SELECT * FROM focus_sessions WHERE monthKey = ? ORDER BY completedAt DESC',
    [monthKey]
  );
}
