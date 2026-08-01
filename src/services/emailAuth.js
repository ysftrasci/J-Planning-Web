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

function friendlyErrorMessage(error) {
  const code = error?.code || '';
  if (code.includes('email-already-in-use')) return 'Bu e-posta adresiyle zaten bir hesap var.';
  if (code.includes('invalid-email')) return 'Geçerli bir e-posta adresi gir.';
  if (code.includes('weak-password')) return 'Şifre en az 6 karakter olmalı.';
  if (code.includes('user-not-found') || code.includes('invalid-credential')) return 'E-posta veya şifre hatalı.';
  if (code.includes('wrong-password')) return 'E-posta veya şifre hatalı.';
  if (code.includes('network-request-failed')) return 'İnternet bağlantını kontrol et.';
  if (code.includes('too-many-requests')) return 'Çok fazla deneme yapıldı, lütfen birkaç dakika sonra tekrar dene.';
  return 'Bir sorun oluştu, tekrar dene.';
}

export async function registerWithEmail(name, email, password) {
  try {
    const result = await createUserWithEmailAndPassword(auth, email.trim(), password);
    if (name?.trim()) {
      await updateProfile(result.user, { displayName: name.trim() });
    }
    // Güvenlik: hesap oluşur oluşmaz doğrulama e-postası gönderilir.
    // Kullanıcı bu e-postayı doğrulamadan uygulamayı kullanamaz
    // (bkz. router/AppRouter.jsx -> RequireAuth kontrolü).
    try {
      await sendEmailVerification(result.user);
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
//
// ÖNEMLİ: Buraya AuthContext'ten gelen "user" nesnesi DEĞİL, mutlaka
// auth.currentUser (gerçek Firebase User sınıfı örneği) verilmelidir.
// AuthContext'teki user, { ...firebaseUser, profile } şeklinde spread
// edilmiş sıradan bir objedir — sendEmailVerification gibi Firebase
// fonksiyonları gerçek User instance'ı beklediği için spread edilmiş
// objeyle çağrıldığında sessizce (hata fırlatmadan) işe yaramaz.
export async function resendVerificationEmail() {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Giriş yapılmış bir hesap bulunamadı, lütfen tekrar giriş yap.');
  }
  try {
    await sendEmailVerification(currentUser);
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
