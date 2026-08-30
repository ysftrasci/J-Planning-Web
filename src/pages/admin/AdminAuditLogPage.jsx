// J-Planning — Admin Aktivite Geçmişi (Audit Log) Sayfası (Faz 4)
import { useState, useEffect, useCallback } from 'react';
import {
  ShieldAlert,
  Clock,
  User,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  AlertTriangle,
  Filter,
  CheckCircle2,
  XCircle,
  FileText,
  Coins,
  ListTodo,
  Gift,
  Lock,
} from 'lucide-react';
import { auth } from '../../services/firebase';
import './AdminAuditLogPage.css';

export default function AdminAuditLogPage() {
  const [logs, setLogs] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterAction, setFilterAction] = useState('');

  const workerUrl = import.meta.env.VITE_WORKER_URL || 'https://jplanning-auth-worker.ysftrasci.workers.dev';

  const fetchAuditLogs = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const activeUser = auth.currentUser;
      const idToken = typeof activeUser?.getIdToken === 'function' ? await activeUser.getIdToken() : null;
      if (!idToken) throw new Error('Oturum tokenı alınamadı.');

      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
      });

      if (filterAction) {
        params.set('action', filterAction);
      }

      const res = await fetch(`${workerUrl}/admin/audit-logs?${params.toString()}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setLogs(data.logs || []);
        setPagination(data.pagination);
      } else {
        setError(data.message || 'Audit log kayıtları getirilemedi.');
      }
    } catch (err) {
      setError(err.message || 'Worker bağlantı hatası.');
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.limit, filterAction, workerUrl]);

  useEffect(() => {
    fetchAuditLogs();
  }, [fetchAuditLogs]);

  const formatDate = (timestamp) => {
    if (!timestamp) return '—';
    try {
      return new Date(Number(timestamp)).toLocaleString('tr-TR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return '—';
    }
  };

  const getActionBadge = (action) => {
    switch (action) {
      case 'UPDATE_TASK':
        return (
          <span className="audit-action-badge action-task">
            <ListTodo size={13} /> Görev Güncelleme
          </span>
        );
      case 'UPDATE_WALLET':
        return (
          <span className="audit-action-badge action-wallet">
            <Coins size={13} /> Cüzdan / JP Değişikliği
          </span>
        );
      case 'UPDATE_REWARD':
        return (
          <span className="audit-action-badge action-reward">
            <Gift size={13} /> Ödül Güncelleme
          </span>
        );
      case 'TOGGLE_STATUS':
        return (
          <span className="audit-action-badge action-status">
            <Lock size={13} /> Durum (Askıya Alma)
          </span>
        );
      default:
        return <span className="audit-action-badge action-default">{action}</span>;
    }
  };

  const parseJsonSafe = (str) => {
    if (!str) return null;
    try {
      return JSON.parse(str);
    } catch {
      return str;
    }
  };

  const renderValueDiff = (oldValStr, newValStr) => {
    const oldObj = parseJsonSafe(oldValStr);
    const newObj = parseJsonSafe(newValStr);

    if (typeof oldObj === 'object' && typeof newObj === 'object' && oldObj && newObj) {
      const reason = newObj.reason;
      const allKeys = Array.from(new Set([...Object.keys(oldObj), ...Object.keys(newObj)]));
      const changedEntries = [];

      for (const key of allKeys) {
        if (key === 'id' || key === 'reason' || key === 'createdAt' || key === 'updatedAt' || key === 'updated_at') continue;
        const oVal = oldObj[key];
        const nVal = newObj[key];
        if (oVal !== undefined && nVal !== undefined && String(oVal) !== String(nVal)) {
          changedEntries.push({ key, old: oVal, new: nVal });
        } else if (oVal === undefined && nVal !== undefined) {
          changedEntries.push({ key, old: '—', new: nVal });
        }
      }

      const keyLabels = {
        title: 'Başlık',
        description: 'Açıklama',
        notes: 'Notlar',
        priority: 'Öncelik',
        period: 'Periyot',
        isArchived: 'Arşiv',
        balance: 'Bakiye (JP)',
        cost: 'Maliyet (JP)',
        isRedeemed: 'Kullanım',
        is_disabled: 'Hesap Durumu',
      };

      const formatVal = (k, v) => {
        if (k === 'isArchived') return v === 1 || v === true ? 'Arşivli' : 'Aktif';
        if (k === 'isRedeemed') return v === 1 || v === true ? 'Kullanıldı' : 'Hazır';
        if (k === 'is_disabled') return v === 1 || v === true ? 'Askıda' : 'Aktif';
        return String(v ?? '—');
      };

      return (
        <div className="diff-container font-mono">
          {reason && (
            <div className="diff-reason">
              <strong>Gerekçe:</strong> <em>"{reason}"</em>
            </div>
          )}
          {changedEntries.length > 0 ? (
            changedEntries.map(({ key, old, new: nVal }) => (
              <div key={key} className="diff-field-row">
                <span className="diff-field-name">{keyLabels[key] || key}:</span>
                <span className="diff-old">{formatVal(key, old)}</span>
                <span className="diff-arrow">➔</span>
                <span className="diff-new">{formatVal(key, nVal)}</span>
              </div>
            ))
          ) : (
            <div className="diff-row">
              <span className="diff-new">Kayıt güncellendi</span>
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="diff-container font-mono">
        <span className="diff-old">{String(oldValStr || '—')}</span>
        <span className="diff-arrow"> ➔ </span>
        <span className="diff-new">{String(newValStr || '—')}</span>
      </div>
    );
  };

  return (
    <div className="admin-audit-container">
      {/* Header */}
      <div className="admin-audit-header">
        <div>
          <h2>Aktivite Geçmişi & Audit Log</h2>
          <p className="admin-subtitle">
            Yöneticiler tarafından gerçekleştirilen tüm düzenleme ve müdahalelerin değiştirilemez denetim kayıtları.
          </p>
        </div>

        <div className="audit-header-actions">
          <div className="audit-filter-box">
            <Filter size={15} />
            <select
              value={filterAction}
              onChange={(e) => {
                setFilterAction(e.target.value);
                setPagination((p) => ({ ...p, page: 1 }));
              }}
            >
              <option value="">Tüm İşlemler</option>
              <option value="UPDATE_WALLET">Cüzdan / JP Düzenlemeleri</option>
              <option value="UPDATE_TASK">Görev Düzenlemeleri</option>
              <option value="UPDATE_REWARD">Ödül Düzenlemeleri</option>
              <option value="TOGGLE_STATUS">Hesap Askıya Alma</option>
            </select>
          </div>

          <button type="button" className="audit-refresh-btn" onClick={fetchAuditLogs} title="Yenile">
            <RefreshCw size={15} className={loading ? 'spin' : ''} />
            <span>Yenile</span>
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="audit-table-wrapper">
        {loading && (
          <div className="audit-loading-state">
            <RefreshCw className="spin" size={32} />
            <p>Denetim logları yükleniyor...</p>
          </div>
        )}

        {!loading && error && (
          <div className="audit-error-state">
            <AlertTriangle size={32} />
            <p>{error}</p>
            <button type="button" onClick={fetchAuditLogs} className="admin-retry-btn">
              Tekrar Dene
            </button>
          </div>
        )}

        {!loading && !error && logs.length === 0 && (
          <div className="audit-empty-state">
            <FileText size={40} color="#9ca3af" />
            <h3>Henüz Audit Log Kaydı Bulunmuyor</h3>
            <p>Yöneticiler tarafından yapılan tüm düzenleme ve değişiklikler burada listelenecektir.</p>
          </div>
        )}

        {!loading && !error && logs.length > 0 && (
          <table className="audit-table">
            <thead>
              <tr>
                <th className="col-date">Tarih / Saat</th>
                <th className="col-admin">Yönetici</th>
                <th className="col-target">Hedef Kullanıcı</th>
                <th className="col-action">İşlem Türü</th>
                <th className="col-diff">Değişiklik Detayı (Fark)</th>
                <th className="col-status">Durum</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td className="col-date">
                    <div className="audit-date-badge">
                      <Clock size={13} />
                      <span>{formatDate(log.created_at)}</span>
                    </div>
                  </td>
                  <td>
                    <div className="admin-user-tag font-mono">
                      <User size={13} />
                      <span>{log.admin_email || log.admin_uid}</span>
                    </div>
                  </td>
                  <td>
                    <span className="target-uid-tag font-mono">{log.target_user_uid}</span>
                  </td>
                  <td>{getActionBadge(log.action)}</td>
                  <td className="diff-cell">{renderValueDiff(log.old_value, log.new_value)}</td>
                  <td>
                    {log.status === 'SUCCESS' ? (
                      <span className="status-pill success">
                        <CheckCircle2 size={12} /> Başarılı
                      </span>
                    ) : (
                      <span className="status-pill failed" title={log.error_message || 'İşlem başarısız'}>
                        <XCircle size={12} /> Hata
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {!loading && !error && pagination.totalPages > 1 && (
        <div className="audit-pagination-bar">
          <div className="pagination-info">
            Toplam <strong>{pagination.total}</strong> denetim kaydından{' '}
            <strong>{(pagination.page - 1) * pagination.limit + 1}</strong> -{' '}
            <strong>{Math.min(pagination.page * pagination.limit, pagination.total)}</strong> arası gösteriliyor
          </div>

          <div className="pagination-buttons">
            <button
              type="button"
              onClick={() => setPagination((p) => ({ ...p, page: p.page - 1 }))}
              disabled={pagination.page <= 1}
              className="pagination-nav-btn"
            >
              <ChevronLeft size={16} /> Önceki
            </button>
            <span className="page-indicator">
              Sayfa {pagination.page} / {pagination.totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPagination((p) => ({ ...p, page: p.page + 1 }))}
              disabled={pagination.page >= pagination.totalPages}
              className="pagination-nav-btn"
            >
              Sonraki <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
