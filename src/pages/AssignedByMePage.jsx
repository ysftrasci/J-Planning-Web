// J-Planning — Attıklarım Sayfası (Web)
// Mobildeki src/screens/AssignedByMeScreen.js dosyasının web karşılığı.
//
// ÖNEMLİ: Bu sayfa, kendi yerel (SQLite) verimize DEĞİL, doğrudan Firestore
// assignedTasks koleksiyonuna bakar — çünkü tamamlanma durumu arkadaşımızın
// cihazında oluşur, bizim veritabanımızda hiç yaşamaz.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Send, Hourglass, CheckCircle2, Clock } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { listenTasksIAssigned } from '../services/taskAssignmentService';
import { periodLabel } from '../utils/period';
import EmptyState from '../components/EmptyState.jsx';
import './AssignedByMePage.css';

const PRIORITY_LABEL = { HIGH: 'Yüksek', MEDIUM: 'Orta', LOW: 'Düşük', EASY: 'Kolay', HARD: 'Zor' };

export default function AssignedByMePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState([]);

  useEffect(() => {
    if (!user) return;
    const unsub = listenTasksIAssigned(user.uid, setTasks);
    return unsub;
  }, [user]);

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
                  <span className={`assigned-by-me-page__status ${statusClass}`}>
                    <StatusIcon size={14} />
                    {isPending ? 'Onay Bekliyor' : isDone ? 'Tamamlandı' : 'Bekliyor'}
                  </span>
                </div>
                <p className="assigned-by-me-page__meta">
                  {item.assignedToName} • {periodLabel(item.period)} • {PRIORITY_LABEL[item.priority]}
                  {!isPending && subtaskCount > 1 ? ` • ${item.completedSubtasks || 0}/${subtaskCount}` : ''}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
