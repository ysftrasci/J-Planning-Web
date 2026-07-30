import { NavLink, Outlet } from 'react-router-dom';

// J-Planning — Temel Sayfa Yönlendirme İskeleti (Web)
//
// Mobildeki alt sekme (bottom tab) navigasyonunun (RootNavigator.js)
// web karşılığıdır. Şu an için sadece iskelet: her sekme, ilgili Aşama
// (3-7) hayata geçtikçe gerçek ekranlarla doldurulacak.

const TABS = [
  { to: '/', label: 'Görevler', end: true },
  { to: '/rewards', label: 'Ödüller' },
  { to: '/friends', label: 'Arkadaşlar' },
  { to: '/focus', label: 'Odaklanma' },
  { to: '/profile', label: 'Profil' },
];

export default function AppLayout() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100%',
      }}
    >
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
