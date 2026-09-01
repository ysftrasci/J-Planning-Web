// J-Planning — Admin Kullanıcı Detay ve Düzenleme Modalı (Faz 3 + Faz 4)
import { useState, useEffect, useCallback } from 'react';
import {
  X,
  User,
  Database,
  Calendar,
  CheckCircle2,
  XCircle,
  Coins,
  ListTodo,
  Gift,
  FolderTree,
  RefreshCw,
  AlertTriangle,
  Lock,
  Unlock,
  Edit3,
  Check,
  Save,
  Clock,
  Sparkles,
} from 'lucide-react';
import { auth, db } from '../../services/firebase';
import { doc, setDoc } from 'firebase/firestore';
import './AdminUserDetailModal.css';

export default function AdminUserDetailModal({ userMeta, onClose, onUserStatusChanged }) {
  const [activeTab, setActiveTab] = useState('tasks');
  const [loading, setLoading] = useState(true);
  const [detailData, setDetailData] = useState(null);
  const [error, setError] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);

  // Düzenleme Durumları (Faz 4)
  const [editingTask, setEditingTask] = useState(null); // Düzenlenen görev objesi
  const [editingReward, setEditingReward] = useState(null); // Düzenlenen ödül objesi
  const [editingWallet, setEditingWallet] = useState(false); // Cüzdan modalı açık mı
  const [walletForm, setWalletForm] = useState({ balance: '', reason: '' });
  const [saveLoading, setSaveLoading] = useState(false);

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
        setWalletForm({ balance: data.wallet?.balance ?? 0, reason: '' });
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

  // Durum Değiştir (Askıya Al / Aktifleştir)
  const handleToggleStatus = async () => {
    const currentDisabled = Boolean(detailData?.user?.is_disabled ?? userMeta?.is_disabled);
    const newDisabled = !currentDisabled;

    const confirmText = newDisabled
      ? 'Bu kullanıcıyı askıya almak istediğinize emin misiniz? Kullanıcı yeni oturum açamayacaktır.'
      : 'Bu kullanıcının hesabını yeniden aktifleştirmek istediğinize emin misiniz?';

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
        // Firestore Sinyali: Askıya alma/aktifleştirme durumunu kullanıcıya anında ulaştır
        try {
          await setDoc(
            doc(db, 'users', userMeta.uid),
            {
              isDisabled: newDisabled,
              disabledAt: newDisabled ? Date.now() : null,
              updatedAt: Date.now(),
            },
            { merge: true }
          );
        } catch (fsErr) {
          console.warn('[AdminUserDetailModal Firestore Signal Warning]:', fsErr);
        }

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

  // Faz 4: Görev Güncelleme
  const handleSaveTask = async (e) => {
    e.preventDefault();
    if (!editingTask) return;

    setSaveLoading(true);
    setStatusMessage(null);

    try {
      const activeUser = auth.currentUser;
      const idToken = typeof activeUser?.getIdToken === 'function' ? await activeUser.getIdToken() : null;
      if (!idToken) throw new Error('Oturum tokenı alınamadı.');

      const res = await fetch(
        `${workerUrl}/admin/users/${encodeURIComponent(userMeta.uid)}/tasks/${encodeURIComponent(editingTask.id)}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${idToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title: editingTask.title,
            notes: editingTask.notes,
            priority: editingTask.priority,
            period: editingTask.period,
            isArchived: editingTask.isArchived ? 1 : 0,
          }),
        }
      );

      const data = await res.json();
      if (res.ok && data.success) {
        setStatusMessage({ type: 'success', text: 'Görev başarıyla güncellendi ve audit loga işlendi.' });
        setEditingTask(null);
        await fetchUserDetail();
      } else {
        setStatusMessage({ type: 'error', text: data.message || 'Görev güncellenemedi.' });
      }
    } catch (err) {
      setStatusMessage({ type: 'error', text: err.message || 'İstek başarısız oldu.' });
    } finally {
      setSaveLoading(false);
    }
  };

  // Faz 4: Cüzdan Bakiyesi Güncelleme (Çift Onay ve Zorunlu Gerekçe ile)
  const handleSaveWallet = async (e) => {
    e.preventDefault();
    const newBal = parseInt(walletForm.balance, 10);
    const reason = (walletForm.reason || '').trim();

    if (isNaN(newBal) || newBal < 0) {
      alert('Lütfen 0 veya daha büyük geçerli bir JP miktarı girin.');
      return;
    }
    if (reason.length < 3) {
      alert('Lütfen bakiye değişikliği için en az 3 karakterlik geçerli bir gerekçe yazın.');
      return;
    }

    if (!window.confirm(`Kullanıcının bakiyesi ${newBal} JP olarak ayarlanacak.\nGerekçe: "${reason}"\n\nOnaylıyor musunuz?`)) {
      return;
    }

    setSaveLoading(true);
    setStatusMessage(null);

    try {
      const activeUser = auth.currentUser;
      const idToken = typeof activeUser?.getIdToken === 'function' ? await activeUser.getIdToken() : null;
      if (!idToken) throw new Error('Oturum tokenı alınamadı.');

      const res = await fetch(`${workerUrl}/admin/users/${encodeURIComponent(userMeta.uid)}/wallet`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ balance: newBal, reason }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setStatusMessage({ type: 'success', text: 'Cüzdan bakiyesi güncellendi ve denetim kaydı oluşturuldu.' });
        setEditingWallet(false);
        await fetchUserDetail();
      } else {
        setStatusMessage({ type: 'error', text: data.message || 'Cüzdan güncellenemedi.' });
      }
    } catch (err) {
      setStatusMessage({ type: 'error', text: err.message || 'İstek başarısız oldu.' });
    } finally {
      setSaveLoading(false);
    }
  };

  // Faz 4: Ödül Güncelleme
  const handleSaveReward = async (e) => {
    e.preventDefault();
    if (!editingReward) return;

    setSaveLoading(true);
    setStatusMessage(null);

    try {
      const activeUser = auth.currentUser;
      const idToken = typeof activeUser?.getIdToken === 'function' ? await activeUser.getIdToken() : null;
      if (!idToken) throw new Error('Oturum tokenı alınamadı.');

      const res = await fetch(
        `${workerUrl}/admin/users/${encodeURIComponent(userMeta.uid)}/rewards/${encodeURIComponent(editingReward.id)}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${idToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title: editingReward.title,
            cost: parseInt(editingReward.cost, 10),
            isRedeemed: editingReward.isRedeemed ? 1 : 0,
          }),
        }
      );

      const data = await res.json();
      if (res.ok && data.success) {
        setStatusMessage({ type: 'success', text: 'Ödül başarıyla güncellendi.' });
        setEditingReward(null);
        await fetchUserDetail();
      } else {
        setStatusMessage({ type: 'error', text: data.message || 'Ödül güncellenemedi.' });
      }
    } catch (err) {
      setStatusMessage({ type: 'error', text: err.message || 'İşlem başarısız oldu.' });
    } finally {
      setSaveLoading(false);
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
              <div className="summary-val-row">
                <span className="summary-val">{detailData?.wallet?.balance ?? currentUserState?.jp_balance ?? 0} JP</span>
                <button
                  type="button"
                  className="admin-edit-mini-btn"
                  onClick={() => setEditingWallet(true)}
                  title="JP Bakiyesini Düzenle"
                >
                  <Edit3 size={13} />
                </button>
              </div>
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

        {/* Cüzdan Düzenleme Formu Açılır Kutusu */}
        {editingWallet && (
          <form className="admin-wallet-edit-box" onSubmit={handleSaveWallet}>
            <div className="wallet-edit-title">
              <Coins size={16} color="#f59e0b" />
              <strong>Cüzdan JP Bakiyesini Düzenle</strong>
            </div>
            <div className="wallet-edit-inputs">
              <div className="form-group">
                <label>Yeni JP Bakiyesi:</label>
                <input
                  type="number"
                  min="0"
                  value={walletForm.balance}
                  onChange={(e) => setWalletForm((p) => ({ ...p, balance: e.target.value }))}
                  required
                />
              </div>
              <div className="form-group flex-2">
                <label>Düzenleme Gerekçesi (Zorunlu):</label>
                <input
                  type="text"
                  placeholder="Örn: Destek talebi #102 bakiye düzeltmesi"
                  value={walletForm.reason}
                  onChange={(e) => setWalletForm((p) => ({ ...p, reason: e.target.value }))}
                  required
                />
              </div>
            </div>
            <div className="wallet-edit-actions">
              <button type="button" className="btn-cancel" onClick={() => setEditingWallet(false)}>
                İptal
              </button>
              <button type="submit" className="btn-save" disabled={saveLoading}>
                {saveLoading ? 'Kaydediliyor...' : 'Kaydet ve Logla'}
              </button>
            </div>
          </form>
        )}

        {/* Modal Tabs */}
        <div className="admin-modal-tabs">
          <button
            type="button"
            className={`admin-modal-tab ${activeTab === 'tasks' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('tasks');
              setEditingTask(null);
            }}
          >
            <ListTodo size={16} />
            <span>Görevler ({detailData?.tasks?.length || 0})</span>
          </button>
          <button
            type="button"
            className={`admin-modal-tab ${activeTab === 'rewards' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('rewards');
              setEditingReward(null);
            }}
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
              <p>Kullanıcının Turso veritabanına bağlanılıyor ve veriler çekiliyor...</p>
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
                  {editingTask ? (
                    <form className="admin-edit-form-card" onSubmit={handleSaveTask}>
                      <div className="edit-form-header">
                        <h3>Görevi Düzenle (ID: {editingTask.id})</h3>
                        <button type="button" className="btn-close-edit" onClick={() => setEditingTask(null)}>
                          <X size={16} />
                        </button>
                      </div>

                      {editingTask.assignmentDirection === 'RECEIVED' && (
                        <div className="admin-assigned-task-notice">
                          <AlertTriangle size={16} />
                          <div>
                            <strong>Atanan Görev Uyarısı:</strong> Bu görev kullanıcıya başka biri {editingTask.assignedByName ? `(${editingTask.assignedByName})` : ''} tarafından atanmıştır. Buradaki değişiklikler SQLite veritabanına kaydedilir ancak kullanıcının cihazındaki Firestore canlı senkronu tarafından orijinal haline geri döndürülebilir.
                          </div>
                        </div>
                      )}

                      <div className="edit-form-grid">
                        <div className="form-group full-width">
                          <label>Görev Başlığı:</label>
                          <input
                            type="text"
                            value={editingTask.title || ''}
                            onChange={(e) => setEditingTask((p) => ({ ...p, title: e.target.value }))}
                            required
                          />
                        </div>
                        <div className="form-group full-width">
                          <label>Açıklama / Notlar:</label>
                          <textarea
                            rows="2"
                            value={editingTask.notes || editingTask.description || ''}
                            onChange={(e) => setEditingTask((p) => ({ ...p, notes: e.target.value }))}
                          />
                        </div>
                        <div className="form-group">
                          <label>Öncelik:</label>
                          <select
                            value={editingTask.priority || 'MEDIUM'}
                            onChange={(e) => setEditingTask((p) => ({ ...p, priority: e.target.value }))}
                          >
                            <option value="HIGH">Yüksek (HIGH)</option>
                            <option value="MEDIUM">Orta (MEDIUM)</option>
                            <option value="LOW">Düşük (LOW)</option>
                            <option value="ZERO">Sıfır (ZERO)</option>
                          </select>
                        </div>
                        <div className="form-group">
                          <label>Periyot:</label>
                          <select
                            value={editingTask.period || 'DAILY'}
                            onChange={(e) => setEditingTask((p) => ({ ...p, period: e.target.value }))}
                          >
                            <option value="DAILY">Günlük (DAILY)</option>
                            <option value="WEEKLY">Haftalık (WEEKLY)</option>
                            <option value="MONTHLY">Aylık (MONTHLY)</option>
                            <option value="ONCE">Tek Seferlik (ONCE)</option>
                          </select>
                        </div>
                        <div className="form-group">
                          <label>Arşiv Durumu:</label>
                          <select
                            value={editingTask.isArchived ? '1' : '0'}
                            onChange={(e) => setEditingTask((p) => ({ ...p, isArchived: e.target.value === '1' }))}
                          >
                            <option value="0">Aktif</option>
                            <option value="1">Arşivlenmiş</option>
                          </select>
                        </div>
                      </div>
                      <div className="edit-form-footer">
                        <button type="button" className="btn-cancel" onClick={() => setEditingTask(null)}>
                          Vazgeç
                        </button>
                        <button type="submit" className="btn-save" disabled={saveLoading}>
                          {saveLoading ? 'Kaydediliyor...' : 'Değişiklikleri Kaydet'}
                        </button>
                      </div>
                    </form>
                  ) : detailData?.tasks?.length === 0 ? (
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
                            <th>Durum</th>
                            <th>Oluşturulma</th>
                            <th>İşlem</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detailData.tasks.map((task) => (
                            <tr key={task.id}>
                              <td className="task-title-cell">
                                <div className="task-title-row">
                                  <span className="task-title">{task.title}</span>
                                  {task.assignmentDirection === 'RECEIVED' && (
                                    <span className="admin-badge assigned-badge" title={task.assignedByName ? `Atayan: ${task.assignedByName}` : 'Atanan Görev'}>
                                      Atanan
                                    </span>
                                  )}
                                </div>
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
                              <td>
                                {task.isArchived ? (
                                  <span className="admin-badge archived-badge">Arşivli</span>
                                ) : (
                                  <span className="admin-badge active-task-badge">Aktif</span>
                                )}
                              </td>
                              <td className="date-cell">{formatDate(task.createdAt)}</td>
                              <td>
                                <button
                                  type="button"
                                  className={`admin-edit-row-btn ${task.assignmentDirection === 'RECEIVED' ? 'disabled-assigned' : ''}`}
                                  onClick={() => setEditingTask(task)}
                                  disabled={task.assignmentDirection === 'RECEIVED'}
                                  title={
                                    task.assignmentDirection === 'RECEIVED'
                                      ? 'Bu görev başka bir kullanıcı tarafından atanmıştır, buradan düzenlenemez'
                                      : 'Görevi Düzenle'
                                  }
                                >
                                  <Edit3 size={13} />
                                  <span>Düzenle</span>
                                </button>
                              </td>
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
                  {editingReward ? (
                    <form className="admin-edit-form-card" onSubmit={handleSaveReward}>
                      <div className="edit-form-header">
                        <h3>Ödülü Düzenle (ID: {editingReward.id})</h3>
                        <button type="button" className="btn-close-edit" onClick={() => setEditingReward(null)}>
                          <X size={16} />
                        </button>
                      </div>
                      <div className="edit-form-grid">
                        <div className="form-group full-width">
                          <label>Ödül Başlığı:</label>
                          <input
                            type="text"
                            value={editingReward.title || ''}
                            onChange={(e) => setEditingReward((p) => ({ ...p, title: e.target.value }))}
                            required
                          />
                        </div>
                        <div className="form-group">
                          <label>Maliyet (JP):</label>
                          <input
                            type="number"
                            min="0"
                            value={editingReward.cost ?? ''}
                            onChange={(e) => setEditingReward((p) => ({ ...p, cost: e.target.value }))}
                            required
                          />
                        </div>
                        <div className="form-group">
                          <label>Durum:</label>
                          <select
                            value={editingReward.isRedeemed ? '1' : '0'}
                            onChange={(e) => setEditingReward((p) => ({ ...p, isRedeemed: e.target.value === '1' }))}
                          >
                            <option value="0">Hazır (Kullanılmadı)</option>
                            <option value="1">Kullanıldı</option>
                          </select>
                        </div>
                      </div>
                      <div className="edit-form-footer">
                        <button type="button" className="btn-cancel" onClick={() => setEditingReward(null)}>
                          Vazgeç
                        </button>
                        <button type="submit" className="btn-save" disabled={saveLoading}>
                          {saveLoading ? 'Kaydediliyor...' : 'Ödülü Güncelle'}
                        </button>
                      </div>
                    </form>
                  ) : detailData?.rewards?.length === 0 ? (
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
                            <th>İşlem</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detailData.rewards.map((reward) => (
                            <tr key={reward.id}>
                              <td className="task-title-cell">
                                <div className="task-title">{reward.title}</div>
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
                              <td>
                                <button
                                  type="button"
                                  className="admin-edit-row-btn"
                                  onClick={() => setEditingReward(reward)}
                                  title="Ödülü Düzenle"
                                >
                                  <Edit3 size={13} />
                                  <span>Düzenle</span>
                                </button>
                              </td>
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
            <span>Tüm düzenleme işlemleri Control Plane üzerindeki değiştirilemez Audit Log'a işlenir.</span>
          </div>
          <button type="button" className="admin-modal-close-btn-bottom" onClick={onClose}>
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
}
