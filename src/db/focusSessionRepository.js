// J-Planning — Odaklanma Seansı Kayıtları
// Her başarıyla tamamlanan (erken bitirilmemiş) seans burada saklanır.
// Görevlerdeki periyot/tekrar kavramı yok — her seans bağımsız bir olay.
// Ay bazlı geçmiş görüntüleme için monthKey (YYYY-MM) kullanılır.

import { getDb } from './database';
import { triggerAutoCloudSyncForCurrentUser } from '../services/cloudSyncService';

export function generateSessionId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function monthKeyOf(date) {
  return date.toISOString().slice(0, 7); // "2026-07"
}

export async function recordFocusSession({ sessionId, durationMinutes, soundKey, jpEarned, awardedMilestones }) {
  const db = getDb();
  const id = sessionId || generateSessionId();
  const now = new Date();

  // Önce awardedMilestones kolonu eklemeyi dene (yoksa ekler, varsa no-op)
  try {
    await db.runAsync('ALTER TABLE focus_sessions ADD COLUMN awardedMilestones TEXT');
  } catch (_) {}

  const awardedJson = Array.isArray(awardedMilestones) ? JSON.stringify(awardedMilestones) : null;
  try {
    await db.runAsync(
      `INSERT INTO focus_sessions (id, durationMinutes, soundKey, jpEarned, monthKey, completedAt, awardedMilestones)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         durationMinutes = excluded.durationMinutes,
         soundKey = COALESCE(excluded.soundKey, focus_sessions.soundKey),
         jpEarned = excluded.jpEarned,
         completedAt = excluded.completedAt,
         awardedMilestones = excluded.awardedMilestones`,
      [id, durationMinutes, soundKey || null, jpEarned || 0, monthKeyOf(now), now.getTime(), awardedJson]
    );
  } catch (_) {
    // Kolon henüz yoksa eski şemayla yaz
    await db.runAsync(
      `INSERT INTO focus_sessions (id, durationMinutes, soundKey, jpEarned, monthKey, completedAt)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         durationMinutes = excluded.durationMinutes,
         soundKey = COALESCE(excluded.soundKey, focus_sessions.soundKey),
         jpEarned = excluded.jpEarned,
         completedAt = excluded.completedAt`,
      [id, durationMinutes, soundKey || null, jpEarned || 0, monthKeyOf(now), now.getTime()]
    );
  }
  triggerAutoCloudSyncForCurrentUser();
  return id;
}

/**
 * Odaklanma seansında kazanılan milestone ödüllerini cüzdana ve seans tablosuna
 * atomik ve idempotent şekilde kaydeder.
 * - Aynı seans ve aynı milestone için wallet_transactions'a tek bir kayıt yazılır (`focus_${sessionId}_${min}`).
 * - React StrictMode çift effect veya paralel çağrılarda asla mükerrer JP verilmez.
 * - focus_sessions kaydı aynı seans ID'si ile güncellenir.
 */
