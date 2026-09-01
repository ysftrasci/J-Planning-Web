// J-Planning — Admin Kullanıcı Listesi Sayfası
import { useState, useEffect, useCallback } from 'react';
import {
  Search,
  RefreshCw,
  User,
  Database,
  Calendar,
  Clock,
  CheckCircle2,
  XCircle,
  ChevronLeft,
  ChevronRight,
  Info,
  ArrowUpDown,
  Filter,
  Eye,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { auth } from '../../services/firebase';
import AdminUserDetailModal from './AdminUserDetailModal';
import './AdminUsersPage.css';

export default function AdminUsersPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortBy, setSortBy] = useState('last_login_at');
  const [order, setOrder] = useState('desc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);

  const workerUrl = import.meta.env.VITE_WORKER_URL || 'https://jplanning-auth-worker.ysftrasci.workers.dev';

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPagination((prev) => ({ ...prev, page: 1 }));
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchUsers = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);

    try {
      const idToken = typeof user?.getIdToken === 'function'
        ? await user.getIdToken()
        : (auth.currentUser ? await auth.currentUser.getIdToken() : null);
      if (!idToken) throw new Error('Oturum tokenı alınamadı.');
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        sortBy,
        order,
      });

      if (debouncedSearch) {
        params.set('search', debouncedSearch);
      }

      const response = await fetch(`${workerUrl}/admin/users?${params.toString()}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setUsers(data.users || []);
        setPagination(data.pagination);
      } else {
        setError(data.message || 'Kullanıcılar yüklenemedi.');
      }
    } catch (err) {
      setError(err.message || 'Worker bağlantı hatası.');
    } finally {
      setLoading(false);
    }
  }, [user, pagination.page, pagination.limit, sortBy, order, debouncedSearch, workerUrl]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const formatDate = (timestamp) => {
    if (!timestamp) return '—';
    try {
      const date = new Date(timestamp);
      return new Intl.DateTimeFormat('tr-TR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(date);
    } catch {
      return '—';
    }
  };

  const handlePageChange = (newPage) => {
    if (newPage < 1 || newPage > pagination.totalPages || newPage === pagination.page) return;
    setPagination((prev) => ({ ...prev, page: newPage }));
  };

  return (
    <div className="admin-users-container">
      {/* Başlık Alanı */}
      <div className="users-page-header">
        <div>
          <h1 className="page-title">Kullanıcı Yönetimi</h1>
          <p className="page-subtitle">
            Control plane dizinindeki tüm kayıtlı kullanıcılar ve durumları
          </p>
        </div>
        <button
          onClick={fetchUsers}
          className="admin-action-btn"
          disabled={loading}
          title="Listeyi Yenile"
        >
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
          <span>Yenile</span>
        </button>
      </div>

      {/* Bilgilendirme Notu: Sayaçların Durumu */}
      <div className="notice-banner">
        <Info size={18} className="notice-icon" />
        <div className="notice-text">
          <strong>Önemli Not:</strong> Görev sayısı ve JP bakiyesi değerleri Faz 3 kullanıcı detay ve
          drill-down senkronizasyonu ile tam eşitlenecektir. Şu an veritabanındaki başlangıç özetleri
          listelenmektedir.
        </div>
      </div>

      {/* Filtre ve Arama Çubuğu */}
      <div className="users-controls-card">
        <div className="search-box">
          <Search size={18} className="search-icon" />
          <input
            type="text"
            placeholder="E-posta, isim veya UID ile ara..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="search-input"
          />
          {search && (
            <button className="clear-search-btn" onClick={() => setSearch('')}>
              ×
            </button>
          )}
        </div>

        <div className="controls-right">
          <div className="control-group">
            <Filter size={15} className="control-icon" />
            <label className="control-label">Sırala:</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="control-select"
            >
              <option value="last_login_at">Son Giriş</option>
              <option value="created_at">Kayıt Tarihi</option>
              <option value="email">E-posta</option>
              <option value="task_count">Görev Sayısı (Özet)</option>
              <option value="jp_balance">JP Bakiyesi (Özet)</option>
            </select>
          </div>

          <div className="control-group">
            <ArrowUpDown size={15} className="control-icon" />
            <select
              value={order}
              onChange={(e) => setOrder(e.target.value)}
              className="control-select"
            >
              <option value="desc">Azalan</option>
              <option value="asc">Artan</option>
            </select>
          </div>

          <div className="control-group">
            <label className="control-label">Sayfa Başı:</label>
            <select
              value={pagination.limit}
              onChange={(e) =>
                setPagination((prev) => ({
                  ...prev,
                  limit: parseInt(e.target.value, 10),
                  page: 1,
                }))
              }
              className="control-select"
            >
              <option value="10">10</option>
              <option value="20">20</option>
              <option value="50">50</option>
            </select>
          </div>
        </div>
      </div>

      {/* Tablo & İçerik Alanı */}
      <div className="table-responsive-wrapper">
        {loading && (
          <div className="table-loading-skeleton">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="skeleton-row" />
            ))}
          </div>
        )}

        {!loading && error && (
          <div className="table-error-state">
            <p>{error}</p>
            <button onClick={fetchUsers} className="admin-retry-btn">
              Tekrar Dene
            </button>
          </div>
        )}

        {!loading && !error && users.length === 0 && (
          <div className="table-empty-state">
            <User size={36} color="#94a3b8" />
            <h3>Kullanıcı Bulunamadı</h3>
            <p>
              {debouncedSearch
                ? `"${debouncedSearch}" aramasına uygun hiçbir kullanıcı kaydı eşleşmedi.`
                : 'Control plane üzerinde henüz listelenecek kullanıcı bulunmuyor.'}
            </p>
          </div>
        )}

        {!loading && !error && users.length > 0 && (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Kullanıcı</th>
                <th>Veritabanı</th>
                <th>Kayıt Tarihi</th>
                <th>Son Giriş</th>
                <th>Görevler</th>
                <th>JP Bakiyesi</th>
                <th>Durum</th>
                <th>İşlem</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr
                  key={u.uid}
                  className="table-data-row clickable-row"
                  onClick={() => setSelectedUser(u)}
                  title="Kullanıcı detayını görüntülemek ve düzenlemek için tıklayın"
                >
                  {/* Kullanıcı Bilgisi */}
                  <td>
                    <div className="user-cell">
                      <div className="user-avatar-badge">
                        <User size={16} />
                      </div>
                      <div className="user-info">
                        <span className="user-name">
                          {u.display_name || u.email?.split('@')[0] || 'Kullanıcı'}
                        </span>
                        <span className="user-email font-mono">{u.email || '—'}</span>
                        <span className="user-uid font-mono">{u.uid}</span>
                      </div>
                    </div>
                  </td>

                  {/* Veritabanı Adı */}
                  <td>
                    <div className="db-cell font-mono">
                      <Database size={13} color="#64748b" />
                      <span>{u.db_name || `jplanning-user-${u.uid}`}</span>
                    </div>
                  </td>

                  {/* Kayıt Tarihi */}
                  <td>
                    <div className="date-cell">
                      <Calendar size={13} color="#94a3b8" />
                      <span>{formatDate(u.created_at)}</span>
                    </div>
                  </td>

                  {/* Son Giriş */}
                  <td>
                    <div className="date-cell">
                      <Clock size={13} color="#94a3b8" />
                      <span>{formatDate(u.last_login_at)}</span>
                    </div>
                  </td>

                  {/* Görev Sayısı */}
                  <td>
                    <div className="metric-cell">
                      <span className="metric-val">{u.task_count ?? 0}</span>
                      <span className="metric-sub-tag">Özet</span>
                    </div>
                  </td>

                  {/* JP Bakiyesi */}
                  <td>
                    <div className="metric-cell">
                      <span className="jp-val">{(u.jp_balance ?? 0).toLocaleString('tr-TR')} JP</span>
                      <span className="metric-sub-tag">Özet</span>
                    </div>
                  </td>

                  {/* Durum */}
                  <td>
                    {u.is_disabled === 1 ? (
                      <span className="status-badge disabled">
                        <XCircle size={12} />
                        <span>Pasif</span>
                      </span>
                    ) : (
                      <span className="status-badge active">
                        <CheckCircle2 size={12} />
                        <span>Aktif</span>
                      </span>
                    )}
                  </td>

                  {/* İşlem (İncele Butonu) */}
                  <td>
                    <button
                      type="button"
                      className="admin-inspect-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedUser(u);
                      }}
                      title="Kullanıcıyı İncele & Düzenle"
                    >
                      <Eye size={14} />
                      <span>İncele</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Sayfalama Kontrolleri */}
      {!loading && !error && pagination.totalPages > 1 && (
        <div className="pagination-bar">
          <div className="pagination-info">
            Toplam <strong>{pagination.total}</strong> kullanıcıdan{' '}
            <strong>{(pagination.page - 1) * pagination.limit + 1}</strong> -{' '}
            <strong>{Math.min(pagination.page * pagination.limit, pagination.total)}</strong> arası
            gösteriliyor
          </div>

          <div className="pagination-buttons">
            <button
              onClick={() => handlePageChange(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="pagination-nav-btn"
            >
              <ChevronLeft size={16} />
              <span>Önceki</span>
            </button>

            <span className="page-indicator">
              Sayfa {pagination.page} / {pagination.totalPages}
            </span>

            <button
              onClick={() => handlePageChange(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
              className="pagination-nav-btn"
            >
              <span>Sonraki</span>
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Kullanıcı Detay & Düzenleme Modalı (Faz 3 + Faz 4) */}
      {selectedUser && (
        <AdminUserDetailModal
          userMeta={selectedUser}
          onClose={() => {
            setSelectedUser(null);
            fetchUsers();
          }}
          onUserStatusChanged={(uid, newStatus) => {
            setUsers((prev) =>
              prev.map((usr) => (usr.uid === uid ? { ...usr, is_disabled: newStatus } : usr))
            );
            if (selectedUser?.uid === uid) {
              setSelectedUser((prev) => ({ ...prev, is_disabled: newStatus }));
            }
          }}
        />
      )}
    </div>
  );
}
