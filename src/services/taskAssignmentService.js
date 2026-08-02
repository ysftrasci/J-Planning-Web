// J-Planning — Arkadaşa Görev Atama (Doküman bölüm 7.2)
// Firestore üzerinden gerçek zamanlı çalışır.
//
// Koleksiyon yapısı: assignedTasks/{id}
//   assignedByUid, assignedByName  -> atayan kişi
//   assignedToUid, assignedToName  -> atanan kişi
//   title, priority, period
//   status: 'PENDING' | 'ACCEPTED' | 'REJECTED'
//   completedAt, isLateMarked vb. -> atanan kişi tamamladıkça güncellenir

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
import { getUserProfile } from '../db/userProfileRepository';

const assignedTasksRef = collection(db, 'assignedTasks');

const VALID_PRIORITIES = ['HIGH', 'MEDIUM', 'LOW', 'ZERO'];
const VALID_PERIODS = ['DAILY', 'WEEKLY', 'MONTHLY', 'ONCE'];

export async function assignTaskToFriend({ assignedByUid, assignedByName, assignedToUid, assignedToName, title, priority, period, subtaskCount, subtaskLabels }) {
  const cleanTitle = (title || '').trim().slice(0, 300);
  if (!cleanTitle) throw new Error('Görev adı boş olamaz.');

  const cleanPriority = typeof priority === 'string' && VALID_PRIORITIES.includes(priority.toUpperCase()) ? priority.toUpperCase() : 'MEDIUM';
  const cleanPeriod = typeof period === 'string' && VALID_PERIODS.includes(period.toUpperCase()) ? period.toUpperCase() : 'DAILY';
  const count = Math.max(1, Math.min(100, parseInt(subtaskCount, 10) || 1));

  await addDoc(assignedTasksRef, {
    assignedByUid,
    assignedByName: (assignedByName || 'Kullanıcı').slice(0, 100),
    assignedToUid,
    assignedToName: (assignedToName || 'Arkadaşın').slice(0, 100),
    title: cleanTitle,
    priority: cleanPriority,
    period: cleanPeriod,
    subtaskCount: count,
    subtaskLabels: Array.isArray(subtaskLabels) ? subtaskLabels.map((l) => String(l || '').slice(0, 200)) : null,
    status: 'PENDING',
    createdAt: serverTimestamp(),
  });
}

export async function acceptAssignedTask(taskId) {
  await updateDoc(doc(db, 'assignedTasks', taskId), { status: 'ACCEPTED' });
}

export async function rejectAssignedTask(taskId) {
  await deleteDoc(doc(db, 'assignedTasks', taskId));
}

// Atanan kişi: kendisine gelen, henüz kabul edilmemiş görevleri dinler.
export function listenPendingTasksAssignedToMe(currentUserUid, callback) {
  const q = query(
    assignedTasksRef,
    where('assignedToUid', '==', currentUserUid),
    where('status', '==', 'PENDING')
  );
  return onSnapshot(q, async (snap) => {
    const rawTasks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    // assignedByName, atama anındaki ismi saklar (snapshot) — göstermeden
    // önce arkadaşın güncel profilinden ismi tazele.
    const enriched = await Promise.all(
      rawTasks.map(async (task) => {
        try {
          const profile = await getUserProfile(task.assignedByUid);
          if (profile?.displayName) {
            return { ...task, assignedByName: profile.displayName };
          }
        } catch (e) {
          // Profil okunamazsa elimizdeki isimle devam et.
        }
        return task;
      })
    );
    callback(enriched);
  });
}

// Atanan kişi: kabul ettiği (aktif) atanmış görevleri dinler.
export function listenAcceptedTasksAssignedToMe(currentUserUid, callback) {
  const q = query(
    assignedTasksRef,
    where('assignedToUid', '==', currentUserUid),
    where('status', '==', 'ACCEPTED')
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

// Atayan kişi: kendisinin atadığı görevlerin durumunu izler (tamamlandı mı, ne zaman).
export function listenTasksIAssigned(currentUserUid, callback) {
  const q = query(assignedTasksRef, where('assignedByUid', '==', currentUserUid));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

// Atanan kişi görevi tamamladığında/geri aldığında, atayan kişinin gerçek
// zamanlı olarak görebilmesi için Firestore'daki assignedTasks dokümanına
// güncel durumu yazar. firestoreAssignmentId, kabul sırasında SQLite'a
// kaydedilen referanstır (bkz. taskRepository.createTaskFromAssignment).
export async function syncCompletionStatusToFirestore(firestoreAssignmentId, { isCompleted, completedSubtasks, subtaskCount }) {
  if (!firestoreAssignmentId) return;
  try {
    await updateDoc(doc(db, 'assignedTasks', firestoreAssignmentId), {
      isCompletedToday: isCompleted,
      completedSubtasks: completedSubtasks ?? 0,
      subtaskCount: subtaskCount ?? 1,
      lastUpdatedAt: serverTimestamp(),
    });
  } catch (e) {
    // Firestore'a yazılamazsa (ör. internet yok) sessizce geç — yerel
    // (SQLite) durum zaten doğru, bir sonraki bağlantıda senkronize
    // etmeye çalışmak ileri bir geliştirme olabilir.
  }
}
