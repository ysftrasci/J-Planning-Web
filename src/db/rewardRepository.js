// J-Planning — Ödül Hedefleri Repository (Doküman bölüm 6.3)

import { getDb } from './database';
import { uuid, getWalletBalance, addWalletTransaction } from './taskRepository';

export function createReward({ title, description, cost, assignedByUserId, assignedByName }) {
  const db = getDb();
  const id = uuid();
  db.runSync(
    `INSERT INTO rewards (id, title, description, cost, ownerUserId, assignedByUserId, assignedByName, assignmentStatus, createdAt)
     VALUES (?, ?, ?, ?, 'me', ?, ?, ?, ?)`,
    [
      id,
      title,
      description ?? '',
      cost,
      assignedByUserId ?? null,
      assignedByName ?? null,
      assignedByUserId ? 'PENDING_ACCEPT' : 'NONE',
      Date.now(),
    ]
  );
  return id;
}

export function getActiveRewards() {
  const db = getDb();
  return db.getAllSync(
    `SELECT * FROM rewards WHERE isRedeemed = 0 AND assignmentStatus != 'PENDING_ACCEPT' ORDER BY createdAt DESC`
  );
}

export function getRedeemedRewards() {
  const db = getDb();
  return db.getAllSync(
    `SELECT * FROM rewards WHERE isRedeemed = 1 ORDER BY redeemedAt DESC`
  );
}

export function deleteReward(rewardId) {
  const db = getDb();
  db.runSync('DELETE FROM rewards WHERE id = ?', [rewardId]);
}

export function redeemReward(rewardId) {
  const db = getDb();
  const reward = db.getFirstSync('SELECT * FROM rewards WHERE id = ?', [rewardId]);
  if (!reward) throw new Error('Ödül bulunamadı');
  if (reward.isRedeemed) throw new Error('Bu ödül zaten harcanmış');

  const balance = getWalletBalance('me');
  if (balance < reward.cost) {
    throw new Error('Yeterli JP bakiyeniz yok');
  }

  db.runSync('UPDATE rewards SET isRedeemed = 1, redeemedAt = ? WHERE id = ?', [Date.now(), rewardId]);
  addWalletTransaction('me', -reward.cost, 'REWARD_REDEEM', null, rewardId);
}
