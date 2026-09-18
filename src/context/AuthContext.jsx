import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { onAuthStateChanged, signOut as firebaseSignOut } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../services/firebase';
import { ensureUserProfile, getUserProfile } from '../db/userProfileRepository';
import {
  initDatabase,
  initGuestDatabase,
  resetDatabaseSession,
  isDatabaseReady,
  requestWorkerSession,
} from '../db/database';
import { updateTaskFromAssignment, syncReceivedTasksWithFirestore } from '../db/taskRepository';
import { listenAcceptedTasksAssignedToMe } from '../services/taskAssignmentService';
import { unregisterFCMPushToken } from '../services/notificationService';
import { bridgeGuestDataToNewUser } from '../db/localSqliteEngine';

const AuthContext = createContext(null);
const WORKER_URL = (import.meta.env.VITE_WORKER_URL || '/api/worker').replace(/\/+$/, '');

function createGuestUserObject() {
  return {
    uid: 'guest',
    displayName: 'Misafir Kullanıcı',
    isGuest: true,
    email: null,
    emailVerified: true,
    profile: {
      displayName: 'Misafir Kullanıcı',
      userCode: 'GUEST',
      photoURL: null,
      isGuest: true,
    },
  };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isGuest, setIsGuest] = useState(() => {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem('jplanning_guest_mode') === 'true';
  });
  const [initializing, setInitializing] = useState(true);
  const [dbError, setDbError] = useState(null);

  /**
   * Misafir oturumunu başlatır (Yerel sql.js motoru, 0 ağ isteği).
   */
  const startGuestSession = useCallback(async () => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('jplanning_guest_mode', 'true');
      }
      setIsGuest(true);
      setIsAdmin(false);
      setDbError(null);

      await initGuestDatabase();
      const guestUser = createGuestUserObject();
      setUser(guestUser);
      return guestUser;
    } catch (err) {
      console.error('[AuthContext] Misafir oturumu başlatılamadı:', err);
      setDbError('Misafir modu başlatılamadı.');
      throw err;
    }
  }, []);

  /**
   * Misafir oturumunu kapatır ve yerel oturumu temizler.
   */
  const exitGuestSession = useCallback(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('jplanning_guest_mode');
    }
    setIsGuest(false);
    resetDatabaseSession();
    setUser(null);
    setIsAdmin(false);
    setDbError(null);
  }, []);

  /**
   * Kayıtlı Firebase kullanıcısı için normal çıkış akışı.
   */
  const signOut = useCallback(async () => {
    if (isGuest) {
      exitGuestSession();
      return;
    }

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
  }, [isGuest, exitGuestSession]);

  useEffect(() => {
    let assignedTasksUnsub = null;
    let userStatusUnsub = null;

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      // Her Auth durum değişiminde (misafir -> gerçek veya gerçek -> misafir) eski dinleyicileri iptal et
      if (assignedTasksUnsub) {
        assignedTasksUnsub();
        assignedTasksUnsub = null;
      }
      if (userStatusUnsub) {
        userStatusUnsub();
        userStatusUnsub = null;
      }

      if (firebaseUser) {
        // ----------------------------------------------------
        // DURUM A: Gerçek Kayıtlı Firebase Kullanıcısı
        // ----------------------------------------------------
        const wasGuest = typeof localStorage !== 'undefined' && localStorage.getItem('jplanning_guest_mode') === 'true';
        if (wasGuest) {
          await bridgeGuestDataToNewUser(firebaseUser.uid).catch((err) => {
            console.warn('[AuthContext] Misafir verisi köprüleme uyarısı:', err);
          });
        }
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem('jplanning_guest_mode');
        }
        setIsGuest(false);
        setUser(firebaseUser); // Stale guestUser nesnesinin 1 saniye bile kalmasını engelle

        // E-posta henüz doğrulanmamışsa Turso veritabanı oturumu istenmez,
        // kullanıcı doğrudan /verify-email ekranına kilitlenir.
        if (!firebaseUser.emailVerified) {
          setIsAdmin(false);
          return;
        }

        try {
          setDbError(null);

          // 1. Profil ve Admin claim'i al
          const [profile, tokenResult] = await Promise.all([
            ensureUserProfile(firebaseUser).catch((err) => {
              console.warn('Profil alma uyarısı:', err);
              return null;
            }),
            firebaseUser.getIdTokenResult().catch((err) => {
              console.warn('Admin claim sorgulanamadı:', err);
              return { claims: {} };
            }),
          ]);

          // Token'da henüz isim yoksa ama profil veya auth nesnesinde isim varsa, taze token al
          if (!tokenResult?.claims?.name && (firebaseUser.displayName || profile?.displayName)) {
            await firebaseUser.getIdToken(true).catch(() => { });
          }

          // 2. Turso veritabanını başlat
          await initDatabase(firebaseUser.uid);

          setIsAdmin(Boolean(tokenResult?.claims?.admin));

          // 3. GERÇEK ZAMANLI ASKIYA ALMA DİNLEYİCİSİ (Firestore users/{uid})
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

          // 4. SOSYAL ÖZELLİK: Arkadaş Görev Atama Dinleyicisi (Sadece e-posta doğrulanmışsa başlatılır)
          if (firebaseUser.emailVerified) {
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
          }

          // Prototype zincirini koruyarak profile alanını bağla
          try {
            firebaseUser.profile = profile;
          } catch (_) { }
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
        // ----------------------------------------------------
        // DURUM B veya C: firebaseUser yok
        // ----------------------------------------------------
        const isGuestSaved = typeof localStorage !== 'undefined' && localStorage.getItem('jplanning_guest_mode') === 'true';

        if (isGuestSaved) {
          // DURUM B: Misafir Oturumu Aktif
          try {
            setIsGuest(true);
            setIsAdmin(false);
            setDbError(null);

            await initGuestDatabase();
            const guestUser = createGuestUserObject();
            setUser(guestUser);
          } catch (guestInitErr) {
            console.error('[AuthContext] Misafir veritabanı açılış hatası:', guestInitErr);
            setDbError('Misafir veritabanı açılamadı.');
            setUser(null);
          }
        } else {
          // DURUM C: Oturum Yok (Giriş Yapılmamış)
          setIsGuest(false);
          resetDatabaseSession();
          setUser(null);
          setIsAdmin(false);
          setDbError(null);
        }
      }
      setInitializing(false);
    });

    // Force-Logout Olay Dinleyicisi (database.js 403 yakaladığında)
    const handleForceLogout = (e) => {
      const msg = e.detail?.message || 'Hesabınız yönetici tarafından askıya alınmıştır.';
      alert(msg);
      signOut();
    };
    window.addEventListener('jplanning:force-logout', handleForceLogout);

    // Migrasyon Hatası Olay Dinleyicisi (migrationService allMatched false olduğunda)
    const handleMigrationError = (e) => {
      const detailMsg = e.detail?.message;
      alert(
        '⚠️ Veri Aktarımı Uyarısı:\n\n' +
        'Misafir oturumundaki verileriniz yeni hesabınıza aktarılırken bir uyuşmazlık oluştu.\n\n' +
        'Merak etmeyin, verileriniz güvende ve silinmedi. Lütfen sayfayı yenileyerek (F5) aktarımı tekrar deneyin.' +
        (detailMsg ? `\n\nDetay: ${detailMsg}` : '')
      );
    };
    window.addEventListener('jplanning:migration-error', handleMigrationError);

    // Pencere Odağı (Window Focus) Denetimi — Misafirde auth.currentUser null olduğu için çalışmaz!
    const handleWindowFocus = async () => {
      if (!auth.currentUser) return; // Misafir modunda anında döner
      if (!auth.currentUser.emailVerified) return; // E-posta doğrulanmamışsa oturum kontrolü yapma
      try {
        // sessionStorage içinde geçerli (en az 5 dk kalan) bir oturum token'ı varsa Worker'a tekrar gitme
        const cachedStr = sessionStorage.getItem(`jplanning_session_${auth.currentUser.uid}`);
        if (cachedStr) {
          const cached = JSON.parse(cachedStr);
          const nowSec = Math.floor(Date.now() / 1000);
          if (cached.token && cached.expiresAt && cached.expiresAt > nowSec + 300) {
            return;
          }
        }

        // Token süresi dolmak üzereyse veya önbellekte yoksa oturumu güvenli şekilde doğrula
        // (database.js içindeki inFlightSessionPromise deduplication sayesinde paralel çağrılar tek istekte birleşir)
        await requestWorkerSession();
      } catch (_) { }
    };
    window.addEventListener('focus', handleWindowFocus);

    return () => {
      if (assignedTasksUnsub) assignedTasksUnsub();
      if (userStatusUnsub) userStatusUnsub();
      window.removeEventListener('jplanning:force-logout', handleForceLogout);
      window.removeEventListener('jplanning:migration-error', handleMigrationError);
      window.removeEventListener('focus', handleWindowFocus);
      unsubscribe();
    };
  }, [signOut]);

  const refreshProfile = async () => {
    if (isGuest) return;
    if (auth.currentUser) {
      try {
        const profile = await getUserProfile(auth.currentUser.uid);
        try {
          auth.currentUser.profile = profile;
        } catch (_) { }
        setUser(auth.currentUser);
      } catch (err) {
        console.warn('Profil yenilenemedi:', err);
      }
    }
  };

  const refreshAuthUser = useCallback(async () => {
    if (isGuest) return true;
    if (!auth.currentUser) return false;
    try {
      await auth.currentUser.reload();
      const updated = auth.currentUser;
      const profile = await getUserProfile(updated.uid).catch(() => null);
      try {
        updated.profile = profile || user?.profile || null;
      } catch (_) { }
      setUser(updated);

      if (updated.emailVerified && !isDatabaseReady()) {
        await initDatabase(updated.uid).catch((err) => {
          console.warn('[AuthContext] Doğrulama sonrası veritabanı başlatma hatası:', err);
        });
      }

      return Boolean(updated.emailVerified);
    } catch (e) {
      console.warn('Kullanıcı durumu yenilenemedi:', e);
      return false;
    }
  }, [isGuest, user?.profile]);

  const refreshAdminStatus = async () => {
    if (isGuest) {
      setIsAdmin(false);
      return false;
    }
    if (!auth.currentUser) {
      setIsAdmin(false);
      return false;
    }
    try {
      const tokenResult = await auth.currentUser.getIdTokenResult(true);
      const isAdm = Boolean(tokenResult?.claims?.admin);
      setIsAdmin(isAdm);
      return isAdm;
    } catch (err) {
      console.warn('Admin yetkisi yenilenemedi:', err);
      return false;
    }
  };

  const retryDatabaseConnection = async () => {
    if (isGuest) {
      setDbError(null);
      await initGuestDatabase();
      return;
    }
    if (auth.currentUser) {
      try {
        setDbError(null);
        await initDatabase(auth.currentUser.uid);
        const profile = await getUserProfile(auth.currentUser.uid);
        try {
          auth.currentUser.profile = profile;
        } catch (_) { }
        setUser(auth.currentUser);
      } catch (err) {
        setDbError(err.message || 'Yeniden bağlanma başarısız');
      }
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAdmin,
        isGuest,
        initializing,
        dbError,
        startGuestSession,
        exitGuestSession,
        refreshProfile,
        refreshAuthUser,
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
  if (!ctx) throw new Error('useAuth bir AuthProvider içinde kullanılmalıdır');
  return ctx;
}
