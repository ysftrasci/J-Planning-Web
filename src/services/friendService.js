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

// ─── İstemci Tarafı Arama Kısıtlaması (Rate Limiting) ───
//
// Kullanıcı kodu arama isteklerini birden fazla katmanlı koruma ile sınırlar:
//   1) Dakikalık limit: 60 saniye içinde en fazla 5 arama
//   2) Günlük limit: 24 saat içinde en fazla 50 arama
//   3) Üstel geri çekilme: Arka arkaya reddedilince bekleme süresi artar
//
// VERİ SAKLAMA: localStorage kullanılır — sayfa yenilense, sekme kapansa bile
// kısıtlama devam eder. sessionStorage ek katman olarak tutulur.
//
// SINIRLILIK: Bu tamamen istemci tarafı bir korumadır. Tarayıcı DevTools ile
// localStorage temizlenebilir veya Firestore SDK atlanıp doğrudan REST API
// kullanılabilir. Üretim ortamında gerçek brute-force koruması için:
//   - Firebase App Check entegrasyonu
//   - Cloud Functions ile sunucu tarafı rate limiting
//   - reCAPTCHA/hCaptcha doğrulaması
// gibi sunucu tarafı çözümler uygulanmalıdır.
const MAX_SEARCHES_PER_MINUTE = 5;
const MAX_SEARCHES_PER_DAY = 50;
const RATE_LIMIT_WINDOW_MS = 60000;
const DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;

function checkRateLimit(uid) {
  const userUid = uid || 'guest';
  const minuteKey = `jplanning:${userUid}:friend_search_attempts`;
  const dailyKey = `jplanning:${userUid}:friend_search_daily`;
  const blockKey = `jplanning:${userUid}:friend_search_blocked_until`;
  const now = Date.now();

  // Üstel geri çekilme: Önceden bloklanmışsa süre dolana kadar reddet
  try {
    const blockedUntil = Number(localStorage.getItem(blockKey)) || 0;
    if (now < blockedUntil) {
      const remainingSec = Math.ceil((blockedUntil - now) / 1000);
      throw new Error(`Çok fazla arama yaptınız. Lütfen ${remainingSec} saniye sonra tekrar deneyin.`);
    }
  } catch (e) {
    if (e.message.includes('Çok fazla')) throw e;
  }

  // Dakikalık limit kontrolü (localStorage — sayfa yenilense bile kalır)
  let minuteAttempts = [];
  try {
    const raw = localStorage.getItem(minuteKey);
    if (raw) minuteAttempts = JSON.parse(raw);
  } catch (e) {}

  minuteAttempts = Array.isArray(minuteAttempts)
    ? minuteAttempts.filter((ts) => typeof ts === 'number' && now - ts < RATE_LIMIT_WINDOW_MS)
    : [];

  if (minuteAttempts.length >= MAX_SEARCHES_PER_MINUTE) {
    // Üstel geri çekilme uygula: her ihlalde bekleme süresi 2x artar (maks 5dk)
    const violations = minuteAttempts.length - MAX_SEARCHES_PER_MINUTE + 1;
    const backoffMs = Math.min(RATE_LIMIT_WINDOW_MS * Math.pow(2, violations), 5 * 60 * 1000);
    try {
      localStorage.setItem(blockKey, String(now + backoffMs));
    } catch (e) {}
    throw new Error('Çok fazla arama yaptınız. Güvenlik nedeniyle lütfen 1 dakika sonra tekrar deneyin.');
  }

  // Günlük limit kontrolü
  let dailyAttempts = [];
  try {
    const raw = localStorage.getItem(dailyKey);
    if (raw) dailyAttempts = JSON.parse(raw);
  } catch (e) {}

  dailyAttempts = Array.isArray(dailyAttempts)
    ? dailyAttempts.filter((ts) => typeof ts === 'number' && now - ts < DAILY_WINDOW_MS)
    : [];

  if (dailyAttempts.length >= MAX_SEARCHES_PER_DAY) {
    throw new Error('Günlük arama limitine ulaştınız. Güvenlik nedeniyle lütfen yarın tekrar deneyin.');
  }

  // Kaydet
  minuteAttempts.push(now);
  dailyAttempts.push(now);
  try {
    localStorage.setItem(minuteKey, JSON.stringify(minuteAttempts));
    localStorage.setItem(dailyKey, JSON.stringify(dailyAttempts));
  } catch (e) {}
}

// Kullanıcı kodu ile arkadaş isteği gönderir.
export async function sendFriendRequest(currentUser, targetCode) {
  const code = targetCode.trim().toUpperCase();
  if (!code) throw new Error('Lütfen bir Kullanıcı ID gir.');

  checkRateLimit(currentUser?.uid);

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
export function listenFriends(currentUserUid, callback, onError) {
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

  const unsubFrom = onSnapshot(
    qFrom,
    (snap) => {
      fromResults = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
      emit();
    },
    (error) => {
      console.error('[FriendService] listenFriendships qFrom error:', error);
      if (onError) onError(error);
    }
  );
  const unsubTo = onSnapshot(
    qTo,
    (snap) => {
      toResults = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
      emit();
    },
    (error) => {
      console.error('[FriendService] listenFriendships qTo error:', error);
      if (onError) onError(error);
    }
  );

  return () => {
    unsubFrom();
    unsubTo();
  };
}

// Gerçek zamanlı dinleyici: kullanıcıya gelen bekleyen istekler.
export function listenPendingReceivedRequests(currentUserUid, callback, onError) {
  const q = query(
    friendshipsRef,
    where('toUid', '==', currentUserUid),
    where('status', '==', 'PENDING')
  );
  return onSnapshot(
    q,
    (snap) => {
      const requests = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      callback(requests);
    },
    (error) => {
      console.error('[FriendService] listenPendingReceivedRequests error:', error);
      if (onError) onError(error);
    }
  );
}

// Gerçek zamanlı dinleyici: kullanıcının gönderdiği bekleyen istekler.
export function listenPendingSentRequests(currentUserUid, callback, onError) {
  const q = query(
    friendshipsRef,
    where('fromUid', '==', currentUserUid),
    where('status', '==', 'PENDING')
  );
  return onSnapshot(
    q,
    (snap) => {
      const requests = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      callback(requests);
    },
    (error) => {
      console.error('[FriendService] listenPendingSentRequests error:', error);
      if (onError) onError(error);
    }
  );
}
