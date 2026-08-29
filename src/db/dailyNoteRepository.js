import { getDb } from './database';
import { triggerAutoCloudSyncForCurrentUser } from '../services/cloudSyncService';

function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function getDailyNote(dateKey) {
  const db = getDb();
  return db.getFirstAsync('SELECT * FROM daily_notes WHERE dateKey = ?', [dateKey]);
}

export async function saveDailyNote(dateKey, content, studyTimeText) {
  const db = getDb();
  const existing = await getDailyNote(dateKey);
  const now = Date.now();
  const text = (content || '').trim();
  const studyText = (studyTimeText || '').trim();

  if (existing) {
    if (!text && !studyText) {
      await db.runAsync('DELETE FROM daily_notes WHERE id = ?', [existing.id]);
    } else {
      await db.runAsync(
        'UPDATE daily_notes SET content = ?, studyTimeText = ?, updatedAt = ? WHERE id = ?',
        [text, studyText || null, now, existing.id]
      );
    }
  } else if (text || studyText) {
    await db.runAsync(
      'INSERT INTO daily_notes (id, dateKey, content, studyTimeText, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
      [generateId(), dateKey, text, studyText || null, now, now]
    );
  }
  triggerAutoCloudSyncForCurrentUser();
}

export async function deleteDailyNote(dateKeyOrId) {
  const db = getDb();
  await db.runAsync('DELETE FROM daily_notes WHERE dateKey = ? OR id = ?', [dateKeyOrId, dateKeyOrId]);
  triggerAutoCloudSyncForCurrentUser();
}

export async function getDailyNotesByMonth(monthKey) {
  const db = getDb();
  return db.getAllAsync(
    'SELECT * FROM daily_notes WHERE dateKey LIKE ? ORDER BY dateKey DESC',
    [`${monthKey}-%`]
  );
}

export async function getAllDailyNoteMonths() {
  const db = getDb();
  const rows = await db.getAllAsync(
    'SELECT DISTINCT substr(dateKey, 1, 7) as monthKey FROM daily_notes ORDER BY monthKey DESC'
  );
  const months = rows.map((r) => r.monthKey);
  const currentMonth = new Date().toISOString().slice(0, 7);
  if (!months.includes(currentMonth)) {
    months.unshift(currentMonth);
  }
  return months;
}
