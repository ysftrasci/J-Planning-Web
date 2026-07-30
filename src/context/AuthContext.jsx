// J-Planning — Kimlik Doğrulama Context'i (Web)
// Mobildeki src/context/AuthContext.js dosyasının web karşılığı.
// Uygulama genelinde "kim giriş yapmış" bilgisini tutar ve dinler.
//
// FARK (mobile -> web): Kullanıcı giriş yaptığında, mobildeki gibi sadece
// Firestore profilini değil, aynı zamanda o kullanıcıya özel sql.js
// veritabanını da başlatmamız gerekiyor (bkz. db/database.js -> initDatabase
// SADECE kullanıcı giriş yaptıktan SONRA çağrılmalı). initDatabase async
// olduğu için burada await ediliyor; ekranlar "initializing" bittiğinde
// hem Auth hem de veritabanının hazır olduğundan emin olabilir.
import { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signOut as firebaseSignOut } from 'firebase/auth';
import { auth } from '../services/firebase';
import { ensureUserProfile, getUserProfile } from '../db/userProfileRepository';
import { initDatabase } from '../db/database';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          // updateProfile (displayName ayarlama) ile onAuthStateChanged
          // tetiklenmesi arasında olası bir yarış durumuna karşı, en güncel
          // bilgiyi tazele.
          await firebaseUser.reload();
          // Kullanıcı ilk kez giriş yapıyorsa, benzersiz Kullanıcı ID'sini
          // (bkz. doküman bölüm 0.1) Firestore'da oluştur/getir.
          const profile = await ensureUserProfile(firebaseUser);
          // Bu kullanıcıya ait sql.js veritabanını (IndexedDB'den) yükle/aç.
          await initDatabase(firebaseUser.uid);
          setUser({ ...firebaseUser, profile });
        } catch (error) {
          console.error('Giriş sonrası hazırlık başarısız:', error);
          setUser(null);
        }
      } else {
        setUser(null);
      }
      setInitializing(false);
    });
    return unsubscribe;
  }, []);

  const signOut = () => firebaseSignOut(auth);

  // Profil düzenleme (isim/fotoğraf) sonrası, hem Firebase Auth hem Firestore
  // güncellendikten sonra bu çağrılarak ekrandaki bilgi tazelenir.
  const refreshProfile = async () => {
    if (!auth.currentUser) return;
    await auth.currentUser.reload();
    const profile = await getUserProfile(auth.currentUser.uid);
    setUser({ ...auth.currentUser, profile });
  };

  return (
    <AuthContext.Provider value={{ user, initializing, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth, AuthProvider içinde kullanılmalı');
  return ctx;
}
