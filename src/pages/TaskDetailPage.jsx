// J-Planning — Görev Detay Sayfası (Web)
// Mobildeki src/screens/TaskDetailScreen.js dosyasının web karşılığı.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  Info,
  Flame,
  Trophy,
  PieChart,
  Wallet,
  CalendarDays,
  Check,
} from 'lucide-react';
import { getDb } from '../db/database';
import { getTaskRecords, deleteTask, lateMarkTaskComplete, getSubtaskLabels, getTotalJPEarnedForTask } from '../db/taskRepository';
import { getPeriodEndTimestamp, isWithinLateMarkWindow, periodLabel } from '../utils/period';
import {
  calculateCurrentStreak,
  calculateMaxStreak,
  calculateCompletionStats,
  calculateRecentSummary,
} from '../utils/streak';
import AppButton from '../components/AppButton.jsx';
import AppModal from '../components/AppModal.jsx';
import EmptyState from '../components/EmptyState.jsx';
import './TaskDetailPage.css';

const PRIORITY_LABEL = { HIGH: 'Yüksek', MEDIUM: 'Orta', LOW: 'Düşük', EASY: 'Kolay', HARD: 'Zor' };

function monthKeyOf(dateStr) {
  return dateStr.slice(0, 7); // "2026-07-15" -> "2026-07"
}

function monthLabelOf(monthKey) {
  const d = new Date(`${monthKey}-01`);
  return d.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
}

