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
// NOT: Hesap silindiğinde userCodes/{code} dokümanı da silinir (deleteAccountService.js),
// böylece silinen hesapların kodları havuza geri döner ve tekrar kullanılabilir.
// 6 haneli kod havuzu (31^6 ≈ 887M kombinasyon) pratikte tükenmez, ama yine de
// çakışma durumunda 10 haneli yedek kod üretilir.
async function generateUniqueUserCode() {
  for (let i = 0; i < 30; i++) {
    const code = generateUserCode();
    const codeDoc = await getDoc(doc(db, 'userCodes', code));
    if (!codeDoc.exists()) {
      return code;
    }
  }
  // Yüksek çakışma ihtimaline karşı yedek 10 haneli üret
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let fallback = '';
  for (let i = 0; i < 10; i++) {
    fallback += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `JP-${fallback}`;
}

// Kullanıcı ilk giriş yaptığında profil oluşturur, sonraki girişlerde mevcut
// profili döndürür ve gerekiyorsa (ör. 'Kullanıcı' kalmışsa) self-healing ile onarır.
export async function ensureUserProfile(firebaseUser, fallbackName = null) {
  const userRef = doc(db, 'users', firebaseUser.uid);
  const existing = await getDoc(userRef);

  const rawAuthName = typeof firebaseUser.displayName === 'string' ? firebaseUser.displayName.trim() : '';
  const rawFallbackName = typeof fallbackName === 'string' ? fallbackName.trim() : '';
  const bestDisplayName =
    (rawAuthName && rawAuthName !== 'Kullanıcı')
      ? rawAuthName
      : (rawFallbackName && rawFallbackName !== 'Kullanıcı')
      ? rawFallbackName
      : rawAuthName || rawFallbackName || null;

  if (existing.exists()) {
    const data = existing.data();
    // SELF-HEALING: Firestore'da isim 'Kullanıcı' kalmışsa veya boşsa,
    // ve Firebase Auth'tan veya fallback'ten gerçek bir isim gelmişse otomatik onar!
    const needsHealing =
      bestDisplayName &&
      (!data.displayName || data.displayName === 'Kullanıcı' || (bestDisplayName !== 'Kullanıcı' && data.displayName !== bestDisplayName));

    if (needsHealing) {
      data.displayName = bestDisplayName;
      data.updatedAt = Date.now();
      await updateDoc(userRef, { displayName: bestDisplayName, updatedAt: data.updatedAt }).catch((err) => {
        console.warn('Profil onarım uyarısı:', err);
      });
    }

    if (data.userCode) {
      await setDoc(
        doc(db, 'userCodes', data.userCode),
        {
          uid: firebaseUser.uid,
          displayName: data.displayName || bestDisplayName || 'Kullanıcı',
          photoURL: data.photoURL || firebaseUser.photoURL || null,
          userCode: data.userCode,
        },
        { merge: true }
      ).catch(() => {});
    }
    return data;
  }

  const userCode = await generateUniqueUserCode();
  const profile = {
    uid: firebaseUser.uid,
    displayName: bestDisplayName || 'Kullanıcı',
    photoURL: firebaseUser.photoURL || null,
    userCode,
    createdAt: serverTimestamp(),
  };

  await setDoc(userRef, profile);
  // userCode -> kamuya açık sınırlı profil bilgileri (arkadaş arama için)
  await setDoc(doc(db, 'userCodes', userCode), {
    uid: firebaseUser.uid,
    displayName: profile.displayName,
    photoURL: profile.photoURL,
    userCode,
  });

  return profile;
}

export async function getUserProfile(uid) {
  const userRef = doc(db, 'users', uid);
  const snap = await getDoc(userRef);
  return snap.exists() ? snap.data() : null;
}

// Kullanıcı koduna göre kamuya açık profili bulur (arkadaş ekleme akışında kullanılır).
// Güvenlik (Data Minimization): Sadece kamuya açık 4 alanı userCodes dokümanından doğrudan döndürür.
export async function findUserByCode(userCode) {
  const cleanCode = (userCode || '').trim().toUpperCase();
  if (!cleanCode) return null;
  const codeDoc = await getDoc(doc(db, 'userCodes', cleanCode));
  if (!codeDoc.exists()) return null;
  const data = codeDoc.data();
  return {
    uid: data.uid,
    displayName: data.displayName || 'Kullanıcı',
    photoURL: data.photoURL || null,
    userCode: data.userCode || cleanCode,
  };
}

// Profil düzenleme (isim ve/veya fotoğraf) — Firestore'daki profil dokümanını günceller.
export async function updateUserProfile(uid, updates) {
  const userRef = doc(db, 'users', uid);
  await updateDoc(userRef, updates);

  try {
    const userSnap = await getDoc(userRef);
    const code = userSnap.data()?.userCode;
    if (code) {
      const publicUpdates = {};
      if (updates.displayName !== undefined) publicUpdates.displayName = updates.displayName;
      if (updates.photoURL !== undefined) publicUpdates.photoURL = updates.photoURL;
      if (Object.keys(publicUpdates).length > 0) {
        await updateDoc(doc(db, 'userCodes', code), publicUpdates).catch(() => {});
      }
    }
  } catch (e) {
    // Kamusal profil güncelleme uyarısını yut
  }
}

export async function markUserProfileAsDeleting(uid) {
  const userRef = doc(db, 'users', uid);
  await updateDoc(userRef, { isDeleting: true, isDeletingAtMs: Date.now() });
}