export async function awardFocusMilestone({
  sessionId,
  durationMinutes,
  soundKey,
  newMilestones, // Array of { min: number, jp: number }
  awardedMins,   // Set or Array of all awarded milestone mins so far
}) {
  const db = getDb();
  if (!sessionId || !newMilestones || newMilestones.length === 0) {
    return { addedJp: 0, totalSessionJp: 0 };
  }

  try {
    await db.runAsync('ALTER TABLE focus_sessions ADD COLUMN awardedMilestones TEXT');
  } catch (_) {}

  let totalAddedJp = 0;
  const now = Date.now();

  for (const m of newMilestones) {
    const txId = `focus_${sessionId}_${m.min}`;
    // Idempotency kontrolü: Bu seans ve bu milestone için daha önce cüzdan hareketi yazılmış mı?
    const existingTx = await db.getFirstAsync(
      'SELECT id FROM wallet_transactions WHERE id = ?',
      [txId]
    );

    if (!existingTx && m.jp > 0) {
      await db.runAsync(
        `INSERT INTO wallet_transactions (id, userId, amount, reason, relatedTaskId, relatedRewardId, createdAt)
         VALUES (?, 'me', ?, 'FOCUS_SESSION', NULL, NULL, ?)`,
        [txId, m.jp, now]
      );
      await db.runAsync(
        `INSERT INTO wallet (userId, balance) VALUES ('me', ?)
         ON CONFLICT(userId) DO UPDATE SET balance = balance + excluded.balance`,
        [m.jp]
      );
      totalAddedJp += m.jp;
    }
  }

  // Seansın toplam JP'sini hesapla (bu seansta wallet_transactions'tan kazanılan)
  const totalJpRow = await db.getFirstAsync(
    `SELECT COALESCE(SUM(amount), 0) as total FROM wallet_transactions WHERE id LIKE ?`,
    [`focus_${sessionId}_%`]
  );
  const sessionTotalJp = totalJpRow ? Number(totalJpRow.total) : 0;

  // focus_sessions kaydını upsert et
  const awardedList = Array.isArray(awardedMins)
    ? awardedMins
    : Array.from(awardedMins || []);
  const awardedJson = JSON.stringify(awardedList);
  const monthKey = monthKeyOf(new Date(now));

  try {
    await db.runAsync(
      `INSERT INTO focus_sessions (id, durationMinutes, soundKey, jpEarned, monthKey, completedAt, awardedMilestones)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         durationMinutes = excluded.durationMinutes,
         soundKey = COALESCE(excluded.soundKey, focus_sessions.soundKey),
         jpEarned = excluded.jpEarned,
         completedAt = excluded.completedAt,
         awardedMilestones = excluded.awardedMilestones`,
      [sessionId, durationMinutes, soundKey || null, sessionTotalJp, monthKey, now, awardedJson]
    );
  } catch (_) {
    await db.runAsync(
      `INSERT INTO focus_sessions (id, durationMinutes, soundKey, jpEarned, monthKey, completedAt)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         durationMinutes = excluded.durationMinutes,
         soundKey = COALESCE(excluded.soundKey, focus_sessions.soundKey),
         jpEarned = excluded.jpEarned,
         completedAt = excluded.completedAt`,
      [sessionId, durationMinutes, soundKey || null, sessionTotalJp, monthKey, now]
    );
  }

  triggerAutoCloudSyncForCurrentUser();
  return { addedJp: totalAddedJp, totalSessionJp: sessionTotalJp };
}

/**
 * Seansı bitirirken gerçek geçen süreyi (dakika) günceller.
 * Yalnızca daha önce kaydedilmiş bir seans varsa (yani en az 1 milestone kazanılmışsa) günceller.
 */
export async function finalizeFocusSession({ sessionId, durationMinutes }) {
  const db = getDb();
  if (!sessionId) return;
  const existing = await db.getFirstAsync('SELECT id FROM focus_sessions WHERE id = ?', [sessionId]);
  if (!existing) return; // 30 dakikadan önce bitirildiyse kayıt açılmamıştır, hiçbir şey yapma

  await db.runAsync(
    `UPDATE focus_sessions SET durationMinutes = ?, completedAt = ? WHERE id = ?`,
    [durationMinutes, Date.now(), sessionId]
  );
  triggerAutoCloudSyncForCurrentUser();
}

export async function getFocusSessions() {
  const db = getDb();
  return db.getAllAsync('SELECT * FROM focus_sessions ORDER BY completedAt DESC');
}

export async function getAvailableFocusMonths() {
  const db = getDb();
  const rows = await db.getAllAsync('SELECT DISTINCT monthKey FROM focus_sessions ORDER BY monthKey DESC');
  return rows.map((r) => r.monthKey);
}

export async function getFocusSessionsForMonth(monthKey) {
  const db = getDb();
  return db.getAllAsync(
    'SELECT * FROM focus_sessions WHERE monthKey = ? ORDER BY completedAt DESC',
    [monthKey]
  );
}
