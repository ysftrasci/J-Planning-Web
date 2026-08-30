// J-Planning — Admin Panel Layout (Faz 2)
import { useState } from 'react';
import { NavLink, Outlet, Link, useNavigate } from 'react-router-dom';
import {
  Users,
  BarChart3,
  ShieldCheck,
  ArrowLeft,
  RefreshCw,
  LogOut,
  Menu,
  X,
  History,
  Settings,
  Layers,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import './AdminLayout.css';

export default function AdminLayout() {
  const { user, refreshAdminStatus, signOut } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const navigate = useNavigate();

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refreshAdminStatus();
    setIsRefreshing(false);
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="admin-root-layout">
      {/* Mobil Karartma Perdesi */}
      {sidebarOpen && (
        <div
          className="admin-sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sol Sidebar */}
      <aside className={`admin-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="admin-sidebar-top">
          <div className="admin-brand">
            <div className="admin-logo-badge">
              <ShieldCheck size={22} color="#C98A2C" />
            </div>
            <div className="admin-brand-text">
              <span className="brand-title">J-Planning</span>
              <span className="brand-subtitle">Admin Control Plane</span>
            </div>
          </div>
          <button
            className="admin-sidebar-close-btn"
            onClick={() => setSidebarOpen(false)}
            aria-label="Menüyü Kapat"
          >
            <X size={20} />
          </button>
        </div>

        {/* Navigasyon Linkleri */}
        <nav className="admin-nav">
          <div className="nav-section-title">YÖNETİM MENÜSÜ</div>

          <NavLink
            to="/admin"
            end
            className={({ isActive }) =>
              `admin-nav-item ${isActive ? 'active' : ''}`
            }
            onClick={() => setSidebarOpen(false)}
          >
            <Users size={18} />
            <span>Kullanıcılar</span>
          </NavLink>

          <NavLink
            to="/admin/users"
            className={({ isActive }) =>
              `admin-nav-item ${isActive ? 'active' : ''}`
            }
            onClick={() => setSidebarOpen(false)}
          >
            <Users size={18} />
            <span>Kullanıcı Listesi</span>
          </NavLink>

          <NavLink
            to="/admin/stats"
            className={({ isActive }) =>
              `admin-nav-item ${isActive ? 'active' : ''}`
            }
            onClick={() => setSidebarOpen(false)}
          >
            <BarChart3 size={18} />
            <span>Genel İstatistikler</span>
          </NavLink>

          <div className="nav-section-title" style={{ marginTop: '20px' }}>
            GELECEK FAZLAR
          </div>

          <div className="admin-nav-item disabled" title="Faz 4'te aktif edilecek">
            <History size={18} />
            <span>Aktivite Logları</span>
            <span className="nav-badge">Faz 4</span>
          </div>

          <div className="admin-nav-item disabled" title="Faz 5'te aktif edilecek">
            <Settings size={18} />
            <span>Rol Yönetimi</span>
            <span className="nav-badge">Faz 5</span>
          </div>
        </nav>

        {/* Alt Yönetici Profil Kartı & Navigasyon */}
        <div className="admin-sidebar-footer">
          <Link to="/" className="back-to-app-btn">
            <ArrowLeft size={16} />
            <span>Kullanıcı Moduna Dön</span>
          </Link>

          <div className="admin-profile-card">
            <div className="admin-profile-info">
              <div className="admin-user-email font-mono" title={user?.email}>
                {user?.email || 'Admin'}
              </div>
              <div className="admin-role-badge">
                <ShieldCheck size={12} />
                <span>Tam Yetkili Admin</span>
              </div>
            </div>

            <div className="admin-profile-actions">
              <button
                className="admin-mini-btn"
                onClick={handleRefresh}
                title="Yetki & Token Yenile"
                disabled={isRefreshing}
              >
                <RefreshCw size={14} className={isRefreshing ? 'spin' : ''} />
              </button>
              <button
                className="admin-mini-btn logout"
                onClick={handleSignOut}
                title="Çıkış Yap"
              >
                <LogOut size={14} />
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Ana İçerik Bölgesi */}
      <div className="admin-main-wrapper">
        {/* Üst Bar */}
        <header className="admin-topbar">
          <div className="topbar-left">
            <button
              className="admin-menu-toggle-btn"
              onClick={() => setSidebarOpen(true)}
              aria-label="Menüyü Aç"
            >
              <Menu size={22} />
            </button>
            <div className="topbar-breadcrumbs">
              <span className="bc-root">Admin</span>
              <span className="bc-divider">/</span>
              <span className="bc-current">Kontrol Merkezi</span>
            </div>
          </div>

          <div className="topbar-right">
            <div className="control-plane-pill">
              <span className="status-indicator-dot"></span>
              <span className="pill-text">Control Plane: Hazır</span>
            </div>
          </div>
        </header>

        {/* Sayfa Gövdesi */}
        <main className="admin-page-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