function formatDate(dateInput) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function TaskDetailPage() {
  const { taskId } = useParams();
  const navigate = useNavigate();

  const [task, setTask] = useState(null);
  const [records, setRecords] = useState([]);
  const [totalJP, setTotalJP] = useState(0);
  const [selectedMonthKey, setSelectedMonthKey] = useState(null);
  const [recordToLateMark, setRecordToLateMark] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const load = useCallback(() => {
    const db = getDb();
    const t = db.getFirstSync('SELECT * FROM tasks WHERE id = ?', [taskId]);
    setTask(t);
    setRecords(getTaskRecords(taskId));
    setTotalJP(getTotalJPEarnedForTask(taskId));
  }, [taskId]);

  useEffect(load, [load]);

  // Kayıtları ay ay grupla — kullanıcı istediği ayı seçip sadece onu görebilsin.
  const availableMonths = useMemo(() => {
    const months = new Set(records.map((r) => monthKeyOf(r.periodKey)));
    return Array.from(months).sort().reverse(); // en yeni ay en başta
  }, [records]);

  const effectiveMonthKey = selectedMonthKey || availableMonths[0] || monthKeyOf(new Date().toISOString().slice(0, 10));

  const filteredRecords = useMemo(
    () => records.filter((r) => monthKeyOf(r.periodKey) === effectiveMonthKey),
    [records, effectiveMonthKey]
  );

  if (!task) return null;

  const currentStreak = calculateCurrentStreak(task, records);
  const maxStreak = calculateMaxStreak(task, records);
  const completionStats = calculateCompletionStats(records);
  const recentSummary = calculateRecentSummary(task, records);
  const isFriendAssigned = task.assignmentDirection === 'RECEIVED' && task.assignmentStatus === 'ACCEPTED';
  const isSent = task.assignmentDirection === 'SENT';
  const subtaskLabels = getSubtaskLabels(task);
  const subtaskCount = task.subtaskCount || 1;
  const startDateLabel = formatDate(task.createdAt);

  const currentMonthIndex = availableMonths.indexOf(effectiveMonthKey);
  const canGoOlder = currentMonthIndex < availableMonths.length - 1;
  const canGoNewer = currentMonthIndex > 0;

  const goOlderMonth = () => {
    if (canGoOlder) setSelectedMonthKey(availableMonths[currentMonthIndex + 1]);
  };
  const goNewerMonth = () => {
    if (canGoNewer) setSelectedMonthKey(availableMonths[currentMonthIndex - 1]);
  };

  const openLateMarkConfirm = (record) => {
    const periodEnd = getPeriodEndTimestamp(task.period, record.periodKey);
    if (!isWithinLateMarkWindow(periodEnd)) {
      setErrorMessage('Bu görev 30 günden eski olduğu için artık değiştirilemez.');
      return;
    }
    setRecordToLateMark(record);
  };

  const confirmLateMark = () => {
    if (!recordToLateMark) return;
    try {
      lateMarkTaskComplete(taskId, recordToLateMark.periodKey);
      setRecordToLateMark(null);
      load();
    } catch (e) {
      setErrorMessage(e.message);
      setRecordToLateMark(null);
    }
  };

  const confirmDelete = () => {
    deleteTask(taskId);
    navigate('/');
  };

  return (
    <div className="task-detail-page">
      <button type="button" className="task-detail-page__back" onClick={() => navigate('/')}>
        <ChevronLeft size={18} />
        Görevlerim
      </button>

      {errorMessage && <p className="task-detail-page__banner-error">{errorMessage}</p>}

      <h1>{task.title}</h1>
      <p className="caption task-detail-page__subtitle">
        {periodLabel(task.period)} görev • {PRIORITY_LABEL[task.priority]} öncelik
      </p>
      <p className="small task-detail-page__start-date">Başlangıç: {startDateLabel}</p>

      {isFriendAssigned && (
        <div className="task-detail-page__assigned-note">
          <Info size={16} />
          <span>
            Bu görevi {task.assignedByName} sana atadı. {task.assignedByName}, tamamlama durumunu görebilir.
          </span>
        </div>
      )}

      {isSent && (
        <div className="task-detail-page__assigned-note">
          <Info size={16} />
          <span>
            Bu görevi {task.assignedToName}'e attın. Tamamlama işlemi ona ait, sen sadece takip edersin.
          </span>
        </div>
      )}

      {subtaskCount > 1 && (
        <div className="task-detail-page__subtask-info">
          <p className="task-detail-page__subtask-info-title">Bu periyotta {subtaskCount} kez yapılmalı:</p>
          {subtaskLabels ? (
            subtaskLabels.map((label, i) => (
              <p key={i} className="task-detail-page__subtask-info-item">• {label || `${i + 1}. tekrar`}</p>
            ))
          ) : (
            <p className="task-detail-page__subtask-info-item">{subtaskCount} kez tamamlanması gerekiyor</p>
          )}
        </div>
      )}

      {task.period === 'ONCE' ? (
        <div className="task-detail-page__stats-grid">
          <Stat icon={Wallet} value={`${totalJP} JP`} label="Kazanılan JP" />
          <Stat
            icon={Check}
            value={completionStats.total > 0 && completionStats.successCount > 0 ? 'Tamamlandı' : 'Bekliyor'}
            label="Durum"
          />
        </div>
      ) : (
        <div className="task-detail-page__stats-grid">
          <Stat icon={Flame} value={currentStreak} label="Güncel Seri" />
          <Stat icon={Trophy} value={maxStreak} label="En Uzun Seri" />
          <Stat icon={PieChart} value={`%${completionStats.rate}`} label="Tamamlanma Oranı" />
          <Stat icon={Wallet} value={`${totalJP} JP`} label="Toplam Kazanılan" />
        </div>
      )}

      {task.period !== 'ONCE' && (
        <div className="task-detail-page__recent-summary">
          <CalendarDays size={16} />
          <span>
            Son {recentSummary.countedPeriods} {recentSummary.unitLabel}in {recentSummary.successCount} tanesinde tamamlandı
          </span>
        </div>
      )}

      {availableMonths.length > 0 && (
        <div className="task-detail-page__month-selector">
          <button type="button" onClick={goOlderMonth} disabled={!canGoOlder} aria-label="Önceki ay">
            <ChevronLeft size={20} />
          </button>
          <span className="task-detail-page__month-label">{monthLabelOf(effectiveMonthKey)}</span>
          <button type="button" onClick={goNewerMonth} disabled={!canGoNewer} aria-label="Sonraki ay">
            <ChevronRight size={20} />
          </button>
        </div>
      )}

      {filteredRecords.length === 0 ? (
        <EmptyState title="Bu ayda geçmiş kaydı yok" />
      ) : (
        <div className="task-detail-page__history-list">
          {filteredRecords.map((record) => (
            <HistoryRow key={record.id} record={record} task={task} onLateMark={() => openLateMarkConfirm(record)} />
          ))}
        </div>
      )}

      {!isFriendAssigned && (
        <div className="task-detail-page__footer">
          <AppButton title="Görevi Sil" variant="danger" onClick={() => setShowDeleteModal(true)} />
        </div>
      )}

      <AppModal open={!!recordToLateMark} onClose={() => setRecordToLateMark(null)} title="Geçmişe Dönük İşaretle">
        <p className="caption">
          {recordToLateMark && formatDate(recordToLateMark.periodKey)} tarihli görevi "Tamamlandı" olarak
          işaretlemek istediğine emin misin? Bu işlem serini yeniden hesaplayacak.
        </p>
        <div className="task-detail-page__modal-actions">
          <AppButton title="Vazgeç" variant="ghost" onClick={() => setRecordToLateMark(null)} />
          <AppButton title="Tamamlandı İşaretle" onClick={confirmLateMark} />
        </div>
      </AppModal>

      <AppModal open={showDeleteModal} onClose={() => setShowDeleteModal(false)} title="Görevi Sil">
        <p className="caption">Bu görevi silmek istediğine emin misin?</p>
        <div className="task-detail-page__modal-actions">
          <AppButton title="Vazgeç" variant="ghost" onClick={() => setShowDeleteModal(false)} />
          <AppButton title="Sil" variant="danger" onClick={confirmDelete} />
        </div>
      </AppModal>
    </div>
  );
}

