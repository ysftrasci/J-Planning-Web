// J-Planning — Kimlik Doğrulama Context'i (Web)
// Mobildeki src/context/AuthContext.js dosyasının web karşılığı.
// Uygulama genelinde "kim giriş yapmış" bilgisini tutar ve dinler.

import { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signOut as firebaseSignOut } from 'firebase/auth';
import { auth } from '../services/firebase';
import { ensureUserProfile, getUserProfile } from '../db/userProfileRepository';
import { initDatabase } from '../db/database';
import { updateTaskFromAssignment, syncReceivedTasksWithFirestore } from '../db/taskRepository';
import { listenAcceptedTasksAssignedToMe } from '../services/taskAssignmentService';
import { unregisterFCMPushToken } from '../services/notificationService';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [dbError, setDbError] = useState(null);

  useEffect(() => {
    let assignedTasksUnsub = null;

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (assignedTasksUnsub) {
        assignedTasksUnsub();
        assignedTasksUnsub = null;
      }

      if (firebaseUser) {
        try {
          setDbError(null);
          
          // Profil, Turso veritabanı ve Admin claim'i paralel başlat
          const [profile, , tokenResult] = await Promise.all([
            ensureUserProfile(firebaseUser).catch((err) => {
              console.warn('Profil alma uyarısı:', err);
              return null;
            }),
            initDatabase(firebaseUser.uid),
            firebaseUser.getIdTokenResult().catch((err) => {
              console.warn('Admin claim sorgulanamadı:', err);
              return { claims: {} };
            }),
          ]);

          setIsAdmin(Boolean(tokenResult?.claims?.admin));

          // =========================================================================
          // SOSYAL ÖZELLİK (%100 KORUNDU): Arkadaş Görev Atama Dinleyicisi
          // =========================================================================
          try {
            assignedTasksUnsub = listenAcceptedTasksAssignedToMe(firebaseUser.uid, async (tasks) => {
              if (Array.isArray(tasks)) {
                await syncReceivedTasksWithFirestore(tasks);
                for (const t of tasks) {
                  await updateTaskFromAssignment(t);
                }
                window.dispatchEvent(new Event('jplanning:cloud-sync-update'));
              }
            });
          } catch (assignedErr) {
            console.warn('Atanan görevler dinleyicisi başlatılamadı:', assignedErr);
          }

          setUser({ ...firebaseUser, profile });
        } catch (error) {
          console.error('Giriş sonrası veritabanı hazırlığı başarısız:', error);
          setDbError(error.message || 'Veritabanı bağlantısı kurulamadı.');
          setUser(firebaseUser);
          setIsAdmin(false);
        }
      } else {
        setUser(null);
        setIsAdmin(false);
        setDbError(null);
      }
      setInitializing(false);
    });

    return () => {
      if (assignedTasksUnsub) assignedTasksUnsub();
      unsubscribe();
    };
  }, []);

  const refreshProfile = async () => {
    if (!auth.currentUser) return;
    try {
      const profile = await getUserProfile(auth.currentUser.uid);
      setUser({ ...auth.currentUser, profile });
    } catch (e) {
      console.warn('Profil yenilenemedi:', e);
    }
  };

  const refreshAdminStatus = async () => {
    if (!auth.currentUser) {
      setIsAdmin(false);
      return false;
    }
    try {
      const tokenResult = await auth.currentUser.getIdTokenResult(true); // force refresh
      const adminClaim = Boolean(tokenResult?.claims?.admin);
      setIsAdmin(adminClaim);
      return adminClaim;
    } catch (err) {
      console.warn('Admin yetkisi yenilenemedi:', err);
      return false;
    }
  };

  const retryDatabaseConnection = async () => {
    if (!auth.currentUser) return;
    try {
      setDbError(null);
      await initDatabase(auth.currentUser.uid);
      const profile = await getUserProfile(auth.currentUser.uid);
      setUser({ ...auth.currentUser, profile });
    } catch (err) {
      setDbError(err.message || 'Yeniden bağlanma başarısız');
    }
  };

  const signOut = async () => {
    const currentUid = auth.currentUser?.uid;
    if (currentUid) {
      try {
        await unregisterFCMPushToken(currentUid);
      } catch (e) {
        console.warn('Çıkışta push token temizlenemedi:', e);
      }
    }
    setIsAdmin(false);
    await firebaseSignOut(auth);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAdmin,
        initializing,
        dbError,
        refreshProfile,
        refreshAdminStatus,
        retryDatabaseConnection,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth bir AuthProvider içinde kullanılmalıdır');
  }
  return ctx;
}
