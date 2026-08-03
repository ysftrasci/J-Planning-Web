import { getDb } from './database';
import { uuid } from './taskRepository';
import { triggerAutoCloudSyncForCurrentUser } from '../services/cloudSyncService';

export function getDailyNote(dateKey) {
  const db = getDb();
  return db.getFirstSync('SELECT * FROM daily_notes WHERE dateKey = ?', [dateKey]);
}

export function saveDailyNote(dateKey, content, studyTimeText) {
  const db = getDb();
  const existing = getDailyNote(dateKey);
  const now = Date.now();
  const text = (content || '').trim();
  const studyText = (studyTimeText || '').trim();

  if (existing) {
    if (!text && !studyText) {
      db.runSync('DELETE FROM daily_notes WHERE id = ?', [existing.id]);
    } else {
      db.runSync(
        'UPDATE daily_notes SET content = ?, studyTimeText = ?, updatedAt = ? WHERE id = ?',
        [text, studyText || null, now, existing.id]
      );
    }
  } else if (text || studyText) {
    db.runSync(
      'INSERT INTO daily_notes (id, dateKey, content, studyTimeText, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
      [uuid(), dateKey, text, studyText || null, now, now]
    );
  }
  triggerAutoCloudSyncForCurrentUser();
}

export function deleteDailyNote(dateKey) {
  const db = getDb();
  db.runSync('DELETE FROM daily_notes WHERE dateKey = ?', [dateKey]);
  triggerAutoCloudSyncForCurrentUser();
}

export function getDailyNotesByMonth(monthKey) {
  const db = getDb();
  return db.getAllSync(
    'SELECT * FROM daily_notes WHERE dateKey LIKE ? ORDER BY dateKey DESC',
    [`${monthKey}-%`]
  );
}

export function getAllDailyNoteMonths() {
  const db = getDb();
  const rows = db.getAllSync('SELECT DISTINCT substr(dateKey, 1, 7) as monthKey FROM daily_notes ORDER BY monthKey DESC');
  const months = rows.map((r) => r.monthKey);
  const currentMonth = new Date().toISOString().slice(0, 7);
  if (!months.includes(currentMonth)) {
    months.unshift(currentMonth);
  }
  return months;
}
