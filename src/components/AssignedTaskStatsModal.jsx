// J-Planning — Attıklarım: arkadaşın bu görevdeki ilerlemesi
// Veri Worker'dan gelir (yalnızca görevi atayan kişi görebilir): periyot ayarı ve dönem
// kayıtları. Seri ve oran, görev detay sayfasındaki fonksiyonlarla burada hesaplanır.
import { useEffect, useState } from 'react';
import { Flame, Trophy, PieChart, CalendarDays } from 'lucide-react';
import AppModal from './AppModal.jsx';
import AppButton from './AppButton.jsx';
import { getAssignedTaskStats } from '../services/taskAssignmentService';
import {
  calculateCurrentStreak,
  calculateMaxStreak,
  calculateCompletionStats,
  calculateRecentSummary,
} from '../utils/streak';
import { periodLabel } from '../utils/period';
import './AssignedTaskStatsModal.css';

const HISTORY_LIMIT = 30;

function formatDate(periodKey) {
  if (!periodKey || periodKey === 'ONCE') return 'Tek seferlik';
  const [y, m, d] = String(periodKey).split('-').map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function statusText(record, subtaskCount) {
  const done = Math.max(0, Math.min(subtaskCount, Math.round(Number(record.completedSubtasks) || 0)));
  if (record.status === 'SUCCESSFUL') return 'Tamamlandı';
  if (record.status === 'PENDING_PARTIAL') return `Devam ediyor (${done}/${subtaskCount})`;
  return subtaskCount > 1 ? `Başarısız (${done}/${subtaskCount} yapıldı)` : 'Yapılmadı';
}

export default function AssignedTaskStatsModal({ assignment, onClose }) {
  const [state, setState] = useState({ loading: true, error: '', data: null });

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, error: '', data: null });
    getAssignedTaskStats(assignment.id)
      .then((data) => {
        if (!cancelled) setState({ loading: false, error: '', data });
      })
      .catch((e) => {
        if (!cancelled) setState({ loading: false, error: e.message || 'İstatistik alınamadı.', data: null });
      });
    return () => {
      cancelled = true;
    };
  }, [assignment.id]);

  const friendName = assignment.assignedToName || 'Arkadaşın';
  const { loading, error, data } = state;

  let content;
  if (loading) {
    content = <p className="assigned-stats__info">Yükleniyor…</p>;
  } else if (error) {
    content = <p className="assigned-stats__error">{error}</p>;
  } else if (!data?.accepted) {
    content = <p className="assigned-stats__info">{friendName} bu görevi henüz kabul etmedi.</p>;
  } else if (!data.task) {
    content = (
      <p className="assigned-stats__info">
        {friendName} görevi kabul etti; ilk kayıt, uygulamayı açtığında oluşacak.
      </p>
    );
  } else {
    const task = data.task;
    const records = data.records || [];
    const subtaskCount = task.subtaskCount || 1;

    if (task.period === 'ONCE') {
      const done = records.some((r) => r.status === 'SUCCESSFUL');
      content = (
        <p className="assigned-stats__info">
          Tek seferlik görev: <strong>{done ? 'Tamamlandı' : 'Henüz tamamlanmadı'}</strong>
        </p>
      );
    } else {
      const currentStreak = calculateCurrentStreak(task, records);
      const maxStreak = calculateMaxStreak(task, records);
      const completion = calculateCompletionStats(records, subtaskCount);
      const recent = calculateRecentSummary(task, records);
      const history = records.slice(0, HISTORY_LIMIT);

      content = (
        <>
          <div className="assigned-stats__grid">
            <div className="assigned-stats__stat">
              <Flame size={16} className="assigned-stats__icon" />
              <span className="assigned-stats__value">{currentStreak}</span>
              <span className="assigned-stats__label">Güncel Seri</span>
            </div>
            <div className="assigned-stats__stat">
              <Trophy size={16} className="assigned-stats__icon" />
              <span className="assigned-stats__value">{maxStreak}</span>
              <span className="assigned-stats__label">En Uzun Seri</span>
            </div>
            <div className="assigned-stats__stat">
              <PieChart size={16} className="assigned-stats__icon" />
              <span className="assigned-stats__value">
                {completion.rate !== null ? `%${completion.rate}` : '—'}
              </span>
              <span className="assigned-stats__label">Tamamlanma Oranı</span>
            </div>
          </div>

          {recent.summaryText && (
            <p className="assigned-stats__summary">
              <CalendarDays size={14} /> {recent.summaryText}
            </p>
          )}

          {history.length === 0 ? (
            <p className="assigned-stats__info">Henüz geçmiş kaydı yok.</p>
          ) : (
            <div className="assigned-stats__history">
              {history.map((r) => (
                <div key={r.periodKey} className="assigned-stats__row">
                  <span
                    className={`assigned-stats__dot ${
                      r.status === 'SUCCESSFUL'
                        ? 'assigned-stats__dot--success'
                        : r.status === 'PENDING_PARTIAL'
                          ? 'assigned-stats__dot--partial'
                          : 'assigned-stats__dot--danger'
                    }`}
                  />
                  <span className="assigned-stats__date">{formatDate(r.periodKey)}</span>
                  <span className="assigned-stats__status">{statusText(r, subtaskCount)}</span>
                </div>
              ))}
              {records.length > HISTORY_LIMIT && (
                <p className="assigned-stats__info">Son {HISTORY_LIMIT} dönem gösteriliyor.</p>
              )}
            </div>
          )}
        </>
      );
    }
  }

  return (
    <AppModal open onClose={onClose} title={assignment.title}>
      <p className="assigned-stats__subtitle">
        {friendName} • {periodLabel(assignment)}
      </p>
      {content}
      <AppButton title="Kapat" variant="secondary" onClick={onClose} style={{ marginTop: 'var(--space-lg)' }} />
    </AppModal>
  );
}
