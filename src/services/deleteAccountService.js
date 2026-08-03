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
  writeBatch,
} from 'firebase/firestore';
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  deleteUser,
} from 'firebase/auth';
import { db, auth } from './firebase';
import { deleteUserDatabase } from '../db/database';

// Kullanıcının uid'sinin "atayan" ya da "atanan"/"gönderen" ya da "alıcı"
// tarafında göründüğü tüm dokümanları toplar (friendships, assignedTasks,
// assignedRewards için uid alan isimleri farklı olduğundan parametrik).
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

// Firestore'daki bu kullanıcıya ait HER ŞEYİ siler:
// - users/{uid} profil dokümanı
// - friendships (fromUid veya toUid bu kullanıcıysa)
// - assignedTasks (assignedByUid veya assignedToUid bu kullanıcıysa)
// - assignedRewards (assignedByUid veya assignedToUid bu kullanıcıysa)
//
// NOT: userCodes/{code} dokümanı BİLİNÇLİ OLARAK silinmiyor. Firestore
// Security Rules bu koleksiyon için "allow update, delete: if false;"
// diyor — yani kimse (kodun asıl sahibi bile) bu dokümanı silemez. Bu,
// başka bir kullanıcının kodunu kötü niyetle silmesini engellemek için
// bilinçli konmuş bir kural. Hesap silindikten sonra o kod (ör. JP-3947)
// artık kimse tarafından kullanılamaz halde "rezerve" kalır — 4 haneli kod
// havuzu (9000 kombinasyon) için pratikte önemsiz bir maliyettir.
export async function deleteAllFirestoreData(uid) {
  const refsToDelete = [];

  // users/{uid}/user_backup/latest
  refsToDelete.push(doc(db, 'users', uid, 'user_backup', 'latest'));
  // users/{uid}
  refsToDelete.push(doc(db, 'users', uid));

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

  // Her dokümanı güvenle tek tek sil — biri olmasa bile diğerlerinin silinmesini ve hesap silmeyi engellemesin
  for (const ref of refsToDelete) {
    try {
      await deleteDoc(ref);
    } catch (e) {
      console.warn(`Doc deletion warning (${ref.path}):`, e);
    }
  }
}

// Firebase, hesap silme gibi hassas işlemler için kullanıcının yakın
// zamanda giriş yapmış olmasını şart koşar. Uzun süredir açık bir
// oturumda bu şart sağlanmayabilir; bu durumda şifreyi tekrar isteyip
// yeniden doğrulama yapıyoruz.
export async function reauthenticate(password) {
  const user = auth.currentUser;
  if (!user || !user.email) throw new Error('Giriş yapılmış bir hesap bulunamadı.');
  const credential = EmailAuthProvider.credential(user.email, password);
  await reauthenticateWithCredential(user, credential);
}

// Tüm silme adımlarını sırayla uygular. `password` verilmezse yeniden
// doğrulama denenmez (gerekirse çağıran taraf auth/requires-recent-login
// hatasını yakalayıp şifre isteyip tekrar çağırmalıdır).
export async function deleteAccountCompletely({ uid, password }) {
  const user = auth.currentUser;
  if (!user || user.uid !== uid) {
    throw new Error('Hesap doğrulanamadı, lütfen tekrar giriş yapıp deneyin.');
  }

  if (password) {
    await reauthenticate(password);
  }

  // 1) Firestore verileri (Auth hesabı silinmeden ÖNCE — bkz. dosya başındaki not)
  await deleteAllFirestoreData(uid);

  // 2) Yerel tarayıcı verisi (görevler, kategoriler, ödüller, odaklanma geçmişi)
  try {
    await deleteUserDatabase(uid);
  } catch (e) {
    // Yerel veri silinemese bile hesap silme işlemini durdurmuyoruz;
    // en kötü ihtimalle tarayıcıda kullanılmayan bir yerel kayıt kalır.
    console.warn('Yerel veritabanı silinemedi:', e);
  }

  // 3) Firebase Authentication hesabının kendisi (en son adım)
  await deleteUser(user);
}
