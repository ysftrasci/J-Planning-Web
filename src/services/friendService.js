// J-Planning — Arkadaşlık Sistemi (Doküman bölüm 7)
// Firestore üzerinden gerçek zamanlı çalışır (iki kullanıcının cihazı farklı
// olduğu için tamamen offline olamaz).
//
// Koleksiyon yapısı: friendships/{id}
//   fromUid, fromName, fromCode  -> isteği gönderen
//   toUid, toName, toCode        -> isteği alan
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
import { findUserByCode, getUserProfile } from '../db/userProfileRepository';

const friendshipsRef = collection(db, 'friendships');

const searchAttempts = [];
const MAX_SEARCHES_PER_MINUTE = 5;

function checkRateLimit() {
  const now = Date.now();
  while (searchAttempts.length > 0 && now - searchAttempts[0] > 60000) {
    searchAttempts.shift();
  }
  if (searchAttempts.length >= MAX_SEARCHES_PER_MINUTE) {
    throw new Error('Çok fazla arama yaptınız. Güvenlik nedeniyle lütfen 1 dakika sonra tekrar deneyin.');
  }
  searchAttempts.push(now);
}

// Kullanıcı kodu ile arkadaş isteği gönderir.
export async function sendFriendRequest(currentUser, targetCode) {
  const code = targetCode.trim().toUpperCase();
  if (!code) throw new Error('Lütfen bir Kullanıcı ID gir.');

  checkRateLimit();

  const targetProfile = await findUserByCode(code);
  if (!targetProfile) {
    throw new Error('Bu Kullanıcı ID ile bir hesap bulunamadı.');
  }
  if (targetProfile.uid === currentUser.uid) {
    throw new Error('Kendine arkadaşlık isteği gönderemezsin.');
  }

  await addDoc(friendshipsRef, {
    fromUid: currentUser.uid,
    fromName: currentUser.profile?.displayName || currentUser.displayName || 'Kullanıcı',
    fromCode: currentUser.profile?.userCode || '',
    toUid: targetProfile.uid,
    toName: targetProfile.displayName,
    toCode: targetProfile.userCode,
    status: 'PENDING',
    createdAt: serverTimestamp(),
  });
}

export async function acceptFriendRequest(friendshipId) {
  await updateDoc(doc(db, 'friendships', friendshipId), { status: 'ACCEPTED' });
}

export async function rejectFriendRequest(friendshipId) {
  await deleteDoc(doc(db, 'friendships', friendshipId));
}

export async function removeFriend(friendshipId) {
  // "Arkadaşlığı Sonlandır" — bölüm 7.1
  await deleteDoc(doc(db, 'friendships', friendshipId));
}

// Gerçek zamanlı dinleyici: kullanıcının kabul edilmiş arkadaşları.
// callback(friendsList) şeklinde çağrılır, her değişiklikte tekrar tetiklenir.
//
// NOT: friendships dokümanındaki fromName/toName alanları, istek gönderildiği
// ANDAKİ ismi saklar (snapshot) — kullanıcı sonradan ismini/fotoğrafını
// değiştirirse bu eski bilgi Firestore'da donuk kalır. Bu yüzden isim/foto
// göstermeden önce, her arkadaşın GÜNCEL profilini (users/{uid}) ayrıca
// çekip üzerine yazıyoruz.
export function listenFriends(currentUserUid, callback) {
  const qFrom = query(
    friendshipsRef,
    where('fromUid', '==', currentUserUid),
    where('status', '==', 'ACCEPTED')
  );
  const qTo = query(
    friendshipsRef,
    where('toUid', '==', currentUserUid),
    where('status', '==', 'ACCEPTED')
  );

  let fromResults = [];
  let toResults = [];

  const emit = async () => {
    const combinedRaw = [
      ...fromResults.map((f) => ({
        id: f.id,
        friendUid: f.data.toUid,
        friendName: f.data.toName,
        friendCode: f.data.toCode,
      })),
      ...toResults.map((f) => ({
        id: f.id,
        friendUid: f.data.fromUid,
        friendName: f.data.fromName,
        friendCode: f.data.fromCode,
      })),
    ];

    // Her arkadaşın güncel profilini çek, isim/foto varsa üzerine yaz.
    const enriched = await Promise.all(
      combinedRaw.map(async (friend) => {
        try {
          const liveProfile = await getUserProfile(friend.friendUid);
          if (liveProfile) {
            return {
              ...friend,
              friendName: liveProfile.displayName || friend.friendName,
              friendPhotoURL: liveProfile.photoURL || null,
            };
          }
        } catch (e) {
          // Profil okunamazsa, elimizdeki eski (snapshot) bilgiyle devam et.
        }
        return friend;
      })
    );

    callback(enriched);
  };

  const unsubFrom = onSnapshot(qFrom, (snap) => {
    fromResults = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
    emit();
  });
  const unsubTo = onSnapshot(qTo, (snap) => {
    toResults = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
    emit();
  });

  return () => {
    unsubFrom();
    unsubTo();
  };
}

// Gerçek zamanlı dinleyici: kullanıcıya gelen bekleyen istekler.
export function listenPendingReceivedRequests(currentUserUid, callback) {
  const q = query(
    friendshipsRef,
    where('toUid', '==', currentUserUid),
    where('status', '==', 'PENDING')
  );
  return onSnapshot(q, (snap) => {
    const requests = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback(requests);
  });
}

// Gerçek zamanlı dinleyici: kullanıcının gönderdiği bekleyen istekler.
export function listenPendingSentRequests(currentUserUid, callback) {
  const q = query(
    friendshipsRef,
    where('fromUid', '==', currentUserUid),
    where('status', '==', 'PENDING')
  );
  return onSnapshot(q, (snap) => {
    const requests = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback(requests);
  });
}
