// J-Planning — Arkadaşa Ödül Hedefi Atama (Doküman bölüm 6.3)
// Görev atama ile aynı mantık: kabul/red akışı gerekli.
//
// Koleksiyon yapısı: assignedRewards/{id}
//   assignedByUid, assignedByName  -> hedefi koyan kişi
//   assignedToUid, assignedToName  -> hedef kendisine konan kişi
//   title, description, cost
//   status: 'PENDING' | 'ACCEPTED'

import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';

const assignedRewardsRef = collection(db, 'assignedRewards');

export async function assignRewardToFriend({ assignedByUid, assignedByName, assignedToUid, assignedToName, title, description, cost }) {
  await addDoc(assignedRewardsRef, {
    assignedByUid,
    assignedByName,
    assignedToUid,
    assignedToName,
    title,
    description: description || '',
    cost,
    status: 'PENDING',
    createdAt: serverTimestamp(),
  });
}

export async function acceptAssignedReward(rewardId) {
  await updateDoc(doc(db, 'assignedRewards', rewardId), { status: 'ACCEPTED' });
}

export async function rejectAssignedReward(rewardId) {
  await deleteDoc(doc(db, 'assignedRewards', rewardId));
}

export function listenPendingRewardsAssignedToMe(currentUserUid, callback) {
  const q = query(
    assignedRewardsRef,
    where('assignedToUid', '==', currentUserUid),
    where('status', '==', 'PENDING')
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}
