import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

// J-Planning — Temel Sayfa Yönlendirme İskeleti (Web)
//
// Mobildeki alt sekme (bottom tab) navigasyonunun (RootNavigator.js)
// web karşılığıdır. Şu an için sadece iskelet: her sekme, ilgili Aşama
// (3-7) hayata geçtikçe gerçek ekranlarla doldurulacak.
// Aşama 2: geçici bir "Çıkış yap" bağlantısı eklendi — asıl yeri
// Aşama 7'deki ProfileScreen olacak, o zamana kadar test amaçlı burada.

const TABS = [
  { to: '/', label: 'Görevler', end: true },
  { to: '/rewards', label: 'Ödüller' },
  { to: '/friends', label: 'Arkadaşlar' },
  { to: '/focus', label: 'Odaklanma' },
  { to: '/profile', label: 'Profil' },
];

export default function AppLayout() {
  const { user, signOut } = useAuth();

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100%',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--space-md) var(--space-lg)',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <span className="caption">
          {user?.profile?.displayName || user?.displayName || 'Kullanıcı'}
          {user?.profile?.userCode ? ` · ${user.profile.userCode}` : ''}
        </span>
        <button
          type="button"
          onClick={signOut}
          className="caption"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--color-accent-dark)',
          }}
        >
          Çıkış yap
        </button>
      </header>

      <main style={{ flex: 1, padding: 'var(--space-lg)' }}>
        <Outlet />
      </main>

      <nav
        style={{
          display: 'flex',
          borderTop: '1px solid var(--color-border)',
          backgroundColor: 'var(--color-surface)',
          position: 'sticky',
          bottom: 0,
        }}
      >
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            style={({ isActive }) => ({
              flex: 1,
              textAlign: 'center',
              padding: 'var(--space-sm) 0',
              textDecoration: 'none',
              fontSize: 'var(--font-small-size)',
              fontWeight: 'var(--font-small-weight)',
              color: isActive
                ? 'var(--color-accent)'
                : 'var(--color-text-secondary)',
            })}
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