function Stat({ icon: Icon, value, label }) {
  return (
    <div className="task-detail-page__stat">
      <Icon size={16} className="task-detail-page__stat-icon" />
      <span className="task-detail-page__stat-value">{value}</span>
      <span className="task-detail-page__stat-label">{label}</span>
    </div>
  );
}

function HistoryRow({ record, task, onLateMark }) {
  const isSuccess = record.status === 'SUCCESSFUL';
  const isPartial = record.status === 'PENDING_PARTIAL';
  const periodEnd = getPeriodEndTimestamp(task.period, record.periodKey);
  const canLateMark = !isSuccess && isWithinLateMarkWindow(periodEnd);
  const subtaskCount = task.subtaskCount || 1;

  // Günlük görevlerde periodKey zaten gerçek günün tarihi. Ama haftalık/aylık
  // görevlerde periodKey "periyodun başlangıcı"dır — kafa karışıklığını
  // önlemek için tamamlanmış kayıtlarda gerçek tamamlama tarihi gösterilir.
  const showsRealCompletionDate = isSuccess && record.completedAt && task.period !== 'DAILY';
  const primaryDateLabel = showsRealCompletionDate ? formatDate(new Date(record.completedAt)) : formatDate(record.periodKey);
  const periodContextLabel = showsRealCompletionDate ? `${periodLabel(task.period)} periyodu: ${formatDate(record.periodKey)}` : null;

  const dotClass = isSuccess
    ? 'task-detail-page__history-dot--success'
    : isPartial
      ? 'task-detail-page__history-dot--partial'
      : 'task-detail-page__history-dot--danger';

  return (
    <div className="task-detail-page__history-row">
      <span className={`task-detail-page__history-dot ${dotClass}`} />
      <div className="task-detail-page__history-text">
        <p className="task-detail-page__history-date">{primaryDateLabel}</p>
        {periodContextLabel && <p className="task-detail-page__history-period-context">{periodContextLabel}</p>}
        <p className="task-detail-page__history-status">
          {isSuccess
            ? `Tamamlandı${record.isLateMarked ? ' (geç işaretlendi)' : ''}`
            : isPartial
              ? `Devam ediyor (${record.completedSubtasks}/${subtaskCount})`
              : 'Başarısız'}
        </p>
      </div>
      {canLateMark && (
        <AppButton title="Düzelt" variant="secondary" onClick={onLateMark} style={{ width: 'auto', padding: 'var(--space-xs) var(--space-md)' }} />
      )}
    </div>
  );
}
