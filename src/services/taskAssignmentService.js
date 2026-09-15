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
import { db, auth } from './firebase';
import { getUserProfile } from '../db/userProfileRepository';
import { sendPushNotification } from './pushNotificationClient';

const assignedTasksRef = collection(db, 'assignedTasks');
const taskDeletionNoticesRef = collection(db, 'taskDeletionNotices');

const VALID_PRIORITIES = ['HIGH', 'MEDIUM', 'LOW', 'ZERO'];
const VALID_PERIODS = ['DAILY', 'WEEKLY', 'MONTHLY', 'ONCE'];

export async function assignTaskToFriend({ assignedByUid, assignedByName, assignedToUid, assignedToName, title, description, priority, period, subtaskCount, subtaskLabels }) {
  const cleanTitle = (title || '').trim().slice(0, 300);
  if (!cleanTitle) throw new Error('Görev adı boş olamaz.');

  const cleanPriority = typeof priority === 'string' && VALID_PRIORITIES.includes(priority.toUpperCase()) ? priority.toUpperCase() : 'MEDIUM';
  const cleanPeriod = typeof period === 'string' && VALID_PERIODS.includes(period.toUpperCase()) ? period.toUpperCase() : 'DAILY';
  const count = Math.max(1, Math.min(100, parseInt(subtaskCount, 10) || 1));
  const descText = typeof description === 'string' && description.trim() ? description.trim().slice(0, 1000) : null;

  const docRef = await addDoc(assignedTasksRef, {
    assignedByUid,
    assignedByName: (assignedByName || 'Kullanıcı').slice(0, 100),
    assignedToUid,
    assignedToName: (assignedToName || 'Arkadaşın').slice(0, 100),
    title: cleanTitle,
    description: descText,
    priority: cleanPriority,
    period: cleanPeriod,
    subtaskCount: count,
    subtaskLabels: Array.isArray(subtaskLabels) ? subtaskLabels.map((l) => String(l || '').slice(0, 200)) : null,
    status: 'PENDING',
    createdAt: serverTimestamp(),
  });

  // Anlık Web Push Bildirimi Gönder (Fire-and-forget)
  sendPushNotification('TASK_ASSIGNED', assignedToUid, {
    senderName: assignedByName,
    taskTitle: cleanTitle,
  }).catch(() => {});

  return docRef.id;
}

export async function updateAssignedTaskInFirestore(firestoreAssignmentId, { title, description, priority, period, subtaskCount, subtaskLabels }) {
  if (!firestoreAssignmentId) return;
  const cleanTitle = (title || '').trim().slice(0, 300);
  if (!cleanTitle) throw new Error('Görev adı boş olamaz.');

  const cleanPriority = typeof priority === 'string' && VALID_PRIORITIES.includes(priority.toUpperCase()) ? priority.toUpperCase() : 'MEDIUM';
  const cleanPeriod = typeof period === 'string' && VALID_PERIODS.includes(period.toUpperCase()) ? period.toUpperCase() : 'DAILY';
  const count = Math.max(1, Math.min(100, parseInt(subtaskCount, 10) || 1));
  const descText = typeof description === 'string' && description.trim() ? description.trim().slice(0, 1000) : null;

  await updateDoc(doc(db, 'assignedTasks', firestoreAssignmentId), {
    title: cleanTitle,
    description: descText,
    priority: cleanPriority,
    period: cleanPeriod,
    subtaskCount: count,
    subtaskLabels: Array.isArray(subtaskLabels) ? subtaskLabels.map((l) => String(l || '').slice(0, 200)) : null,
    updatedAt: serverTimestamp(),
  });
}

export async function acceptAssignedTask(taskId) {
  await updateDoc(doc(db, 'assignedTasks', taskId), { status: 'ACCEPTED' });
}

export async function rejectAssignedTask(taskId) {
  await deleteDoc(doc(db, 'assignedTasks', taskId));
}

export async function deleteAssignedTaskInFirestore(firestoreAssignmentId) {
  if (!firestoreAssignmentId) return;
  await deleteDoc(doc(db, 'assignedTasks', firestoreAssignmentId));
}

export async function deleteAssignedTask(firestoreAssignmentId) {
  if (!firestoreAssignmentId) return;
  await deleteAssignedTaskInFirestore(firestoreAssignmentId);
}

// Atanan kişi: kendisine gelen, henüz kabul edilmemiş görevleri dinler.
export function listenPendingTasksAssignedToMe(currentUserUid, callback, onError) {
  const q = query(
    assignedTasksRef,
    where('assignedToUid', '==', currentUserUid),
    where('status', '==', 'PENDING')
  );
  return onSnapshot(
    q,
    async (snap) => {
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
    },
    (error) => {
      console.error('[TaskAssignment] listenPendingTasks error:', error);
      if (onError) onError(error);
    }
  );
}

