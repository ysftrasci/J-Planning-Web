import { Suspense, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import AppLayout from './AppLayout.jsx';
import PlaceholderPage from '../pages/PlaceholderPage.jsx';
import LoginPage from '../pages/LoginPage.jsx';
import TasksListPage from '../pages/TasksListPage.jsx';
import VerifyEmailPage from '../pages/VerifyEmailPage.jsx';
import AccountDeletionPendingModal from '../components/AccountDeletionPendingModal.jsx';
import GuestRestrictedView from '../components/GuestRestrictedView.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { lazyPage } from './lazyPage.js';

// Ana ekran (görev listesi) ve giriş sayfaları ilk yüklemede gelir; diğer sayfalar ihtiyaç anında.
const AddTaskPage = lazyPage(() => import('../pages/AddTaskPage.jsx'));
const TaskDetailPage = lazyPage(() => import('../pages/TaskDetailPage.jsx'));
const EditTaskPage = lazyPage(() => import('../pages/EditTaskPage.jsx'));
const CategoriesPage = lazyPage(() => import('../pages/CategoriesPage.jsx'));
const RewardsPage = lazyPage(() => import('../pages/RewardsPage.jsx'));
const RewardHistoryPage = lazyPage(() => import('../pages/RewardHistoryPage.jsx'));
const FriendsListPage = lazyPage(() => import('../pages/FriendsListPage.jsx'));
const AddFriendPage = lazyPage(() => import('../pages/AddFriendPage.jsx'));
const FriendDetailPage = lazyPage(() => import('../pages/FriendDetailPage.jsx'));
const AssignedByMePage = lazyPage(() => import('../pages/AssignedByMePage.jsx'));
const FocusPage = lazyPage(() => import('../pages/FocusPage.jsx'));
const FocusHistoryPage = lazyPage(() => import('../pages/FocusHistoryPage.jsx'));
const ProfilePage = lazyPage(() => import('../pages/ProfilePage.jsx'));
const EditProfilePage = lazyPage(() => import('../pages/EditProfilePage.jsx'));
const NotificationSettingsPage = lazyPage(() => import('../pages/NotificationSettingsPage.jsx'));
const DangerZonePage = lazyPage(() => import('../pages/DangerZonePage.jsx'));
const DailyNotesPage = lazyPage(() => import('../pages/DailyNotesPage.jsx'));
const AdminPlaceholderPage = lazyPage(() => import('../pages/admin/AdminPlaceholderPage.jsx'));
const AdminLayout = lazyPage(() => import('../pages/admin/AdminLayout.jsx'));
const AdminUsersPage = lazyPage(() => import('../pages/admin/AdminUsersPage.jsx'));
const AdminStatsPage = lazyPage(() => import('../pages/admin/AdminStatsPage.jsx'));
const AdminAuditLogPage = lazyPage(() => import('../pages/admin/AdminAuditLogPage.jsx'));

function LoadingScreen() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        gap: '12px',
        color: '#1a1a1a',
      }}
    >
      <div
        style={{
          width: '32px',
          height: '32px',
          border: '3px solid #e5e5e5',
          borderTopColor: '#C98A2C',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }}
      />
      <h2 style={{ margin: 0, fontSize: '22px', fontWeight: '700' }}>J-Planning</h2>
      <p style={{ margin: 0, opacity: 0.7, fontSize: '14px' }}>Yükleniyor, lütfen bekle...</p>
    </div>
  );
}

const AUTH_REDIRECT_KEY = 'jp_auth_redirect';

// Giriş sonrası dönülecek hedefi okur. Yalnızca uygulama içi, güvenli yollar kabul edilir.
function readAuthRedirect() {
  try {
    const saved = window.sessionStorage.getItem(AUTH_REDIRECT_KEY);
    if (saved && saved.startsWith('/friends/add') && !saved.startsWith('//')) return saved;
  } catch {}
  return null;
}

