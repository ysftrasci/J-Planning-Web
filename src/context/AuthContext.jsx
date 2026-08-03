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
import { updateTaskFromAssignment, syncReceivedTasksWithFirestore } from '../db/taskRepository';
import { listenAcceptedTasksAssignedToMe } from '../services/taskAssignmentService';
import { downloadAndApplyCloudSync, listenCloudSync, uploadCloudSync, performInitialCloudSync } from '../services/cloudSyncService';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    let cloudUnsub = null;
    let assignedTasksUnsub = null;

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (cloudUnsub) {
        cloudUnsub();
        cloudUnsub = null;
      }
      if (assignedTasksUnsub) {
        assignedTasksUnsub();
        assignedTasksUnsub = null;
      }

      if (firebaseUser) {
        try {
          try {
            await firebaseUser.reload();
          } catch (reloadErr) {
            // Ağ yavaşlığında reload hatasını yut, devam et
          }
          const profile = await ensureUserProfile(firebaseUser);
          await initDatabase(firebaseUser.uid);

          // Akıllı ilk senkronizasyon kontrolü (mevcut hesap verileri vs. bulut yedek uzlaştırma)
          await performInitialCloudSync(firebaseUser.uid);

          // Diğer cihazlardan gelen anlık değişiklikleri dinle
          cloudUnsub = listenCloudSync(firebaseUser.uid, () => {
            window.dispatchEvent(new Event('jplanning:cloud-sync-update'));
          });

          // Arkadaşının düzenlediği/sildiği atanmış görevlerin güncellemelerini anlık dinle
          assignedTasksUnsub = listenAcceptedTasksAssignedToMe(firebaseUser.uid, (tasks) => {
            if (Array.isArray(tasks)) {
              syncReceivedTasksWithFirestore(tasks);
              for (const t of tasks) {
                updateTaskFromAssignment(t);
              }
              window.dispatchEvent(new Event('jplanning:cloud-sync-update'));
            }
          });

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

    return () => {
      if (cloudUnsub) cloudUnsub();
      if (assignedTasksUnsub) assignedTasksUnsub();
      unsubscribe();
    };
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