// Atanan kişi: kabul ettiği (aktif) atanmış görevleri dinler.
export function listenAcceptedTasksAssignedToMe(currentUserUid, callback, onError) {
  const q = query(
    assignedTasksRef,
    where('assignedToUid', '==', currentUserUid),
    where('status', '==', 'ACCEPTED')
  );
  return onSnapshot(
    q,
    (snap) => {
      callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    },
    (error) => {
      console.error('[TaskAssignment] listenAcceptedTasks error:', error);
      if (onError) onError(error);
    }
  );
}

// Atayan kişi: kendisinin atadığı görevlerin durumunu izler (tamamlandı mı, ne zaman).
export function listenTasksIAssigned(currentUserUid, callback, onError) {
  const q = query(assignedTasksRef, where('assignedByUid', '==', currentUserUid));
  return onSnapshot(
    q,
    (snap) => {
      callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    },
    (error) => {
      console.error('[TaskAssignment] listenTasksIAssigned error:', error);
      if (onError) onError(error);
    }
  );
}

// Atanan kişi görevi tamamladığında/geri aldığında, atayan kişinin gerçek
// zamanlı olarak görebilmesi için Firestore'daki assignedTasks dokümanına
// güncel durumu yazar. firestoreAssignmentId, kabul sırasında SQLite'a
// kaydedilen referanstır (bkz. taskRepository.createTaskFromAssignment).
export async function syncCompletionStatusToFirestore(firestoreAssignmentId, {
  isCompleted,
  completedSubtasks,
  subtaskCount,
  periodKey,
  assignedByUid,
  taskTitle,
  completedByName,
  isNewlyCompleted,
}) {
  if (!firestoreAssignmentId) return;
  try {
    await updateDoc(doc(db, 'assignedTasks', firestoreAssignmentId), {
      isCompleted: !!isCompleted,
      completedPeriodKey: periodKey ?? null,
      completedSubtasks: completedSubtasks ?? 0,
      subtaskCount: subtaskCount ?? 1,
      lastUpdatedAt: serverTimestamp(),
    });

    if (isNewlyCompleted && assignedByUid) {
      sendPushNotification('TASK_COMPLETED', assignedByUid, {
        senderName: completedByName || auth.currentUser?.displayName || 'Arkadaşın',
        taskTitle: taskTitle || '',
      }).catch(() => {});
    }
  } catch (e) {
    // Firestore'a yazılamazsa (ör. internet yok) sessizce geç — yerel
    // (SQLite) durum zaten doğru, bir sonraki bağlantıda senkronize
    // etmeye çalışmak ileri bir geliştirme olabilir.
  }
}

// B, kendisine atanan görevi sildiğinde A'ya haber vermek için bildirim oluşturur.
export async function notifyTaskDeletion(assignedByUid, taskTitle, deletedByName) {
  const currentUid = auth.currentUser?.uid;
  if (!assignedByUid || !currentUid) return;
  try {
    await addDoc(taskDeletionNoticesRef, {
      assignedByUid,
      deletedByUid: currentUid,
      taskTitle: String(taskTitle || '').slice(0, 300),
      deletedByName: String(deletedByName || auth.currentUser?.displayName || 'Arkadaşın').slice(0, 100),
      createdAt: serverTimestamp(),
    });

    // Anlık Web Push Bildirimi Gönder (Fire-and-forget)
    sendPushNotification('TASK_DELETED', assignedByUid, {
      senderName: deletedByName || auth.currentUser?.displayName || 'Arkadaşın',
      taskTitle: String(taskTitle || ''),
    }).catch(() => {});
  } catch (e) {
    console.warn('[TaskAssignment] notifyTaskDeletion error:', e);
  }
}

// Atayan kişi (A): arkadaşının sildiği görevlere ait bildirimleri dinler.
export function listenTaskDeletionNotices(currentUserUid, callback, onError) {
  if (!currentUserUid) return () => {};
  const q = query(
    taskDeletionNoticesRef,
    where('assignedByUid', '==', currentUserUid)
  );
  return onSnapshot(
    q,
    (snap) => {
      callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    },
    (error) => {
      console.error('[TaskAssignment] listenTaskDeletionNotices error:', error);
      if (onError) onError(error);
    }
  );
}

// A bildirimi gördükten sonra kalıcı olmaması için Firestore'dan temizler.
export async function dismissTaskDeletionNotice(noticeId) {
  if (!noticeId) return;
  try {
    await deleteDoc(doc(db, 'taskDeletionNotices', noticeId));
  } catch (e) {
    console.warn('[TaskAssignment] dismissTaskDeletionNotice error:', e);
  }
}

