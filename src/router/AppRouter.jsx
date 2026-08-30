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
import AdminPlaceholderPage from '../pages/admin/AdminPlaceholderPage.jsx';
import AdminLayout from '../pages/admin/AdminLayout.jsx';
import AdminUsersPage from '../pages/admin/AdminUsersPage.jsx';
import AdminStatsPage from '../pages/admin/AdminStatsPage.jsx';
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
      <p style={{ margin: 0, opacity: 0.7, fontSize: '14px' }}>Yükleniyor, lütfen bekleyin...</p>
    </div>
  );
}

function RequireAuth({ children }) {
  const { user, initializing, signOut } = useAuth();
  if (initializing) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
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

function RequireAdmin({ children }) {
  const { user, isAdmin, initializing, signOut } = useAuth();
  if (initializing) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
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
  const { user, initializing } = useAuth();
  if (initializing) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.emailVerified) return <Navigate to="/" replace />;
  return children;
}

function RedirectIfAuthed({ children }) {
  const { user, initializing } = useAuth();
  if (initializing) return <LoadingScreen />;
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
      {/* Yönetici Paneli Rotaları (RequireAdmin ile tam korumalı) */}
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
        <Route path="ping" element={<AdminPlaceholderPage />} />
      </Route>
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
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
        <Route path="friends" element={<FriendsListPage />} />
        <Route path="friends/add" element={<AddFriendPage />} />
        <Route path="friends/:friendshipId" element={<FriendDetailPage />} />
        <Route path="assigned-by-me" element={<AssignedByMePage />} />
        <Route path="focus" element={<FocusPage />} />
        <Route path="focus/history" element={<FocusHistoryPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="profile/edit" element={<EditProfilePage />} />
        <Route path="profile/notifications" element={<NotificationSettingsPage />} />
        <Route path="profile/danger-zone" element={<DangerZonePage />} />
        <Route
          path="*"
          element={<PlaceholderPage title="Sayfa bulunamadı" stageLabel="404" />}
        />
      </Route>
    </Routes>
  );
}
