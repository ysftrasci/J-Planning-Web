import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { onAuthStateChanged, signOut as firebaseSignOut } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../services/firebase';
import { ensureUserProfile, getUserProfile } from '../db/userProfileRepository';
import { initDatabase, resetDatabaseSession } from '../db/database';
import { updateTaskFromAssignment, syncReceivedTasksWithFirestore } from '../db/taskRepository';
import { listenAcceptedTasksAssignedToMe } from '../services/taskAssignmentService';
import { unregisterFCMPushToken } from '../services/notificationService';

const AuthContext = createContext(null);
const WORKER_URL = (import.meta.env.VITE_WORKER_URL || 'https://jplanning-auth-worker.ysftrasci.workers.dev').replace(/\/+$/, '');

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [dbError, setDbError] = useState(null);

  const signOut = useCallback(async () => {
    const currentUid = auth.currentUser?.uid;
    if (currentUid) {
      try {
        await unregisterFCMPushToken(currentUid);
      } catch (e) {
        console.warn('Çıkışta push token temizlenemedi:', e);
      }
    }
    resetDatabaseSession();
    setIsAdmin(false);
    setUser(null);
    setDbError(null);
    await firebaseSignOut(auth);
  }, []);

  useEffect(() => {
    let assignedTasksUnsub = null;
    let userStatusUnsub = null;

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (assignedTasksUnsub) {
        assignedTasksUnsub();
        assignedTasksUnsub = null;
      }
      if (userStatusUnsub) {
        userStatusUnsub();
        userStatusUnsub = null;
      }

      if (firebaseUser) {
        try {
          setDbError(null);

          // 1. Profil, Turso veritabanı ve Admin claim'i paralel başlat
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

          // 2. GERÇEK ZAMANLI ASKIYA ALMA DİNLEYİCİSİ (Firestore users/{uid})
          try {
            userStatusUnsub = onSnapshot(
              doc(db, 'users', firebaseUser.uid),
              (snap) => {
                const data = snap.data();
                if (data?.isDisabled === true || data?.status === 'DISABLED') {
                  console.warn('[AuthContext] Kullanıcı hesabı askıya alındı, oturum kapatılıyor...');
                  alert('Hesabınız yönetici tarafından askıya alınmıştır. Lütfen destek ekibi ile iletişime geçin.');
                  signOut();
                }
              },
              (statusErr) => {
                console.warn('[AuthContext] users/{uid} durum dinleme hatası:', statusErr);
              }
            );
          } catch (statusListenErr) {
            console.warn('Kullanıcı durum dinleyicisi başlatılamadı:', statusListenErr);
          }

          // 3. SOSYAL ÖZELLİK: Arkadaş Görev Atama Dinleyicisi
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

          // Prototype zincirini koruyarak profile alanını bağla
          try {
            firebaseUser.profile = profile;
          } catch (_) {}
          setUser(firebaseUser);
        } catch (error) {
          console.error('Giriş sonrası veritabanı hazırlığı başarısız:', error);
          if (error.message?.includes('askıya') || error.message?.includes('ACCOUNT_DISABLED')) {
            alert('Hesabınız yönetici tarafından askıya alınmıştır. Lütfen destek ekibi ile iletişime geçin.');
            signOut();
            return;
          }
          setDbError(error.message || 'Veritabanı bağlantısı kurulamadı.');
          setUser(firebaseUser);
          setIsAdmin(false);
        }
      } else {
        resetDatabaseSession();
        setUser(null);
        setIsAdmin(false);
        setDbError(null);
      }
      setInitializing(false);
    });

    // 4. Force-Logout Olay Dinleyicisi (database.js 403 yakaladığında)
    const handleForceLogout = (e) => {
      const msg = e.detail?.message || 'Hesabınız yönetici tarafından askıya alınmıştır.';
      alert(msg);
      signOut();
    };
    window.addEventListener('jplanning:force-logout', handleForceLogout);

    // 5. Pencere Odağı (Window Focus) Denetimi
    const handleWindowFocus = async () => {
      if (!auth.currentUser) return;
      try {
        const idToken = await auth.currentUser.getIdToken(false);
        const res = await fetch(`${WORKER_URL}/session`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
        });
        if (res.status === 403) {
          const errData = await res.json().catch(() => ({}));
          if (errData.error === 'ACCOUNT_DISABLED') {
            alert('Hesabınız yönetici tarafından askıya alınmıştır. Lütfen destek ekibi ile iletişime geçin.');
            signOut();
          }
        }
      } catch (_) {}
    };
    window.addEventListener('focus', handleWindowFocus);

    return () => {
      if (assignedTasksUnsub) assignedTasksUnsub();
      if (userStatusUnsub) userStatusUnsub();
      window.removeEventListener('jplanning:force-logout', handleForceLogout);
      window.removeEventListener('focus', handleWindowFocus);
      unsubscribe();
    };
  }, [signOut]);

  const refreshProfile = async () => {
    if (!auth.currentUser) return;
    try {
      const profile = await getUserProfile(auth.currentUser.uid);
      try {
        auth.currentUser.profile = profile;
      } catch (_) {}
      setUser(auth.currentUser);
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
      try {
        auth.currentUser.profile = profile;
      } catch (_) {}
      setUser(auth.currentUser);
    } catch (err) {
      setDbError(err.message || 'Yeniden bağlanma başarısız');
    }
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
