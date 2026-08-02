// J-Planning — Kullanıcı Profili (Firestore)
// Doküman bölüm 0.1: Her hesaba otomatik, benzersiz, kısa bir Kullanıcı ID'si
// atanır (örn. JP-4821). Bu ID arkadaş eklemede kullanılır.

import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../services/firebase';

function generateUserCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `JP-${result}`;
}

// Aynı kodun başka bir kullanıcıda olma ihtimaline karşı birkaç deneme yapar.
async function generateUniqueUserCode() {
  for (let i = 0; i < 15; i++) {
    const code = generateUserCode();
    const codeDoc = await getDoc(doc(db, 'userCodes', code));
    if (!codeDoc.exists()) {
      return code;
    }
  }
  // Yüksek çakışma ihtimaline karşı yedek 8 haneli üret
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let fallback = '';
  for (let i = 0; i < 8; i++) {
    fallback += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `JP-${fallback}`;
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

// Kullanıcı koduna göre kamuya açık profili bulur (arkadaş ekleme akışında kullanılır).
// Güvenlik (Data Minimization): Sadece kamuya açık 4 alanı döndürür.
export async function findUserByCode(userCode) {
  const cleanCode = (userCode || '').trim().toUpperCase();
  if (!cleanCode) return null;
  const codeDoc = await getDoc(doc(db, 'userCodes', cleanCode));
  if (!codeDoc.exists()) return null;
  const { uid } = codeDoc.data();
  const fullProfile = await getUserProfile(uid);
  if (!fullProfile) return null;
  return {
    uid: fullProfile.uid,
    displayName: fullProfile.displayName || 'Kullanıcı',
    photoURL: fullProfile.photoURL || null,
    userCode: fullProfile.userCode,
  };
}

// Profil düzenleme (isim ve/veya fotoğraf) — Firestore'daki profil dokümanını günceller.
// Firebase Auth tarafındaki displayName/photoURL güncellemesi ayrıca yapılmalı
// (bkz. services/emailAuth.js: updateDisplayName, updatePhotoURL).
export async function updateUserProfile(uid, updates) {
  const userRef = doc(db, 'users', uid);
  await updateDoc(userRef, updates);
}
