import { NavLink, Outlet } from 'react-router-dom';
import { CheckSquare, Gift, Users, Timer, User } from 'lucide-react';
import PWAInstallPrompt from '../components/PWAInstallPrompt.jsx';
import './AppLayout.css';

// J-Planning — Temel Sayfa Yönlendirme İskeleti (Web)

const TABS = [
  { to: '/', label: 'Görevler', icon: CheckSquare, end: true },
  { to: '/rewards', label: 'Ödüller', icon: Gift },
  { to: '/friends', label: 'Arkadaşlar', icon: Users },
  { to: '/focus', label: 'Odaklanma', icon: Timer },
  { to: '/profile', label: 'Profil', icon: User },
];

export default function AppLayout() {
  return (
    <div className="app-layout">
      <main className="app-layout__main">
        <Outlet />
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
