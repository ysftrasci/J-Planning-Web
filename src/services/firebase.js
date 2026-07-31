// J-Planning — Firebase Yapılandırması (Web)
//
// Mobil src/services/firebase.js dosyasının web karşılığıdır. Aynı
// Firebase proje/anahtarları kullanılır (bkz. Vite_.env dosyası).
//
// NOT: Mobildeki initializeAuth + AsyncStorage kalıcılığı yerine burada
// web'in kendi browserLocalPersistence'ı kullanılıyor. Davranış aynı:
// kullanıcı sekmeyi/tarayıcıyı kapatıp tekrar açtığında oturum açık kalır.
//
// NOT: Firebase Storage KULLANILMIYOR çünkü Şubat 2026'dan itibaren ücretsiz
// (Spark) planda kullanılamıyor hale geldi (Blaze/kredi kartı zorunlu).
// Profil fotoğrafları mobildeki gibi küçültülüp Firestore'da base64 olarak
// saklanacak (bkz. ileride eklenecek services/photoUploadService.js).

import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyBtVOLogan59jxLkr5U9QNS2gCLCxMBKoM',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'j-planning.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'j-planning',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'j-planning.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '928119312572',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:928119312572:web:c44c226954d1d4e95c00b9',
};

// Vite'ın Fast Refresh'i sırasında initializeApp'in tekrar çağrılmasını önle
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

const auth = getAuth(app);

// Oturumun tarayıcı kapansa bile kalıcı olması için: mobildeki
// AsyncStorage kalıcılığının web karşılığı.
setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.error('Firebase Auth kalıcılığı ayarlanamadı:', error);
});

const db = getFirestore(app);

export { app, auth, db };
