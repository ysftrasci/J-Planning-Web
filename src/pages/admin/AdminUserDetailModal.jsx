// J-Planning — Admin Kullanıcı Detay Modalı (Faz 3 Salt Okunur)
import { useState, useEffect, useCallback } from 'react';
import {
  X,
  User,
  Database,
  Calendar,
  CheckCircle2,
  XCircle,
  ShieldAlert,
  Coins,
  ListTodo,
  Gift,
  FolderTree,
  RefreshCw,
  AlertTriangle,
  Clock,
  Sparkles,
  Lock,
  Unlock,
} from 'lucide-react';
import { auth } from '../../services/firebase';
import './AdminUserDetailModal.css';

export default function AdminUserDetailModal({ userMeta, onClose, onUserStatusChanged }) {
  const [activeTab, setActiveTab] = useState('tasks');
  const [loading, setLoading] = useState(true);
  const [detailData, setDetailData] = useState(null);
  const [error, setError] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);

  const workerUrl = import.meta.env.VITE_WORKER_URL || 'https://jplanning-auth-worker.ysftrasci.workers.dev';

  const fetchUserDetail = useCallback(async () => {
    if (!userMeta?.uid) return;
    setLoading(true);
    setError(null);

    try {
      const activeUser = auth.currentUser;
      const idToken = typeof activeUser?.getIdToken === 'function' ? await activeUser.getIdToken() : null;
      if (!idToken) throw new Error('Oturum tokenı alınamadı.');

      const res = await fetch(`${workerUrl}/admin/users/${encodeURIComponent(userMeta.uid)}/detail`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setDetailData(data);
      } else {
        setError(data.message || 'Kullanıcı detayları getirilemedi.');
      }
    } catch (err) {
      setError(err.message || 'Worker bağlantı hatası.');
    } finally {
      setLoading(false);
    }
  }, [userMeta?.uid, workerUrl]);

  useEffect(() => {
    fetchUserDetail();
  }, [fetchUserDetail]);

  const handleToggleStatus = async () => {
    const currentDisabled = Boolean(detailData?.user?.is_disabled ?? userMeta?.is_disabled);
    const newDisabled = !currentDisabled;

    const confirmText = newDisabled
      ? `Bu kullanıcıyı askıya almak istediğinize emin misiniz? Kullanıcı yeni oturum açamayacaktır.`
      : `Bu kullanıcının hesabını yeniden aktifleştirmek istediğinize emin misiniz?`;

    if (!window.confirm(confirmText)) return;

    setActionLoading(true);
    setStatusMessage(null);

    try {
      const activeUser = auth.currentUser;
      const idToken = typeof activeUser?.getIdToken === 'function' ? await activeUser.getIdToken() : null;
      if (!idToken) throw new Error('Oturum tokenı alınamadı.');

      const res = await fetch(`${workerUrl}/admin/users/${encodeURIComponent(userMeta.uid)}/status`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ isDisabled: newDisabled }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setStatusMessage({
          type: 'success',
          text: data.message || (newDisabled ? 'Hesap askıya alındı.' : 'Hesap aktifleştirildi.'),
        });
        setDetailData((prev) =>
          prev
            ? {
                ...prev,
                user: {
                  ...prev.user,
                  is_disabled: newDisabled ? 1 : 0,
                },
              }
            : prev
        );
        if (onUserStatusChanged) {
          onUserStatusChanged(userMeta.uid, newDisabled ? 1 : 0);
        }
      } else {
        setStatusMessage({ type: 'error', text: data.message || 'Durum güncellenemedi.' });
      }
    } catch (err) {
      setStatusMessage({ type: 'error', text: err.message || 'İşlem başarısız oldu.' });
    } finally {
      setActionLoading(false);
    }
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return '—';
    try {
      return new Date(Number(timestamp)).toLocaleString('tr-TR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '—';
    }
  };

  const currentUserState = detailData?.user || userMeta;
  const isDisabled = Boolean(currentUserState?.is_disabled);

  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal-container" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="admin-modal-header">
          <div className="admin-modal-user-info">
            <div className="admin-modal-avatar">
              <User size={26} />
            </div>
            <div>
              <div className="admin-modal-title-row">
                <h2>{currentUserState?.display_name || currentUserState?.email || 'İsimsiz Kullanıcı'}</h2>
                <span className={`admin-modal-status-badge ${isDisabled ? 'disabled' : 'active'}`}>
                  {isDisabled ? (
                    <>
                      <XCircle size={14} /> Askıya Alındı
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={14} /> Aktif Hesap
                    </>
                  )}
                </span>
              </div>
              <div className="admin-modal-meta-row">
                <span title="E-posta">{currentUserState?.email || 'E-posta Yok'}</span>
                <span className="dot-sep">•</span>
                <span title="UID" className="admin-mono-text">UID: {userMeta.uid}</span>
                <span className="dot-sep">•</span>
                <span title="Veritabanı" className="admin-mono-text db-tag">
                  <Database size={12} /> {currentUserState?.db_name}
                </span>
              </div>
            </div>
          </div>

          <div className="admin-modal-header-actions">
            <button
              type="button"
              className={`admin-status-toggle-btn ${isDisabled ? 'btn-activate' : 'btn-suspend'}`}
              onClick={handleToggleStatus}
              disabled={actionLoading}
              title={isDisabled ? 'Hesabı Tekrar Aktif Et' : 'Hesabı Geçici Olarak Askıya Al'}
            >
              {isDisabled ? <Unlock size={15} /> : <Lock size={15} />}
              {actionLoading ? 'İşleniyor...' : isDisabled ? 'Hesabı Aktifleştir' : 'Hesabı Askıya Al'}
            </button>
            <button type="button" className="admin-modal-close-btn" onClick={onClose} title="Kapat">
              <X size={20} />
            </button>
          </div>
        </div>

        {statusMessage && (
          <div className={`admin-modal-alert-box ${statusMessage.type}`}>
            {statusMessage.type === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            <span>{statusMessage.text}</span>
          </div>
        )}

        {/* Modal Stats Bar */}
        <div className="admin-modal-summary-bar">
          <div className="summary-item">
            <Coins size={18} className="icon-jp" />
            <div>
              <div className="summary-val">{detailData?.wallet?.balance ?? currentUserState?.jp_balance ?? 0} JP</div>
              <div className="summary-lbl">Cüzdan Bakiyesi</div>
            </div>
          </div>
          <div className="summary-item">
            <ListTodo size={18} className="icon-tasks" />
            <div>
              <div className="summary-val">{detailData?.summary?.totalTasks ?? currentUserState?.task_count ?? 0}</div>
              <div className="summary-lbl">Toplam Görev</div>
            </div>
          </div>
          <div className="summary-item">
            <Gift size={18} className="icon-rewards" />
            <div>
              <div className="summary-val">{detailData?.summary?.rewardCount ?? detailData?.rewards?.length ?? 0}</div>
              <div className="summary-lbl">Kayıtlı Ödül</div>
            </div>
          </div>
          <div className="summary-item">
            <Calendar size={18} className="icon-time" />
            <div>
              <div className="summary-val">{formatDate(currentUserState?.last_login_at)}</div>
              <div className="summary-lbl">Son Giriş</div>
            </div>
          </div>
        </div>

        {/* Modal Tabs */}
        <div className="admin-modal-tabs">
          <button
            type="button"
            className={`admin-modal-tab ${activeTab === 'tasks' ? 'active' : ''}`}
            onClick={() => setActiveTab('tasks')}
          >
            <ListTodo size={16} />
            <span>Görevler ({detailData?.tasks?.length || 0})</span>
          </button>
          <button
            type="button"
            className={`admin-modal-tab ${activeTab === 'rewards' ? 'active' : ''}`}
            onClick={() => setActiveTab('rewards')}
          >
            <Gift size={16} />
            <span>Ödüller ({detailData?.rewards?.length || 0})</span>
          </button>
          <button
            type="button"
            className={`admin-modal-tab ${activeTab === 'categories' ? 'active' : ''}`}
            onClick={() => setActiveTab('categories')}
          >
            <FolderTree size={16} />
            <span>Kategoriler ({detailData?.categories?.length || 0})</span>
          </button>
        </div>

        {/* Modal Body Content */}
        <div className="admin-modal-body">
          {loading ? (
            <div className="admin-modal-loading">
              <RefreshCw className="spin" size={32} />
              <p>Kullanıcının izole Turso veritabanına bağlanılıyor ve veriler çekiliyor...</p>
            </div>
          ) : error ? (
            <div className="admin-modal-error">
              <AlertTriangle size={32} />
              <p>{error}</p>
              <button type="button" onClick={fetchUserDetail} className="admin-retry-btn">
                Tekrar Dene
              </button>
            </div>
          ) : (
            <>
              {/* TAB 1: GÖREVLER */}
              {activeTab === 'tasks' && (
                <div className="modal-tab-content">
                  {detailData?.tasks?.length === 0 ? (
                    <div className="admin-empty-tab">
                      <ListTodo size={40} />
                      <p>Kullanıcıya ait henüz oluşturulmuş görev bulunmuyor.</p>
                    </div>
                  ) : (
                    <div className="admin-detail-table-wrapper">
                      <table className="admin-detail-table">
                        <thead>
                          <tr>
                            <th>Başlık</th>
                            <th>Periyot</th>
                            <th>Öncelik</th>
                            <th>Alt Görev</th>
                            <th>Durum</th>
                            <th>Oluşturulma</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detailData.tasks.map((task) => (
                            <tr key={task.id}>
                              <td className="task-title-cell">
                                <div className="task-title">{task.title}</div>
                                {task.notes && <div className="task-subtext">{task.notes}</div>}
                              </td>
                              <td>
                                <span className="admin-badge period-badge">{task.period || 'DAILY'}</span>
                              </td>
                              <td>
                                <span className={`admin-badge priority-badge ${task.priority?.toLowerCase() || 'medium'}`}>
                                  {task.priority || 'MEDIUM'}
                                </span>
                              </td>
                              <td>{task.subtaskCount || 1} Adım</td>
                              <td>
                                {task.isArchived ? (
                                  <span className="admin-badge archived-badge">Arşivli</span>
                                ) : (
                                  <span className="admin-badge active-task-badge">Aktif</span>
                                )}
                              </td>
                              <td className="date-cell">{formatDate(task.createdAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: ÖDÜLLER */}
              {activeTab === 'rewards' && (
                <div className="modal-tab-content">
                  {detailData?.rewards?.length === 0 ? (
                    <div className="admin-empty-tab">
                      <Gift size={40} />
                      <p>Kullanıcıya ait henüz tanımlanmış ödül bulunmuyor.</p>
                    </div>
                  ) : (
                    <div className="admin-detail-table-wrapper">
                      <table className="admin-detail-table">
                        <thead>
                          <tr>
                            <th>Ödül Başlığı</th>
                            <th>Maliyet</th>
                            <th>Durum</th>
                            <th>Alınma Zamanı</th>
                            <th>Oluşturulma</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detailData.rewards.map((reward) => (
                            <tr key={reward.id}>
                              <td className="task-title-cell">
                                <div className="task-title">{reward.title}</div>
                                {reward.description && <div className="task-subtext">{reward.description}</div>}
                              </td>
                              <td>
                                <span className="admin-jp-pill">{reward.cost} JP</span>
                              </td>
                              <td>
                                {reward.isRedeemed ? (
                                  <span className="admin-badge redeemed-badge">Kullanıldı</span>
                                ) : (
                                  <span className="admin-badge active-task-badge">Hazır</span>
                                )}
                              </td>
                              <td className="date-cell">{formatDate(reward.redeemedAt)}</td>
                              <td className="date-cell">{formatDate(reward.createdAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: KATEGORİLER */}
              {activeTab === 'categories' && (
                <div className="modal-tab-content">
                  {detailData?.categories?.length === 0 ? (
                    <div className="admin-empty-tab">
                      <FolderTree size={40} />
                      <p>Kullanıcıya ait özel kategori bulunmuyor.</p>
                    </div>
                  ) : (
                    <div className="admin-categories-grid">
                      {detailData.categories.map((cat) => (
                        <div key={cat.id} className="admin-category-card">
                          <div className="cat-color-dot" style={{ backgroundColor: cat.color || '#6366f1' }} />
                          <div>
                            <div className="cat-name">{cat.name}</div>
                            <div className="cat-date">{formatDate(cat.createdAt)}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="admin-modal-footer">
          <div className="admin-modal-footer-notice">
            <Sparkles size={14} />
            <span>Veriler kullanıcının izole Turso DB'sinden salt okunur olarak çekilmiştir.</span>
          </div>
          <button type="button" className="admin-modal-close-btn-bottom" onClick={onClose}>
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
}