function RequireAuth({ children }) {
  const { user, isGuest, initializing, signOut } = useAuth();
  const location = useLocation();

  const isFullyAuthed = Boolean(user) && !isGuest && Boolean(user?.emailVerified);

  // Kullanıcı hedef sayfaya ulaştıysa bekleyen yönlendirme kaydını temizle.
  useEffect(() => {
    if (!isFullyAuthed) return;
    try {
      window.sessionStorage.removeItem(AUTH_REDIRECT_KEY);
    } catch {}
  }, [isFullyAuthed, location.pathname]);

  if (initializing) return <LoadingScreen />;
  if (!user) {
    // Arkadaşlık davet linkiyle (/friends/add?code=...) gelen ama giriş yapmamış kişi,
    // giriş/kayıt/e-posta doğrulama sonrası aynı linke geri dönebilsin.
    if (location.pathname.startsWith('/friends/add')) {
      try {
        window.sessionStorage.setItem(AUTH_REDIRECT_KEY, `${location.pathname}${location.search}`);
      } catch {}
    }
    return <Navigate to="/login" replace />;
  }

  // Misafir kullanıcı e-posta doğrulama veya hesap silme engeline takılmaz
  if (isGuest) return children;

  if (!user.emailVerified) return <Navigate to="/verify-email" replace />;

  if (user?.profile?.isDeleting === true) {
    return (
      <AccountDeletionPendingModal
        open={true}
        uid={user.uid}
        onSuccess={() => {
          window.location.href = '/login';
        }}
        onSignOut={signOut}
      />
    );
  }

  return children;
}

function RequireRegisteredUser({ children, title, description }) {
  const { isGuest } = useAuth();
  if (isGuest) {
    return <GuestRestrictedView title={title} description={description} />;
  }
  return children;
}

function RequireAdmin({ children }) {
  const { user, isGuest, isAdmin, initializing, signOut } = useAuth();

  if (initializing) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;

  // Misafir kullanıcı kesinlikle yönetici olamaz
  if (isGuest) return <Navigate to="/" replace />;

  if (!user.emailVerified) return <Navigate to="/verify-email" replace />;

  if (user?.profile?.isDeleting === true) {
    return (
      <AccountDeletionPendingModal
        open={true}
        uid={user.uid}
        onSuccess={() => {
          window.location.href = '/login';
        }}
        onSignOut={signOut}
      />
    );
  }

  // Admin yetkisi yoksa, rota varlığını hissettirmeden ana sayfaya yönlendir
  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  return children;
}

function RequireUnverified({ children }) {
  const { user, isGuest, initializing } = useAuth();
  if (initializing) return <LoadingScreen />;
  if (isGuest) return <Navigate to="/" replace />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.emailVerified) return <Navigate to="/" replace />;
  return children;
}

function RedirectIfAuthed({ children }) {
  const { user, isGuest, initializing } = useAuth();
  if (initializing) return <LoadingScreen />;
  // Misafir kullanıcı hesap oluşturmak veya giriş yapmak için login/register sayfasına erişebilmelidir
  if (isGuest) return children;
  if (user && !user.emailVerified) return <Navigate to="/verify-email" replace />;
  if (user) return <Navigate to={readAuthRedirect() || '/'} replace />;
  return children;
}

