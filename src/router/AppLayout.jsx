import { NavLink, Outlet } from 'react-router-dom';
import { CheckSquare, Gift, Users, Timer, User } from 'lucide-react';
import { Suspense, useState } from 'react';
import PWAInstallPrompt from '../components/PWAInstallPrompt.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import GuestBanner from '../components/GuestBanner.jsx';
import './AppLayout.css';

// J-Planning — Temel Sayfa Yönlendirme İskeleti (Web)

const TABS = [
  { to: '/', label: 'Görevler', icon: CheckSquare, end: true },
  { to: '/rewards', label: 'Ödüller', icon: Gift },
  { to: '/friends', label: 'Arkadaşlar', icon: Users },
  { to: '/focus', label: 'Odaklanma', icon: Timer },
  { to: '/profile', label: 'Profil', icon: User },
];

// Veritabanına bağlanılamadığında gösterilir. Bu olmadan kullanıcı boş bir görev
// listesi görür ve verilerinin silindiğini sanar.
function DatabaseErrorBanner() {
  const { dbError } = useAuth();
  const [retrying, setRetrying] = useState(false);

  if (!dbError) return null;

  // Tam yeniden yükleme: veritabanı bağlantısıyla birlikte, ilk açılışta başlatılamamış
  // olan gerçek zamanlı dinleyiciler (atanan görevler, hesap durumu) de baştan kurulur.
  const handleRetry = () => {
    if (retrying) return;
    setRetrying(true);
    window.location.reload();
  };

  return (
    <div className="app-layout__db-error" role="alert">
      <div className="app-layout__db-error-text">
        <strong>Verilerine şu anda ulaşılamıyor</strong>
        <span>
          Görevlerin silinmedi; bağlantı kurulunca geri gelecek. İnternet bağlantını kontrol edip tekrar dene.
        </span>
      </div>
      <button type="button" className="app-layout__db-error-button" onClick={handleRetry} disabled={retrying}>
        {retrying ? 'Deneniyor…' : 'Tekrar Dene'}
      </button>
    </div>
  );
}

export default function AppLayout() {
  return (
    <div className="app-layout">
      <GuestBanner />
      <DatabaseErrorBanner />
      <main className="app-layout__main">
        {/* Sayfa parçası yüklenirken alt menü ekranda kalsın */}
        <Suspense fallback={<div className="app-layout__page-loading">Yükleniyor…</div>}>
          <Outlet />
        </Suspense>
      </main>

      <PWAInstallPrompt />

      <div className="app-layout__nav-wrapper">
        <nav className="app-layout__nav">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={tab.end}
                className={({ isActive }) =>
                  `app-layout__tab ${isActive ? 'app-layout__tab--active' : ''}`
                }
              >
                <Icon size={20} className="app-layout__tab-icon" />
                <span className="app-layout__tab-label">{tab.label}</span>
              </NavLink>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
