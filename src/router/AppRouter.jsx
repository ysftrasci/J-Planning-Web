import { Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './AppLayout.jsx';
import PlaceholderPage from '../pages/PlaceholderPage.jsx';
import LoginPage from '../pages/LoginPage.jsx';
import TasksListPage from '../pages/TasksListPage.jsx';
import AddTaskPage from '../pages/AddTaskPage.jsx';
import TaskDetailPage from '../pages/TaskDetailPage.jsx';
import CategoriesPage from '../pages/CategoriesPage.jsx';
import RewardsPage from '../pages/RewardsPage.jsx';
import RewardHistoryPage from '../pages/RewardHistoryPage.jsx';
import FriendsListPage from '../pages/FriendsListPage.jsx';
import AddFriendPage from '../pages/AddFriendPage.jsx';
import FriendDetailPage from '../pages/FriendDetailPage.jsx';
import AssignedByMePage from '../pages/AssignedByMePage.jsx';
import { useAuth } from '../context/AuthContext.jsx';

// Aşama 0 kapsamında kurulan temel yönlendirme (routing) iskeleti,
// Aşama 2 ile birlikte kimlik doğrulama koruması eklendi.
// Aşama 3 ile birlikte çekirdek görev ekranları eklendi.
// Aşama 4 ile birlikte ödül/puan ekranları eklendi.
// Aşama 5 ile birlikte arkadaşlık/sosyal ekranları eklendi.
// Rotalar, ilgili Aşama tamamlandıkça gerçek ekranlarla değiştirilecek:
//   "/"             -> Aşama 3: TasksListPage (tamamlandı)
//   "/add-task"     -> Aşama 3: AddTaskPage (tamamlandı)
//   "/task/:taskId" -> Aşama 3: TaskDetailPage (tamamlandı)
//   "/categories"   -> Aşama 3: CategoriesPage (tamamlandı) — kalıcı yeri
//                      Aşama 7'de Profil altına taşınacak, şimdilik
//                      Görevlerim üzerinden erişilir.
//   "/rewards"              -> Aşama 4: RewardsPage (tamamlandı)
//   "/rewards/history"      -> Aşama 4: RewardHistoryPage (tamamlandı)
//   "/friends"              -> Aşama 5: FriendsListPage (tamamlandı)
//   "/friends/add"          -> Aşama 5: AddFriendPage (tamamlandı)
//   "/friends/:friendshipId"-> Aşama 5: FriendDetailPage (tamamlandı)
//   "/assigned-by-me"       -> Aşama 5: AssignedByMePage (tamamlandı)
//   "/focus"        -> Aşama 6: FocusScreen
//   "/profile"      -> Aşama 7: ProfileScreen

// Giriş yapılmamışsa /login'e yönlendirir; auth durumu netleşene kadar
// (initializing) hiçbir şey render etmez, böylece kısa süreliğine
// LoginPage'in yanıp sönmesi önlenir.
function RequireAuth({ children }) {
  const { user, initializing } = useAuth();
  if (initializing) return null;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

// Zaten giriş yapmış bir kullanıcı /login'e giderse ana ekrana yönlendirir.
function RedirectIfAuthed({ children }) {
  const { user, initializing } = useAuth();
  if (initializing) return null;
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
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<TasksListPage />} />
        <Route path="add-task" element={<AddTaskPage />} />
        <Route path="task/:taskId" element={<TaskDetailPage />} />
        <Route path="categories" element={<CategoriesPage />} />
        <Route path="rewards" element={<RewardsPage />} />
        <Route path="rewards/history" element={<RewardHistoryPage />} />
        <Route path="friends" element={<FriendsListPage />} />
        <Route path="friends/add" element={<AddFriendPage />} />
        <Route path="friends/:friendshipId" element={<FriendDetailPage />} />
        <Route path="assigned-by-me" element={<AssignedByMePage />} />
        <Route
          path="focus"
          element={<PlaceholderPage title="Odaklanma" stageLabel="Aşama 6" />}
        />
        <Route
          path="profile"
          element={<PlaceholderPage title="Profil" stageLabel="Aşama 7" />}
        />
        <Route
          path="*"
          element={<PlaceholderPage title="Sayfa bulunamadı" stageLabel="404" />}
        />
      </Route>
    </Routes>
  );
}
