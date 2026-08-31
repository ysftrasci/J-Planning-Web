// J-Planning — Hesap Silme Servisi (Web)
//
// "Hesabımı Sil" akışının tamamını yönetir. Sıralama önemlidir:
// 1) Önce Firestore'daki TÜM veriler silinir (bkz. deleteAllFirestoreData).
//    Bunu Authentication hesabından ÖNCE yapıyoruz çünkü Firestore Security
//    Rules'daki "allow read/write: if request.auth != null && ..." kuralları
//    hâlâ giriş yapmış (auth.uid mevcut) bir kullanıcı gerektiriyor — hesap
//    önce silinirse bu sorguları yapacak yetkimiz kalmaz.
// 2) Sonra yerel tarayıcı verisi (SQLite/IndexedDB) silinir.
// 3) En son Firebase Authentication hesabının kendisi silinir.
//
// GÜVENLİK NOTU: Firebase, güvenlik gereği "yakın zamanda giriş yapılmamış"
// bir hesabın silinmesine izin vermez (auth/requires-recent-login hatası).
// Bu durumda kullanıcıdan şifresini tekrar girmesini isteyip
// reauthenticateWithCredential ile kısa bir yeniden-doğrulama yapıyoruz.

import {
  collection,
  query,
  where,
  getDocs,
  doc,
  deleteDoc,
} from 'firebase/firestore';
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  deleteUser,
} from 'firebase/auth';
import { db, auth } from './firebase';
import { deleteUserDatabase } from '../db/database';
import { markUserProfileAsDeleting } from '../db/userProfileRepository';
import { getDoc } from 'firebase/firestore';

async function collectDocsByFields(collectionName, fieldNames, uid) {
  const results = [];
  const colRef = collection(db, collectionName);
  for (const field of fieldNames) {
    const q = query(colRef, where(field, '==', uid));
    const snap = await getDocs(q);
    snap.forEach((d) => results.push(d.ref));
  }
  return results;
}

export async function deleteAllFirestoreData(uid) {
  const refsToDelete = [];

  // users/{uid}/user_backup/latest (users/{uid} ana dokümanı en son adıma bırakıldı)
  refsToDelete.push(doc(db, 'users', uid, 'user_backup', 'latest'));

  // userCodes/{userCode} — Hesap silindiğinde kullanıcı kodunu havuza geri sal
  // (böylece silinen hesapların kodları yeni kullanıcılara verilebilir)
  try {
    const userSnap = await getDoc(doc(db, 'users', uid));
    const userCode = userSnap.data()?.userCode;
    if (userCode) {
      refsToDelete.push(doc(db, 'userCodes', userCode));
    }
  } catch (e) {
    console.warn('User code fetch note:', e);
  }

  // friendships, assignedTasks, assignedRewards
  try {
    const friendshipDocs = await collectDocsByFields('friendships', ['fromUid', 'toUid'], uid);
    refsToDelete.push(...friendshipDocs);
  } catch (e) {
    console.warn('Friendship docs fetch note:', e);
  }

  try {
    const taskDocs = await collectDocsByFields('assignedTasks', ['assignedByUid', 'assignedToUid'], uid);
    refsToDelete.push(...taskDocs);
  } catch (e) {
    console.warn('Task docs fetch note:', e);
  }

  try {
    const rewardDocs = await collectDocsByFields('assignedRewards', ['assignedByUid', 'assignedToUid'], uid);
    refsToDelete.push(...rewardDocs);
  } catch (e) {
    console.warn('Reward docs fetch note:', e);
  }

  for (const ref of refsToDelete) {
    try {
      await deleteDoc(ref);
    } catch (e) {
      console.warn(`Doc deletion warning (${ref.path}):`, e);
    }
  }
}

export async function deleteUserProfileDoc(uid) {
  try {
    await deleteDoc(doc(db, 'users', uid));
  } catch (e) {
    console.warn('users/{uid} dokümanı silme uyarısı:', e);
  }
}

