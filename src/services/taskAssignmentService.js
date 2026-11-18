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
import { sendPushNotification } from './pushNotificationClient';

const assignedTasksRef = collection(db, 'assignedTasks');
const taskDeletionNoticesRef = collection(db, 'taskDeletionNotices');

const VALID_PRIORITIES = ['HIGH', 'MEDIUM', 'LOW', 'ZERO'];
const VALID_PERIODS = ['DAILY', 'WEEKLY', 'MONTHLY', 'ONCE'];

function cleanCategoryName(categoryName) {
  return typeof categoryName === 'string' && categoryName.trim()
    ? categoryName.trim().slice(0, 100)
    : null;
}

const WORKER_URL = (import.meta.env.VITE_WORKER_URL || '/api/worker').replace(/\/+$/, '');

// Atayan kişi: arkadaşının bu görevdeki ilerlemesi (seri/oran/dönem geçmişi için ham kayıtlar).
// Worker yalnızca görevi atayan kişiye yanıt verir.
export async function getAssignedTaskStats(assignmentId) {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Oturum açmış kullanıcı bulunamadı.');
  const idToken = await currentUser.getIdToken();
  const res = await fetch(`${WORKER_URL}/assigned-tasks/${encodeURIComponent(assignmentId)}/stats`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) throw new Error(data?.message || 'İstatistik alınamadı. Lütfen tekrar dene.');
  return data;
}

export async function assignTaskToFriend({ assignedByUid, assignedByName, assignedToUid, assignedToName, friendshipId, title, description, categoryName, priority, period, intervalValue, subtaskCount, subtaskLabels }) {
  const cleanTitle = (title || '').trim().slice(0, 300);
  if (!cleanTitle) throw new Error('Görev adı boş olamaz.');
  if (!friendshipId) throw new Error('Arkadaş bulunamadı. Arkadaş listesi yüklenince tekrar dene.');

  const cleanPriority = typeof priority === 'string' && VALID_PRIORITIES.includes(priority.toUpperCase()) ? priority.toUpperCase() : 'MEDIUM';
  const cleanPeriod = typeof period === 'string' && VALID_PERIODS.includes(period.toUpperCase()) ? period.toUpperCase() : 'DAILY';
  const interval = Math.max(1, parseInt(intervalValue, 10) || 1);
  const count = Math.max(1, Math.min(100, parseInt(subtaskCount, 10) || 1));
  const descText = typeof description === 'string' && description.trim() ? description.trim().slice(0, 1000) : null;

  const docRef = await addDoc(assignedTasksRef, {
    assignedByUid,
    assignedByName: (assignedByName || 'Kullanıcı').slice(0, 100),
    assignedToUid,
    assignedToName: (assignedToName || 'Arkadaşın').slice(0, 100),
    friendshipId,
    title: cleanTitle,
    description: descText,
    categoryName: cleanCategoryName(categoryName),
    priority: cleanPriority,
    period: cleanPeriod,
    intervalValue: interval,
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

// NOT: categoryName parametresi HİÇ verilmezse (undefined) Firestore'daki mevcut
// kategoriye dokunulmaz. null/boş verilirse kategori kaldırılır.
export async function updateAssignedTaskInFirestore(firestoreAssignmentId, { title, description, categoryName, priority, period, intervalValue, subtaskCount, subtaskLabels }) {
  if (!firestoreAssignmentId) return;
  const cleanTitle = (title || '').trim().slice(0, 300);
  if (!cleanTitle) throw new Error('Görev adı boş olamaz.');

  const cleanPriority = typeof priority === 'string' && VALID_PRIORITIES.includes(priority.toUpperCase()) ? priority.toUpperCase() : 'MEDIUM';
  const cleanPeriod = typeof period === 'string' && VALID_PERIODS.includes(period.toUpperCase()) ? period.toUpperCase() : 'DAILY';
  const interval = Math.max(1, parseInt(intervalValue, 10) || 1);
  const count = Math.max(1, Math.min(100, parseInt(subtaskCount, 10) || 1));
  const descText = typeof description === 'string' && description.trim() ? description.trim().slice(0, 1000) : null;

  const payload = {
    title: cleanTitle,
    description: descText,
    priority: cleanPriority,
    period: cleanPeriod,
    intervalValue: interval,
    subtaskCount: count,
    subtaskLabels: Array.isArray(subtaskLabels) ? subtaskLabels.map((l) => String(l || '').slice(0, 200)) : null,
    updatedAt: serverTimestamp(),
  };
  if (categoryName !== undefined) {
    payload.categoryName = cleanCategoryName(categoryName);
  }

  await updateDoc(doc(db, 'assignedTasks', firestoreAssignmentId), payload);
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
    (snap) => {
      // assignedByName atama anındaki ismi taşır. Atayanın users/{uid} profili
      // güvenlik kuralları gereği okunamadığı için bu isim olduğu gibi gösterilir.
      callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
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
  // includeMetadataChanges: önbellekten gelen ilk (muhtemelen boş) anlık görüntüden sonra
  // sunucu doğrulaması geldiğinde içerik aynı olsa bile yeniden tetiklenmesi için.
  // İkinci parametre ile çağırana verinin kaynağı bildirilir (fromCache).
  return onSnapshot(
    q,
    { includeMetadataChanges: true },
    (snap) => {
      callback(
        snap.docs.map((d) => ({ id: d.id, ...d.data() })),
        { fromCache: snap.metadata.fromCache, hasPendingWrites: snap.metadata.hasPendingWrites }
      );
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
  periodEndMs,
  assignedByUid,
  taskTitle,
  completedByName,
  isNewlyCompleted,
}) {
  if (!firestoreAssignmentId) return;
  // Atayan kişi, atananın periyot çapasını (createdAt) bilmez; bu yüzden tamamlanan
  // periyodun BİTİŞ ANI da yazılır. Atayan taraf "şu an < bitiş" ise "Tamamlandı" gösterir.
  const safePeriodEnd =
    typeof periodEndMs === 'number' && Number.isFinite(periodEndMs) && periodEndMs < 8640000000000000
      ? periodEndMs
      : null;
  try {
    await updateDoc(doc(db, 'assignedTasks', firestoreAssignmentId), {
      isCompleted: !!isCompleted,
      completedPeriodKey: periodKey ?? null,
      completedPeriodEndMs: isCompleted ? safePeriodEnd : null,
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
  } catch {
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

