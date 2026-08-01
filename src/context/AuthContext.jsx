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
          try {
            await firebaseUser.reload();
          } catch (reloadErr) {
            // Ağ yavaşlığında reload hatasını yut, devam et
          }
          const profile = await ensureUserProfile(firebaseUser);
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

  // VerifyEmailPage'de "Doğruladım, devam et" butonuna basıldığında çağrılır.
  // Firebase'den en güncel emailVerified durumunu çekip state'i günceller,
  // sonucu (doğrulanmış mı) boolean olarak döner.
  const refreshAuthUser = async () => {
    if (!auth.currentUser) return false;
    await auth.currentUser.reload();
    if (auth.currentUser.emailVerified) {
      const profile = await getUserProfile(auth.currentUser.uid);
      setUser({ ...auth.currentUser, profile });
      return true;
    }
    // Doğrulanmadıysa yine de en güncel firebaseUser referansını state'e
    // yansıtalım (emailVerified: false olarak kalır).
    setUser((prev) => (prev ? { ...prev, ...auth.currentUser } : prev));
    return false;
  };

  return (
    <AuthContext.Provider value={{ user, initializing, signOut, refreshProfile, refreshAuthUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth, AuthProvider içinde kullanılmalı');
  return ctx;
}
