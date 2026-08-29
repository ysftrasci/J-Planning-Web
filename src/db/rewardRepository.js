// J-Planning — Ödül Hedefleri Repository (Doküman bölüm 6.3)

import { getDb } from './database';
import { getWalletBalance, addWalletTransaction } from './taskRepository';
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

export async function createReward({ title, description, cost, assignedByUserId, assignedByName }) {
  const db = getDb();
  const id = generateId();
  await db.runAsync(
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
  triggerAutoCloudSyncForCurrentUser();
  return id;
}

export async function getActiveRewards() {
  const db = getDb();
  return db.getAllAsync(
    `SELECT * FROM rewards WHERE isRedeemed = 0 AND assignmentStatus != 'PENDING_ACCEPT' ORDER BY createdAt DESC`
  );
}

export async function getRedeemedRewards() {
  const db = getDb();
  return db.getAllAsync(
    `SELECT * FROM rewards WHERE isRedeemed = 1 ORDER BY redeemedAt DESC`
  );
}

export async function deleteReward(rewardId) {
  const db = getDb();
  await db.runAsync('DELETE FROM rewards WHERE id = ?', [rewardId]);
  triggerAutoCloudSyncForCurrentUser();
}

export async function redeemReward(rewardId) {
  const db = getDb();
  const reward = await db.getFirstAsync('SELECT * FROM rewards WHERE id = ?', [rewardId]);
  if (!reward) throw new Error('Ödül bulunamadı');
  if (reward.isRedeemed) throw new Error('Bu ödül zaten harcanmış');

  const balance = await getWalletBalance('me');
  if (balance < reward.cost) {
    throw new Error('Yeterli JP bakiyeniz yok');
  }

  await db.runAsync('UPDATE rewards SET isRedeemed = 1, redeemedAt = ? WHERE id = ?', [Date.now(), rewardId]);
  await addWalletTransaction('me', -reward.cost, 'REWARD_REDEEM', null, rewardId);
  triggerAutoCloudSyncForCurrentUser();
}
