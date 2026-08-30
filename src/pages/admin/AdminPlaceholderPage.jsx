// J-Planning — Admin Paneli Placeholder Sayfası (Faz 1)
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, Activity, Users, Database, ArrowLeft, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { auth } from '../../services/firebase';
import './AdminPlaceholderPage.css';

export default function AdminPlaceholderPage() {
  const { user, isAdmin, refreshAdminStatus } = useAuth();
  const [pingStatus, setPingStatus] = useState({ loading: false, data: null, error: null });
  const [isRefreshing, setIsRefreshing] = useState(false);

  const workerUrl = import.meta.env.VITE_WORKER_URL || 'https://jplanning-auth-worker.ysftrasci.workers.dev';

  const testAdminPing = async () => {
    if (!user) return;
    setPingStatus({ loading: true, data: null, error: null });

    try {
      const activeUser = auth.currentUser || user;
      const idToken = typeof activeUser.getIdToken === 'function' 
        ? await activeUser.getIdToken() 
        : await user?.getIdToken?.();

      if (!idToken) {
        throw new Error('Kullanıcı oturum tokenı alınamadı.');
      }
      const response = await fetch(`${workerUrl}/admin/ping`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();
      if (response.ok && data.success) {
        setPingStatus({ loading: false, data, error: null });
      } else {
        setPingStatus({
          loading: false,
          data: null,
          error: data.message || `Sunucu Hatası (${response.status})`,
        });
      }
    } catch (err) {
      setPingStatus({
        loading: false,
        data: null,
        error: err.message || 'Worker endpoint\'ine erişilemedi.',
      });
    }
  };

  useEffect(() => {
    testAdminPing();
  }, [user]);

  const handleRefreshClaim = async () => {
    setIsRefreshing(true);
    await refreshAdminStatus();
    await testAdminPing();
    setIsRefreshing(false);
  };

  return (
    <div className="admin-placeholder-container">
      {/* Üst Başlık & Navigasyon */}
      <header className="admin-header">
        <div className="admin-header-left">
          <Link to="/" className="admin-back-link">
            <ArrowLeft size={18} />
            <span>Ana Uygulamaya Dön</span>
          </Link>
          <div className="admin-title-row">
            <div className="admin-badge-icon">
              <ShieldCheck size={26} color="#C98A2C" />
            </div>
            <div>
              <h1 className="admin-main-title">Yönetici Kontrol Merkezi</h1>
              <p className="admin-subtitle">J-Planning Control Plane & Yönetim Arayüzü</p>
            </div>
          </div>
        </div>

        <div className="admin-header-right">
          <span className="admin-pill-status">
            <span className="status-dot"></span>
            Faz 1: Altyapı Aktif
          </span>
        </div>
      </header>

      {/* Ana Kart Grid */}
      <div className="admin-grid">
        {/* Güvenlik & Yetki Durumu Kartı */}
        <section className="admin-card">
          <div className="admin-card-header">
            <div className="admin-card-icon auth-icon">
              <ShieldCheck size={20} />
            </div>
            <h3>Kimlik & Yetkilendirme</h3>
          </div>

          <div className="admin-info-list">
            <div className="admin-info-item">
              <span className="info-label">Giriş Yapan E-posta:</span>
              <span className="info-value font-mono">{user?.email || 'Bilinmiyor'}</span>
            </div>
            <div className="admin-info-item">
              <span className="info-label">Firebase UID:</span>
              <span className="info-value font-mono text-muted">{user?.uid || '—'}</span>
            </div>
            <div className="admin-info-item">
              <span className="info-label">Admin Claim Durumu:</span>
              <span className={`claim-tag ${isAdmin ? 'active' : 'inactive'}`}>
                {isAdmin ? 'admin: true' : 'admin: false (Yetkisiz)'}
              </span>
            </div>
          </div>

          <div className="admin-card-actions">
            <button
              onClick={handleRefreshClaim}
              disabled={isRefreshing}
              className="admin-btn secondary"
            >
              <RefreshCw size={15} className={isRefreshing ? 'spin' : ''} />
              <span>Token & Claim Yenile</span>
            </button>
          </div>
        </section>

        {/* Worker & Control Plane API Bağlantı Testi */}
        <section className="admin-card">
          <div className="admin-card-header">
            <div className="admin-card-icon worker-icon">
              <Activity size={20} />
            </div>
            <h3>Worker /admin/ping Testi</h3>
          </div>

          <div className="admin-ping-content">
            {pingStatus.loading && (
              <div className="ping-state loading">
                <RefreshCw size={18} className="spin" />
                <span>Worker endpoint doğrulanıyor...</span>
              </div>
            )}

            {!pingStatus.loading && pingStatus.data && (
              <div className="ping-state success">
                <CheckCircle2 size={20} color="#10B981" />
                <div>
                  <div className="ping-title">Bağlantı Başarılı & Yetki Doğrulandı</div>
                  <div className="ping-desc font-mono">
                    {pingStatus.data.message} ({pingStatus.data.service})
                  </div>
                </div>
              </div>
            )}

            {!pingStatus.loading && pingStatus.error && (
              <div className="ping-state error">
                <AlertCircle size={20} color="#EF4444" />
                <div>
                  <div className="ping-title">Yetkilendirme / Bağlantı Uyarısı</div>
                  <div className="ping-desc">{pingStatus.error}</div>
                </div>
              </div>
            )}
          </div>

          <div className="admin-card-actions">
            <button
              onClick={testAdminPing}
              disabled={pingStatus.loading}
              className="admin-btn primary"
            >
              <Activity size={15} />
              <span>Ping Yeniden Gönder</span>
            </button>
          </div>
        </section>
      </div>

      {/* Yol Haritası İlerleme Paneli */}
      <section className="admin-roadmap-card">
        <h3>Geliştirme Yol Haritası</h3>
        <div className="roadmap-timeline">
          <div className="roadmap-step completed">
            <div className="step-number">1</div>
            <div className="step-details">
              <h4>Faz 1: Temel Altyapı & Yetkilendirme</h4>
              <p>Control plane şeması, custom claims doğrulama, /admin/ping ve route guard tamamlandı.</p>
            </div>
            <span className="step-tag done">Tamamlandı</span>
          </div>

          <div className="roadmap-step next">
            <div className="step-number">2</div>
            <div className="step-details">
              <h4>Faz 2: Kullanıcı Listesi & İstatistikler</h4>
              <p>Sayfalanmış kullanıcı tablosu, arama filtreleri ve genel kullanım metrikleri eklenecek.</p>
            </div>
            <span className="step-tag upcoming">Sırada</span>
          </div>

          <div className="roadmap-step">
            <div className="step-number">3</div>
            <div className="step-details">
              <h4>Faz 3: Kullanıcı Detayı & Salt Okunur Veri</h4>
              <p>Kullanıcı DB'sine bağlanıp görev ve ödül geçmişini inceleme, devre dışı bırakma.</p>
            </div>
            <span className="step-tag pending">Planlandı</span>
          </div>

          <div className="roadmap-step">
            <div className="step-number">4</div>
            <div className="step-details">
              <h4>Faz 4: Düzenleme Yetkisi & Audit Log</h4>
              <p>Görev düzeltme, JP bakiye müdahalesi ve tam kayıt tutma (denetim izi).</p>
            </div>
            <span className="step-tag pending">Planlandı</span>
          </div>
        </div>
      </section>
    </div>
  );
}
