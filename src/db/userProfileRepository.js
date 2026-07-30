// J-Planning — Kullanıcı Profili (Firestore)
// Doküman bölüm 0.1: Her hesaba otomatik, benzersiz, kısa bir Kullanıcı ID'si
// atanır (örn. JP-4821). Bu ID arkadaş eklemede kullanılır.

import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../services/firebase';

function generateUserCode() {
  const num = Math.floor(1000 + Math.random() * 9000); // 4 haneli
  return `JP-${num}`;
}

// Aynı kodun başka bir kullanıcıda olma ihtimaline karşı birkaç deneme yapar.
async function generateUniqueUserCode() {
  for (let i = 0; i < 10; i++) {
    const code = generateUserCode();
    const codeDoc = await getDoc(doc(db, 'userCodes', code));
    if (!codeDoc.exists()) {
      return code;
    }
  }
  // 10 denemede de çakışma çıkarsa (çok düşük ihtimal), 6 haneliye geç
  const code = `JP-${Math.floor(100000 + Math.random() * 900000)}`;
  return code;
}

// Kullanıcı ilk giriş yaptığında profil oluşturur, sonraki girişlerde mevcut
// profili döndürür.
export async function ensureUserProfile(firebaseUser) {
  const userRef = doc(db, 'users', firebaseUser.uid);
  const existing = await getDoc(userRef);

  if (existing.exists()) {
    return existing.data();
  }

  const userCode = await generateUniqueUserCode();
  const profile = {
    uid: firebaseUser.uid,
    displayName: firebaseUser.displayName || 'Kullanıcı',
    email: firebaseUser.email || null,
    photoURL: firebaseUser.photoURL || null,
    userCode,
    createdAt: serverTimestamp(),
  };

  await setDoc(userRef, profile);
  // userCode -> uid eşlemesi, arkadaş eklerken hızlı arama için ayrı koleksiyonda tutulur.
  await setDoc(doc(db, 'userCodes', userCode), { uid: firebaseUser.uid });

  return profile;
}

export async function getUserProfile(uid) {
  const userRef = doc(db, 'users', uid);
  const snap = await getDoc(userRef);
  return snap.exists() ? snap.data() : null;
}

// Kullanıcı koduna göre uid bulur (arkadaş ekleme akışında kullanılacak).
export async function findUserByCode(userCode) {
  const codeDoc = await getDoc(doc(db, 'userCodes', userCode.toUpperCase()));
  if (!codeDoc.exists()) return null;
  const { uid } = codeDoc.data();
  return getUserProfile(uid);
}

// Profil düzenleme (isim ve/veya fotoğraf) — Firestore'daki profil dokümanını günceller.
// Firebase Auth tarafındaki displayName/photoURL güncellemesi ayrıca yapılmalı
// (bkz. services/emailAuth.js: updateDisplayName, updatePhotoURL).
export async function updateUserProfile(uid, updates) {
  const userRef = doc(db, 'users', uid);
  await updateDoc(userRef, updates);
}