export default function AppRouter() {
  return (
    <Suspense fallback={<LoadingScreen />}>
    <Routes>
      <Route
        path="login"
        element={
          <RedirectIfAuthed>
            <LoginPage />
          </RedirectIfAuthed>
        }
      />
      <Route
        path="verify-email"
        element={
          <RequireUnverified>
            <VerifyEmailPage />
          </RequireUnverified>
        }
      />
      {/* Yönetici Paneli Rotaları (RequireAdmin ile tam korumalı, misafire kapalı) */}
      <Route
        path="admin"
        element={
          <RequireAdmin>
            <AdminLayout />
          </RequireAdmin>
        }
      >
        <Route index element={<AdminUsersPage />} />
        <Route path="users" element={<AdminUsersPage />} />
        <Route path="stats" element={<AdminStatsPage />} />
        <Route path="audit-logs" element={<AdminAuditLogPage />} />
        <Route path="ping" element={<AdminPlaceholderPage />} />
      </Route>
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        {/* AÇIK: Kişisel Planlama & Üretkenlik Özellikleri */}
        <Route index element={<TasksListPage />} />
        <Route path="tasks" element={<TasksListPage />} />
        <Route path="tasks/new" element={<AddTaskPage />} />
        <Route path="task/new" element={<AddTaskPage />} />
        <Route path="add-task" element={<AddTaskPage />} />
        <Route path="tasks/:taskId" element={<TaskDetailPage />} />
        <Route path="task/:taskId" element={<TaskDetailPage />} />
        <Route path="tasks/:taskId/edit" element={<EditTaskPage />} />
        <Route path="task/:taskId/edit" element={<EditTaskPage />} />
        <Route path="daily-notes" element={<DailyNotesPage />} />
        <Route path="categories" element={<CategoriesPage />} />
        <Route path="rewards" element={<RewardsPage />} />
        <Route path="rewards/history" element={<RewardHistoryPage />} />
        <Route path="focus" element={<FocusPage />} />
        <Route path="focus/history" element={<FocusHistoryPage />} />
        <Route path="profile" element={<ProfilePage />} />

        {/* KAPALI: Misafire Kısıtlı Rotalar (RequireRegisteredUser ile korumalı) */}
        <Route
          path="friends"
          element={
            <RequireRegisteredUser
              title="Arkadaşlık Sistemi Kayıtlı Kullanıcılara Özeldir"
              description="Arkadaşlarınla görev paylaşmak, birbirini motive etmek ve birlikte büyümek için ücretsiz bir hesap oluşturabilirsin."
            >
              <FriendsListPage />
            </RequireRegisteredUser>
          }
        />
        <Route
          path="friends/add"
          element={
            <RequireRegisteredUser
              title="Arkadaş Ekleme Kayıtlı Kullanıcılara Özeldir"
              description="Arkadaşlarını eklemek için ücretsiz bir hesap oluşturabilirsin."
            >
              <AddFriendPage />
            </RequireRegisteredUser>
          }
        />
        <Route
          path="friends/:friendshipId"
          element={
            <RequireRegisteredUser title="Arkadaş Detayı Kayıtlı Kullanıcılara Özeldir">
              <FriendDetailPage />
            </RequireRegisteredUser>
          }
        />
        <Route
          path="assigned-by-me"
          element={
            <RequireRegisteredUser
              title="Atanan Görevler Kayıtlı Kullanıcılara Özeldir"
              description="Arkadaşlarına görev atamak ve onların ilerlemesini takip etmek için ücretsiz kayıt ol."
            >
              <AssignedByMePage />
            </RequireRegisteredUser>
          }
        />
        <Route
          path="profile/edit"
          element={
            <RequireRegisteredUser
              title="Profil Düzenleme Kayıtlı Kullanıcılara Özeldir"
              description="Profil fotoğrafı ve adını kalıcı hale getirmek için ücretsiz hesap oluştur."
            >
              <EditProfilePage />
            </RequireRegisteredUser>
          }
        />
        <Route
          path="profile/notifications"
          element={
            <RequireRegisteredUser
              title="Bildirim Ayarları Kayıtlı Kullanıcılara Özeldir"
              description="Anlık hatırlatıcılar ve web push bildirimleri almak için lütfen ücretsiz hesap oluştur."
            >
              <NotificationSettingsPage />
            </RequireRegisteredUser>
          }
        />
        <Route
          path="profile/danger-zone"
          element={
            <RequireRegisteredUser
              title="Hesap Silme"
              description="Misafir oturumunda silinecek bir bulut hesabı bulunmamaktadır. Profil sayfasından Misafir Oturumunu kapatabilirsin."
            >
              <DangerZonePage />
            </RequireRegisteredUser>
          }
        />
        <Route
          path="*"
          element={<PlaceholderPage title="Sayfa bulunamadı" stageLabel="404" />}
        />
      </Route>
    </Routes>
    </Suspense>
  );
}
