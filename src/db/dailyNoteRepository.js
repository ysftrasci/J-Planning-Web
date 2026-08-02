import { getDb } from './database';
import { uuid } from './taskRepository';

export function getDailyNote(dateKey) {
  const db = getDb();
  return db.getFirstSync('SELECT * FROM daily_notes WHERE dateKey = ?', [dateKey]);
}

export function saveDailyNote(dateKey, content) {
  const db = getDb();
  const existing = getDailyNote(dateKey);
  const now = Date.now();
  const text = (content || '').trim();

  if (existing) {
    if (!text) {
      db.runSync('DELETE FROM daily_notes WHERE id = ?', [existing.id]);
    } else {
      db.runSync('UPDATE daily_notes SET content = ?, updatedAt = ? WHERE id = ?', [text, now, existing.id]);
    }
  } else if (text) {
    db.runSync(
      'INSERT INTO daily_notes (id, dateKey, content, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)',
      [uuid(), dateKey, text, now, now]
    );
  }
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
