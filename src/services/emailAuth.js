// J-Planning — E-posta / Şifre ile Giriş ve Kayıt (Web)
// Mobildeki src/services/emailAuth.js dosyasının birebir karşılığı.
// Firebase Authentication'ın email/password yöntemi platformdan bağımsızdır,
// bu yüzden hiçbir değişiklik yapılmadan taşınabildi.

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  sendPasswordResetEmail,
  sendEmailVerification,
} from 'firebase/auth';
import { auth } from './firebase';
import { ensureUserProfile } from '../db/userProfileRepository';

function friendlyErrorMessage(error) {
  const code = error?.code || '';
  const message = error?.message || '';
  if (code.includes('email-already-in-use')) return 'Bu e-posta adresiyle zaten bir hesap var.';
  if (code.includes('invalid-email')) return 'Geçerli bir e-posta adresi gir.';
  if (code.includes('weak-password')) return 'Şifre en az 6 karakter olmalı.';
  if (code.includes('user-not-found') || code.includes('invalid-credential')) return 'E-posta veya şifre hatalı.';
  if (code.includes('wrong-password')) return 'E-posta veya şifre hatalı.';
  if (code.includes('network-request-failed')) return 'İnternet bağlantını kontrol et.';
  if (code.includes('too-many-requests') || message.includes('TOO_MANY_ATTEMPTS_TRY_LATER')) {
    return 'Çok sık e-posta gönderildi. Güvenlik nedeniyle lütfen 1 dakika bekleyip tekrar deneyin.';
  }
  return 'Bir sorun oluştu, lütfen tekrar deneyin.';
}

export async function registerWithEmail(name, email, password) {
  const cleanName = (name || '').trim();
  try {
    const result = await createUserWithEmailAndPassword(auth, email.trim(), password);
    if (cleanName) {
      // 1. Firebase Auth displayName güncelle
      await updateProfile(result.user, { displayName: cleanName }).catch((err) => {
        console.warn('Auth profil adı güncelleme uyarısı:', err);
      });
      // 2. Firestore profilini yarışa bırakmadan DOĞRUDAN bu isimle garanti altına al
      await ensureUserProfile(result.user, cleanName).catch((err) => {
        console.warn('İlk profil oluşturma uyarısı:', err);
      });
    }
    // Güvenlik: hesap oluşur oluşmaz doğrulama e-postası gönderilir.
    // Kullanıcı bu e-postayı doğrulamadan uygulamayı kullanamaz
    // (bkz. router/AppRouter.jsx -> RequireAuth kontrolü).
    try {
      await sendEmailVerification(result.user);
      if (typeof window !== 'undefined' && window.localStorage && result.user?.uid) {
        window.localStorage.setItem(`jplanning:last_verify_email_${result.user.uid}`, String(Date.now()));
      }
    } catch (verificationError) {
      // Doğrulama e-postası gönderilemese bile kayıt işlemini iptal etmeyelim;
      // kullanıcı "doğrulama bekleniyor" ekranındaki "tekrar gönder" ile deneyebilir.
      console.warn('Doğrulama e-postası gönderilemedi:', verificationError);
    }
    return result.user;
  } catch (error) {
    throw new Error(friendlyErrorMessage(error));
  }
}

// Kullanıcı "doğrulama bekleniyor" ekranındayken doğrulama e-postasını
// tekrar göndermek istediğinde kullanılır.
export async function resendVerificationEmail() {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Giriş yapılmış bir hesap bulunamadı, lütfen tekrar giriş yap.');
  }
  try {
    // Taze token güvencesi
    await currentUser.getIdToken(true).catch(() => {});
    await sendEmailVerification(currentUser);
    if (typeof window !== 'undefined' && window.localStorage && currentUser?.uid) {
      window.localStorage.setItem(`jplanning:last_verify_email_${currentUser.uid}`, String(Date.now()));
    }
  } catch (error) {
    throw new Error(friendlyErrorMessage(error));
  }
}

export async function updateDisplayName(user, newName) {
  try {
    await updateProfile(user, { displayName: newName.trim() });
  } catch (error) {
    throw new Error(friendlyErrorMessage(error));
  }
}

export async function updatePhotoURL(user, photoURL) {
  try {
    await updateProfile(user, { photoURL });
  } catch (error) {
    throw new Error(friendlyErrorMessage(error));
  }
}

export async function loginWithEmail(email, password) {
  try {
    const result = await signInWithEmailAndPassword(auth, email.trim(), password);
    return result.user;
  } catch (error) {
    throw new Error(friendlyErrorMessage(error));
  }
}

// Firebase'in kendi hazır şifre sıfırlama akışı: kullanıcının e-postasına bir
// link gönderilir, kullanıcı o linke tıklayınca Firebase'in kendi (güvenli)
// sayfasında yeni şifresini belirler. Sunucu veya mail altyapısı kurmamıza
// gerek yok, Firebase bunu kendi başına halleder.
export async function sendResetPasswordEmail(email) {
  try {
    await sendPasswordResetEmail(auth, email.trim());
  } catch (error) {
    throw new Error(friendlyErrorMessage(error));
  }
}

