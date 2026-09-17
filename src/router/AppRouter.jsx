import { Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './AppLayout.jsx';
import PlaceholderPage from '../pages/PlaceholderPage.jsx';
import LoginPage from '../pages/LoginPage.jsx';
import TasksListPage from '../pages/TasksListPage.jsx';
import AddTaskPage from '../pages/AddTaskPage.jsx';
import TaskDetailPage from '../pages/TaskDetailPage.jsx';
import EditTaskPage from '../pages/EditTaskPage.jsx';
import CategoriesPage from '../pages/CategoriesPage.jsx';
import RewardsPage from '../pages/RewardsPage.jsx';
import RewardHistoryPage from '../pages/RewardHistoryPage.jsx';
import FriendsListPage from '../pages/FriendsListPage.jsx';
import AddFriendPage from '../pages/AddFriendPage.jsx';
import FriendDetailPage from '../pages/FriendDetailPage.jsx';
import AssignedByMePage from '../pages/AssignedByMePage.jsx';
import FocusPage from '../pages/FocusPage.jsx';
import FocusHistoryPage from '../pages/FocusHistoryPage.jsx';
import ProfilePage from '../pages/ProfilePage.jsx';
import EditProfilePage from '../pages/EditProfilePage.jsx';
import NotificationSettingsPage from '../pages/NotificationSettingsPage.jsx';
import DangerZonePage from '../pages/DangerZonePage.jsx';
import VerifyEmailPage from '../pages/VerifyEmailPage.jsx';
import DailyNotesPage from '../pages/DailyNotesPage.jsx';
import AccountDeletionPendingModal from '../components/AccountDeletionPendingModal.jsx';
import GuestRestrictedView from '../components/GuestRestrictedView.jsx';
import AdminPlaceholderPage from '../pages/admin/AdminPlaceholderPage.jsx';
import AdminLayout from '../pages/admin/AdminLayout.jsx';
import AdminUsersPage from '../pages/admin/AdminUsersPage.jsx';
import AdminStatsPage from '../pages/admin/AdminStatsPage.jsx';
import AdminAuditLogPage from '../pages/admin/AdminAuditLogPage.jsx';
import { useAuth } from '../context/AuthContext.jsx';

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

function RequireAuth({ children }) {
  const { user, isGuest, initializing, signOut } = useAuth();

  if (initializing) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;

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
  if (user) return <Navigate to="/" replace />;
  return children;
}

export default function AppRouter() {
  return (
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
  );
}
