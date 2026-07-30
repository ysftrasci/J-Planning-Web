import { Routes, Route } from 'react-router-dom';
import AppLayout from './AppLayout.jsx';
import PlaceholderPage from '../pages/PlaceholderPage.jsx';

// Aşama 0 kapsamında kurulan temel yönlendirme (routing) iskeleti.
// Rotalar, ilgili Aşama tamamlandıkça gerçek ekranlarla değiştirilecek:
//   "/"         -> Aşama 3: TasksListScreen
//   "/rewards"  -> Aşama 4: RewardsScreen
//   "/friends"  -> Aşama 5: FriendsListScreen
//   "/focus"    -> Aşama 6: FocusScreen
//   "/profile"  -> Aşama 7: ProfileScreen
export default function AppRouter() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
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
