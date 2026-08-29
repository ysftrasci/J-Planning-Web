import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Hourglass, CheckCircle2, Clock, Pencil, Trash2, FileText } from 'lucide-react';
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
      await deleteTask(taskToDelete.id);
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
        <p style={{ color: 'var(--color-danger)', fontSize: '14px', marginBottom: 'var(--space-sm)' }}>
          {errorMessage}
        </p>
      )}

      {activeTasks.length === 0 ? (
        <EmptyState
          icon={Clock}
          title="Henüz kimseye görev atamadın"
          subtitle="Görev eklerken 'Kime atanacak?' kısmından bir arkadaşını seçebilirsin"
        />
      ) : (
        <div className="assigned-by-me-page__list">
          {activeTasks.map((item) => {
            const isPending = item.status === 'PENDING';
            const isDone = item.isCompletedToday === true;
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
                  
                  <div className="assigned-by-me-page__actions">
                    <span className={`assigned-by-me-page__status ${statusClass}`}>
                      <StatusIcon size={13} />
                      <span>{isPending ? 'Onay Bekliyor' : isDone ? 'Tamamlandı' : 'Bekliyor'}</span>
                    </span>

                    <button
                      type="button"
                      className="assigned-by-me-page__btn assigned-by-me-page__btn--edit"
                      onClick={() => navigate(`/task/${item.id}/edit`)}
                      title="Düzenle"
                    >
                      <Pencil size={12} />
                      <span>Düzenle</span>
                    </button>

                    <button
                      type="button"
                      className="assigned-by-me-page__btn assigned-by-me-page__btn--delete"
                      onClick={() => setTaskToDelete(item)}
                      title="Sil"
                    >
                      <Trash2 size={12} />
                      <span>Sil</span>
                    </button>
                  </div>
                </div>

                {item.description && (
                  <div className="assigned-by-me-page__desc-row">
                    <FileText size={13} className="assigned-by-me-page__desc-icon" />
                    <span className="assigned-by-me-page__description">{item.description}</span>
                  </div>
                )}

                <div className="assigned-by-me-page__meta">
                  {item.assignedToName || 'Arkadaşın'} • {periodLabel(item.period)} • {PRIORITY_LABEL[item.priority] || 'Orta'}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Silme Onay Modalı */}
      {taskToDelete && (
        <AppModal
          open={!!taskToDelete}
          onClose={() => setTaskToDelete(null)}
          title="Atanan Görevi Sil"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '8px 0' }}>
            <p style={{ margin: 0, fontSize: '14px', lineHeight: 1.5 }}>
              <strong>"{taskToDelete.title}"</strong> görevini silmek istediğine emin misin? Görev arkadaşının listesinden de kaldırılacaktır.
            </p>
            <div style={{ display: 'flex', gap: '12px' }}>
              <AppButton
                title="Vazgeç"
                variant="secondary"
                onClick={() => setTaskToDelete(null)}
              />
              <AppButton
                title="Evet, Sil"
                variant="danger"
                loading={deleting}
                onClick={confirmDelete}
              />
            </div>
          </div>
        </AppModal>
      )}
    </div>
  );
}