export async function reauthenticate(password) {
  const user = auth.currentUser;
  if (!user || !user.email) throw new Error('Giriş yapılmış bir hesap bulunamadı.');
  const credential = EmailAuthProvider.credential(user.email, password);
  await reauthenticateWithCredential(user, credential);
}

const WORKER_URL = (import.meta.env.VITE_WORKER_URL || 'https://jplanning-auth-worker.ysftrasci.workers.dev').replace(/\/+$/, '');

export async function deleteAccountCompletely({ uid, password }) {
  const user = auth.currentUser;
  if (!user || user.uid !== uid) {
    throw new Error('Hesap doğrulanamadı, lütfen tekrar giriş yapıp deneyin.');
  }

  // 0) Idempotency Kontrolü: Profil önceden silinme sürecinde kalmış mı?
  let isAlreadyDeleting = false;
  try {
    const userSnap = await getDoc(doc(db, 'users', uid));
    if (userSnap.exists() && userSnap.data()?.isDeleting === true) {
      isAlreadyDeleting = true;
    }
  } catch (err) {
    console.warn('Profil durumu okuma uyarısı:', err);
    throw new Error('Ağ bağlantısı sağlanamadı. Lütfen internet bağlantınızı kontrol edip tekrar deneyin.');
  }

  // 1) Reauthenticate (Şifre doğrulaması en başta yapılır)
  if (password) {
    await reauthenticate(password);
  }

  // 1.5) Turso DB ve Control Plane kaydını silmek için Worker'a istek at
  // KRİTİK KURAL: Worker silme işlemi başarısız olursa Firebase Auth kullanıcısı SİLİNMEZ, işlem durdurulur!
  try {
    const idToken = await user.getIdToken(true);
    const response = await fetch(`${WORKER_URL}/account`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
    });

    if (!response.ok) {
      let errMessage = `Veritabanı silinemedi (${response.status})`;
      try {
        const errData = await response.json();
        if (errData.message) errMessage = errData.message;
      } catch (_) {}
      throw new Error(`Hesabınız şu anda silinemedi (${errMessage}). Lütfen tekrar deneyin.`);
    }
  } catch (workerErr) {
    console.error('[DeleteAccount] Worker veritabanı silme hatası:', workerErr);
    throw new Error(workerErr.message || 'Hesabınız şu anda silinemedi. Lütfen internet bağlantınızı kontrol edip tekrar deneyin.');
  }

  if (!isAlreadyDeleting) {
    // 2) users/{uid} üzerine isDeleting: true bayrağını koy (HATA VERİRSE İŞLEMİ DURDUR)
    try {
      await markUserProfileAsDeleting(uid);
    } catch (err) {
      console.error('Hesap silinme bayrağı atılamadı:', err);
      throw new Error('Hesap silme işlemi başlatılamadı (Ağ/Firestore hatası). Lütfen tekrar deneyin.');
    }

    // 3) Firestore alt verilerini temizle
    await deleteAllFirestoreData(uid);

    // 4) Yerel tarayıcı verisini temizle
    try {
      await deleteUserDatabase(uid);
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(`jplanning:${uid}:notification_schedules`);
        localStorage.removeItem(`jplanning:${uid}:device_instance_id`);
        localStorage.removeItem(`jplanning:${uid}:last_local_change_ts`);
        localStorage.removeItem(`jplanning:${uid}:friend_search_attempts`);
        localStorage.removeItem(`jplanning:${uid}:friend_search_daily`);
        localStorage.removeItem(`jplanning:${uid}:friend_search_blocked_until`);
      }
    } catch (e) {
      console.warn('Yerel veritabanı silinemedi:', e);
    }
  }

  // 5) Firebase Authentication hesabının kendisini sil
  await deleteUser(user);

  // 6) Başarılı olursa users/{uid} profil dokümanını sil
  await deleteUserProfileDoc(uid);
}

export async function abandonAccountDeletionAndReset(uid) {
  if (!uid) return;
  // Doküman silme hatası yutulmaz, kurtarma akışının gerçek başarısını doğrular
  await deleteDoc(doc(db, 'users', uid));
}
