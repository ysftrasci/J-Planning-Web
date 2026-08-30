// J-Planning — Admin İstatistik Sayfası (Faz 2)
import { useState, useEffect, useCallback } from 'react';
import {
  Users,
  UserCheck,
  Calendar,
  CheckSquare,
  Coins,
  ShieldAlert,
  Server,
  RefreshCw,
  Info,
  TrendingUp,
  Activity,
  Database,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import './AdminStatsPage.css';

export default function AdminStatsPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const workerUrl = import.meta.env.VITE_WORKER_URL || 'https://jplanning-auth-worker.ysftrasci.workers.dev';

  const fetchStats = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);

    try {
      const idToken = typeof user?.getIdToken === 'function'
        ? await user.getIdToken()
        : (auth.currentUser ? await auth.currentUser.getIdToken() : null);
      if (!idToken) throw new Error('Oturum tokenı alınamadı.');
      const response = await fetch(`${workerUrl}/admin/stats`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();
      if (response.ok && data.success) {
        setStats(data.stats);
      } else {
        setError(data.message || 'İstatistikler alınamadı.');
      }
    } catch (err) {
      setError(err.message || 'Worker bağlantı hatası.');
    } finally {
      setLoading(false);
    }
  }, [user, workerUrl]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const formatDate = (timestamp) => {
    if (!timestamp) return '—';
    try {
      const date = new Date(timestamp);
      return new Intl.DateTimeFormat('tr-TR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(date);
    } catch {
      return '—';
    }
  };

  const getActiveRate = (active, total) => {
    if (!total || total === 0) return 0;
    return Math.round((active / total) * 100);
  };

  return (
    <div className="admin-stats-container">
      {/* Başlık */}
      <div className="stats-page-header">
        <div>
          <h1 className="page-title">Genel İstatistikler</h1>
          <p className="page-subtitle">
            J-Planning platformu kullanıcı metrikleri ve sistem durumu
          </p>
        </div>
        <button
          onClick={fetchStats}
          className="admin-action-btn"
          disabled={loading}
          title="İstatistikleri Yenile"
        >
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
          <span>Yenile</span>
        </button>
      </div>

      {/* Bilgilendirme Notu: Sayaçların Durumu */}
      <div className="notice-banner">
        <Info size={18} className="notice-icon" />
        <div className="notice-text">
          <strong>Önemli Bilgilendirme:</strong> Toplam Görev ve JP Bakiyesi sayaçları şu an Control
          Plane üzerindeki meta tabanından okunmaktadır. Faz 3 ile birlikte kullanıcı bazlı Turso
          veritabanlarına bağlanılarak bu sayaçlar gerçek zamanlı olarak eşitlenecektir.
        </div>
      </div>

      {/* Yükleniyor / Hata Durumları */}
      {loading && (
        <div className="stats-grid">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="stat-card skeleton-stat" />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="stats-error-box">
          <p>{error}</p>
          <button onClick={fetchStats} className="admin-retry-btn">
            Tekrar Dene
          </button>
        </div>
      )}

      {/* İstatistik Kartları Grid */}
      {!loading && !error && stats && (
        <>
          <div className="stats-grid">
            {/* Toplam Kullanıcı */}
            <div className="stat-card primary">
              <div className="stat-header">
                <span className="stat-label">Toplam Kayıtlı Kullanıcı</span>
                <div className="stat-icon-badge blue">
                  <Users size={20} />
                </div>
              </div>
              <div className="stat-number">{stats.totalUsers.toLocaleString('tr-TR')}</div>
              <div className="stat-footer">
                <TrendingUp size={14} color="#10B981" />
                <span>Platform geneli aktif dizin</span>
              </div>
            </div>

            {/* 7 Günlük Aktif Kullanıcı */}
            <div className="stat-card">
              <div className="stat-header">
                <span className="stat-label">7 Günlük Aktif Kullanıcı</span>
                <div className="stat-icon-badge green">
                  <UserCheck size={20} />
                </div>
              </div>
              <div className="stat-number">{stats.active7d.toLocaleString('tr-TR')}</div>
              <div className="stat-footer">
                <span className="rate-badge">
                  %{getActiveRate(stats.active7d, stats.totalUsers)} Aktiflik Oranı
                </span>
              </div>
            </div>

            {/* 30 Günlük Aktif Kullanıcı */}
            <div className="stat-card">
              <div className="stat-header">
                <span className="stat-label">30 Günlük Aktif Kullanıcı</span>
                <div className="stat-icon-badge purple">
                  <Calendar size={20} />
                </div>
              </div>
              <div className="stat-number">{stats.active30d.toLocaleString('tr-TR')}</div>
              <div className="stat-footer">
                <span className="rate-badge">
                  %{getActiveRate(stats.active30d, stats.totalUsers)} Aylık Etkileşim
                </span>
              </div>
            </div>

            {/* Toplam Görev Sayısı */}
            <div className="stat-card">
              <div className="stat-header">
                <span className="stat-label">Toplam Görev Sayısı</span>
                <div className="stat-icon-badge amber">
                  <CheckSquare size={20} />
                </div>
              </div>
              <div className="stat-number">{stats.totalTasks.toLocaleString('tr-TR')}</div>
              <div className="stat-footer">
                <span className="sync-note-badge">Özet Sayaç (Faz 3 Senkronu)</span>
              </div>
            </div>

            {/* Toplam JP Bakiyesi */}
            <div className="stat-card">
              <div className="stat-header">
                <span className="stat-label">Toplam JP Havuzu</span>
                <div className="stat-icon-badge gold">
                  <Coins size={20} />
                </div>
              </div>
              <div className="stat-number">{stats.totalJP.toLocaleString('tr-TR')} JP</div>
              <div className="stat-footer">
                <span className="sync-note-badge">Özet Sayaç (Faz 3 Senkronu)</span>
              </div>
            </div>

            {/* Pasif / Devre Dışı Kullanıcı */}
            <div className="stat-card">
              <div className="stat-header">
                <span className="stat-label">Devre Dışı Kullanıcılar</span>
                <div className="stat-icon-badge red">
                  <ShieldAlert size={20} />
                </div>
              </div>
              <div className="stat-number">{stats.disabledUsers.toLocaleString('tr-TR')}</div>
              <div className="stat-footer text-muted">
                <span>Erişimi kısıtlanan hesaplar</span>
              </div>
            </div>
          </div>

          {/* Sistem & Altyapı Durumu Kartı */}
          <div className="system-status-card">
            <div className="sys-header">
              <div className="sys-icon">
                <Server size={20} color="#C98A2C" />
              </div>
              <div>
                <h3>Sistem & Altyapı Durumu</h3>
                <p>J-Planning Web ve Cloudflare Worker servis göstergeleri</p>
              </div>
            </div>

            <div className="sys-grid">
              <div className="sys-item">
                <span className="sys-label">Control Plane DB:</span>
                <div className="sys-value-row">
                  <span className="status-dot online" />
                  <span className="font-mono">jplanning-control (Turso SQLite)</span>
                </div>
              </div>

              <div className="sys-item">
                <span className="sys-label">Kullanıcı İzolasyonu:</span>
                <div className="sys-value-row">
                  <span className="status-dot online" />
                  <span>Kullanıcı Başına İzole DB (Aktif)</span>
                </div>
              </div>

              <div className="sys-item">
                <span className="sys-label">Yetkilendirme Motoru:</span>
                <div className="sys-value-row">
                  <span className="status-dot online" />
                  <span>Firebase Custom Claims (admin: true)</span>
                </div>
              </div>

              <div className="sys-item">
                <span className="sys-label">Son Sunucu Yanıtı:</span>
                <div className="sys-value-row">
                  <Activity size={14} color="#64748b" />
                  <span>{formatDate(stats.serverTimestamp)}</span>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
