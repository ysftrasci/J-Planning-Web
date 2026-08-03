import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Send, Hourglass, CheckCircle2, Clock, Pencil, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { listenTasksIAssigned, deleteAssignedTask } from '../services/taskAssignmentService';
import { deleteTask } from '../db/taskRepository';
import { periodLabel } from '../utils/period';
import EmptyState from '../components/EmptyState.jsx';
import AppModal from '../components/AppModal.jsx';
import AppButton from '../components/AppButton.jsx';
import './AssignedByMePage.css';

const PRIORITY_LABEL = { HIGH: 'Yüksek', MEDIUM: 'Orta', LOW: 'Düşük', EASY: 'Kolay', HARD: 'Zor' };

export default function AssignedByMePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState([]);
  const [taskToDelete, setTaskToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!user) return;
    const unsub = listenTasksIAssigned(user.uid, setTasks);
    return unsub;
  }, [user]);

  const confirmDelete = async () => {
    if (!taskToDelete) return;
    setDeleting(true);
    setErrorMessage('');
    try {
      await deleteAssignedTask(taskToDelete.id);
      deleteTask(taskToDelete.id);
      setTaskToDelete(null);
    } catch (e) {
      console.error('Atanan görev silinirken hata:', e);
      setErrorMessage(e.message || 'Görev silinirken bir sorun oluştu.');
    } finally {
      setDeleting(false);
    }
  };

  const activeTasks = tasks.filter((t) => t.status === 'ACCEPTED' || t.status === 'PENDING');

  return (
    <div className="assigned-by-me-page">
      <button type="button" className="assigned-by-me-page__back" onClick={() => navigate('/')}>
        <ChevronLeft size={18} />
        Görevlerim
      </button>

      <h1>Attıklarım</h1>
      <p className="assigned-by-me-page__intro">
        Arkadaşlarına attığın görevler burada listelenir. Tamamlama durumunu gerçek zamanlı takip edebilirsin.
      </p>

      {errorMessage && (
        <p style={{ color: 'var(--color-danger, #ef4444)', fontSize: '14px', marginBottom: 'var(--space-sm)' }}>
          {errorMessage}
        </p>
      )}

      {activeTasks.length === 0 ? (
        <EmptyState
          icon={Send}
          title="Henüz kimseye görev atamadın"
          subtitle="Görev eklerken 'Kime atanacak?' kısmından bir arkadaşını seçebilirsin"
        />
      ) : (
        <div className="assigned-by-me-page__list">
          {activeTasks.map((item) => {
            const isPending = item.status === 'PENDING';
            const isDone = item.isCompletedToday === true;
            const subtaskCount = item.subtaskCount || 1;
            const StatusIcon = isPending ? Hourglass : isDone ? CheckCircle2 : Clock;
            const statusClass = isPending
              ? 'assigned-by-me-page__status--pending'
              : isDone
                ? 'assigned-by-me-page__status--done'
                : 'assigned-by-me-page__status--waiting';

            return (
              <div key={item.id} className="assigned-by-me-page__card">
                <div className="assigned-by-me-page__card-header">
                  <span className="assigned-by-me-page__title">{item.title}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                    <span className={`assigned-by-me-page__status ${statusClass}`}>
                      <StatusIcon size={14} />
                      {isPending ? 'Onay Bekliyor' : isDone ? 'Tamamlandı' : 'Bekliyor'}
                    </span>
                    <button
                      type="button"
                      className="assigned-by-me-page__edit-btn"
                      title="Görevi Düzenle"
                      onClick={() => navigate(`/task/${item.id}/edit`)}
                      style={{
                        background: 'var(--color-surface-alt)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-pill)',
                        cursor: 'pointer',
                        color: 'var(--color-text-secondary)',
                        padding: '4px 8px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        fontSize: '12px',
                        fontWeight: 600,
                      }}
                    >
                      <Pencil size={13} />
                      <span>Düzenle</span>
                    </button>
                    <button
                      type="button"
                      className="assigned-by-me-page__delete-btn"
                      title="Görevi Sil"
                      onClick={() => setTaskToDelete(item)}
                      style={{
                        background: 'var(--color-danger-soft, rgba(239, 68, 68, 0.1))',
                        border: '1px solid var(--color-danger-border, rgba(239, 68, 68, 0.2))',
                        borderRadius: 'var(--radius-pill)',
                        cursor: 'pointer',
                        color: 'var(--color-danger, #ef4444)',
                        padding: '4px 8px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        fontSize: '12px',
                        fontWeight: 600,
                      }}
                    >
                      <Trash2 size={13} />
                      <span>Sil</span>
                    </button>
                  </div>
                </div>
                {item.description && (
                  <p className="caption" style={{ marginTop: 'var(--space-xs)', color: 'var(--color-text-primary)' }}>
                    📝 {item.description}
                  </p>
                )}
                <p className="assigned-by-me-page__meta">
                  {item.assignedToName} • {periodLabel(item.period)} • {PRIORITY_LABEL[item.priority]}
                  {!isPending && subtaskCount > 1 ? ` • ${item.completedSubtasks || 0}/${subtaskCount}` : ''}
                </p>
              </div>
            );
          })}
        </div>
      )}

      <AppModal open={!!taskToDelete} onClose={() => setTaskToDelete(null)} title="Atanan Görevi Sil">
        <p className="caption">
          "{taskToDelete?.title}" görevini silmek istediğinize emin misiniz? Bu görev <strong>{taskToDelete?.assignedToName}</strong> kullanıcısının ekranından da kaldırılacaktır.
        </p>
        <div className="assigned-by-me-page__modal-actions" style={{ display: 'flex', gap: 'var(--space-md)', justifyContent: 'flex-end', marginTop: 'var(--space-md)' }}>
          <AppButton title="Vazgeç" variant="ghost" onClick={() => setTaskToDelete(null)} disabled={deleting} />
          <AppButton title="Sil" variant="danger" onClick={confirmDelete} loading={deleting} />
        </div>
      </AppModal>
    </div>
  );
}
