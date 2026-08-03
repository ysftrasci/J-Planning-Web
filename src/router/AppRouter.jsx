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
import { useAuth } from '../context/AuthContext.jsx';

// Aşama 0 kapsamında kurulan temel yönlendirme (routing) iskeleti,
// Aşama 2 ile birlikte kimlik doğrulama koruması eklendi.
// Aşama 3 ile birlikte çekirdek görev ekranları eklendi.
// Aşama 4 ile birlikte ödül/puan ekranları eklendi.
// Aşama 5 ile birlikte arkadaşlık/sosyal ekranları eklendi.
// Aşama 6 ile birlikte odaklanma modu ekranları eklendi.
// Aşama 7 ile birlikte profil ve ayarlar ekranları eklendi.
// Rotalar:
//   "/"                     -> Aşama 3: TasksListPage (tamamlandı)
//   "/add-task"             -> Aşama 3: AddTaskPage (tamamlandı)
//   "/task/:taskId"         -> Aşama 3: TaskDetailPage (tamamlandı)
//   "/categories"           -> Aşama 3 & 7: CategoriesPage (tamamlandı)
//   "/rewards"              -> Aşama 4: RewardsPage (tamamlandı)
//   "/rewards/history"      -> Aşama 4: RewardHistoryPage (tamamlandı)
//   "/friends"              -> Aşama 5: FriendsListPage (tamamlandı)
//   "/friends/add"          -> Aşama 5: AddFriendPage (tamamlandı)
//   "/friends/:friendshipId"-> Aşama 5: FriendDetailPage (tamamlandı)
//   "/assigned-by-me"       -> Aşama 5: AssignedByMePage (tamamlandı)
//   "/focus"                -> Aşama 6: FocusPage (tamamlandı)
//   "/focus/history"        -> Aşama 6: FocusHistoryPage (tamamlandı)
//   "/profile"              -> Aşama 7: ProfilePage (tamamlandı)
//   "/profile/edit"         -> Aşama 7: EditProfilePage (tamamlandı)
//   "/profile/notifications"-> Aşama 7: NotificationSettingsPage (tamamlandı)
//   "/profile/danger-zone"   -> Aşama 7: DangerZonePage (tamamlandı)

// Giriş yapılmamışsa /login'e yönlendirir; auth durumu netleşene kadar
// (initializing) hiçbir şey render etmez, böylece kısa süreliğine
// LoginPage'in yanıp sönmesi önlenir.
function LoadingScreen() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: 'var(--color-background, #FAF5F7)',
        color: 'var(--color-accent, #E06D8C)',
        fontFamily: 'sans-serif',
        gap: '12px',
      }}
    >
      <h2 style={{ margin: 0, fontSize: '22px', fontWeight: '700' }}>J-Planning</h2>
      <p style={{ margin: 0, opacity: 0.7, fontSize: '14px' }}>Yükleniyor, lütfen bekleyin...</p>
    </div>
  );
}

// Güvenlik: giriş yapmış olsa bile e-postasını doğrulamayan kullanıcı
// (bkz. services/emailAuth.js -> registerWithEmail) uygulamanın hiçbir
// ekranını göremez, sadece VerifyEmailPage ile karşılaşır. Bu sayede
// başka birinin e-postasıyla hesap açılsa bile o hesap gerçek kullanıma
// asla geçemez (doğrulama linki her zaman e-postanın gerçek sahibine gider).
function RequireAuth({ children }) {
  const { user, initializing } = useAuth();
  if (initializing) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.emailVerified) return <Navigate to="/verify-email" replace />;
  return children;
}

// Doğrulama bekleyen kullanıcı /verify-email dışındaki bir rotaya gitmeye
// çalışırsa zaten yukarıdaki RequireAuth onu buraya geri yönlendirir.
// Bu bileşen de tam tersini yapar: doğrulanmış (veya hiç giriş yapmamış)
// kullanıcı /verify-email'i doğrudan ziyaret ederse uygun yere yönlendirilir.
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
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<TasksListPage />} />
        <Route path="add-task" element={<AddTaskPage />} />
        <Route path="daily-notes" element={<DailyNotesPage />} />
        <Route path="task/:taskId" element={<TaskDetailPage />} />
        <Route path="task/:taskId/edit" element={<EditTaskPage />} />
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
