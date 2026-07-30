import { Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './AppLayout.jsx';
import PlaceholderPage from '../pages/PlaceholderPage.jsx';
import LoginPage from '../pages/LoginPage.jsx';
import { useAuth } from '../context/AuthContext.jsx';

// Aşama 0 kapsamında kurulan temel yönlendirme (routing) iskeleti,
// Aşama 2 ile birlikte kimlik doğrulama koruması eklendi.
// Rotalar, ilgili Aşama tamamlandıkça gerçek ekranlarla değiştirilecek:
//   "/"         -> Aşama 3: TasksListScreen
//   "/rewards"  -> Aşama 4: RewardsScreen
//   "/friends"  -> Aşama 5: FriendsListScreen
//   "/focus"    -> Aşama 6: FocusScreen
//   "/profile"  -> Aşama 7: ProfileScreen

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
        <Route
          index
          element={<PlaceholderPage title="Görevler" stageLabel="Aşama 3" />}
        />
        <Route
          path="rewards"
          element={<PlaceholderPage title="Ödüller" stageLabel="Aşama 4" />}
        />
        <Route
          path="friends"
          element={<PlaceholderPage title="Arkadaşlar" stageLabel="Aşama 5" />}
        />
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
