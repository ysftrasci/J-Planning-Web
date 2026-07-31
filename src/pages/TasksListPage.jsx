// J-Planning — Görevlerim Sayfası (Web)
// Mobildeki src/screens/TasksListScreen.js dosyasının web karşılığı.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Send, Plus, CheckCircle2, ChevronRight, Tags, Bell } from 'lucide-react';
import {
  getActiveTasks,
  getCurrentPeriodStatus,
  completeSubtask,
  uncompleteSubtask,
  processExpiredPeriods,
  getTaskRecords,
  createTaskFromAssignment,
} from '../db/taskRepository';
import { getCategories } from '../db/categoryRepository';
import { calculateCurrentStreak } from '../utils/streak';
import { useAuth } from '../context/AuthContext.jsx';
import { listenPendingTasksAssignedToMe, acceptAssignedTask, rejectAssignedTask, syncCompletionStatusToFirestore } from '../services/taskAssignmentService';
import { listenFriends } from '../services/friendService';
import TaskCard from '../components/TaskCard.jsx';
import EmptyState from '../components/EmptyState.jsx';
import AssignedTaskModal from '../components/AssignedTaskModal.jsx';
import './TasksListPage.css';

export default function TasksListPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [pendingAssigned, setPendingAssigned] = useState([]);
  const [modalTask, setModalTask] = useState(null);
  const [friendNameByUid, setFriendNameByUid] = useState({});

  useEffect(() => {
    if (!user) return;
    const unsub = listenFriends(user.uid, (friends) => {
      const map = {};
      friends.forEach((f) => { map[f.friendUid] = f.friendName; });
      setFriendNameByUid(map);
    });
    return unsub;
  }, [user]);

  const load = useCallback(() => {
    processExpiredPeriods();

    const tasks = getActiveTasks();
    const categories = getCategories();
    const categoryMap = new Map(categories.map((c) => [c.id, c]));
    const grouped = new Map();

    tasks.forEach((task) => {
      // Arkadaşıma attığım görevler (SENT) burada gösterilmez — kendi görev
      // listem sadece benim yapmam gereken görevleri içerir. Attıklarımı
      // ayrı bir sayfada ("Attıklarım") görebilirim.
      if (task.assignmentDirection === 'SENT') return;

      // Arkadaşın atama anındaki ismi (assignedByName) sonradan değişmiş
      // olabilir — gösterirken her zaman GÜNCEL ismi kullan.
      const displayTask = task.assignedByUserId && friendNameByUid[task.assignedByUserId]
        ? { ...task, assignedByName: friendNameByUid[task.assignedByUserId] }
        : task;

      const records = getTaskRecords(task.id);
      const { status, completedSubtasks } = getCurrentPeriodStatus(task);
      const streak = calculateCurrentStreak(task, records);
      const item = { task: displayTask, status, completedSubtasks, streak };

      const categoryName = task.categoryId && categoryMap.has(task.categoryId)
        ? categoryMap.get(task.categoryId).name
        : 'Kategorisiz';

      if (!grouped.has(categoryName)) grouped.set(categoryName, []);
      grouped.get(categoryName).push(item);
    });

    setSections(Array.from(grouped.entries()).map(([title, data]) => ({ title, data })));
    setLoading(false);
  }, [friendNameByUid]);

  useEffect(load, [load]);

  useEffect(() => {
    if (!user) return;
    const unsub = listenPendingTasksAssignedToMe(user.uid, setPendingAssigned);
    return unsub;
  }, [user]);

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3500);
  };

  const handleComplete = (task) => {
    try {
      const result = completeSubtask(task.id);
      if (result?.fullyCompleted && result.bonus > 0) {
        showToast(`Seri Bonusu! 🔥 ${result.newStreak} günlük seriye ulaştın! +${result.bonus} JP bonus kazandın (toplam +${result.total} JP).`);
      }
      // Bu görev bir arkadaşımdan atandıysa (RECEIVED), tamamlanma durumunu
      // Firestore'a da yansıt ki atayan kişi gerçek zamanlı görebilsin.
      if (result?.firestoreAssignmentId) {
        syncCompletionStatusToFirestore(result.firestoreAssignmentId, {
          isCompleted: !!result.fullyCompleted || !!result.alreadyComplete,
          completedSubtasks: result.completedSubtasks,
          subtaskCount: result.subtaskCount,
        });
      }
      load();
    } catch (e) {
      showToast(e.message);
    }
  };

  const handleUncomplete = (task) => {
    try {
      const result = uncompleteSubtask(task.id);
      if (result?.firestoreAssignmentId) {
        syncCompletionStatusToFirestore(result.firestoreAssignmentId, {
          isCompleted: false,
          completedSubtasks: result.completedSubtasks,
          subtaskCount: result.subtaskCount,
        });
      }
      load();
    } catch (e) {
      showToast(e.message);
    }
  };

  const handleAcceptAssigned = async () => {
    if (!modalTask) return;
    try {
      await acceptAssignedTask(modalTask.id);
      // Kabul edilen görev, kendi yerel görev listesine de eklenir (tamamlanabilmesi için).
      // Not: kabul sonrası silinemez (bkz. taskRepository.deleteTask kuralı).
      createTaskFromAssignment(modalTask);
      setModalTask(null);
      load();
    } catch (e) {
      showToast(e.message);
    }
  };

  const handleRejectAssigned = async () => {
    if (!modalTask) return;
    try {
      await rejectAssignedTask(modalTask.id);
      setModalTask(null);
    } catch (e) {
      showToast(e.message);
    }
  };

  const hasTasks = sections.length > 0;

  return (
    <div className="tasks-list-page">
      <div className="tasks-list-page__header">
        <h1>Görevlerim</h1>
        <div className="tasks-list-page__header-buttons">
          <button
            type="button"
            className="tasks-list-page__icon-button"
            onClick={() => navigate('/categories')}
            aria-label="Kategoriler"
            title="Kategoriler"
          >
            <Tags size={18} />
          </button>
          <button
            type="button"
            className="tasks-list-page__icon-button"
            onClick={() => navigate('/assigned-by-me')}
            aria-label="Attıklarım"
            title="Attıklarım"
          >
            <Send size={18} />
          </button>
          <button
            type="button"
            className="tasks-list-page__add-button"
            onClick={() => navigate('/add-task')}
            aria-label="Yeni görev ekle"
          >
            <Plus size={24} />
          </button>
        </div>
      </div>

      {pendingAssigned.length > 0 && (
        <button type="button" className="tasks-list-page__pending-banner" onClick={() => setModalTask(pendingAssigned[0])}>
          <Bell size={18} />
          <span>{pendingAssigned.length} arkadaşın sana görev atadı, onay bekliyor</span>
          <ChevronRight size={16} />
        </button>
      )}

      {toast && <div className="tasks-list-page__toast">{toast}</div>}

      {!loading && !hasTasks && (
        <EmptyState
          icon={CheckCircle2}
          title="Henüz görev yok"
          subtitle="Sağ üstteki + butonuna dokunarak ilk görevini ekle"
        />
      )}

      {sections.map((section) => (
        <div key={section.title} className="tasks-list-page__section">
          <h2 className="tasks-list-page__section-title">{section.title}</h2>
          {section.data.map((item) => (
            <TaskCard
              key={item.task.id}
              task={item.task}
              status={item.status}
              completedSubtasks={item.completedSubtasks}
              streak={item.streak}
              onOpen={() => navigate(`/task/${item.task.id}`)}
              onComplete={() => handleComplete(item.task)}
              onUncomplete={() => handleUncomplete(item.task)}
            />
          ))}
        </div>
      ))}

      {hasTasks && (
        <button
          type="button"
          className="tasks-list-page__danger-zone-link"
          onClick={() => showToast('Tehlikeli Alan, Aşama 7\'de Profil bölümüyle birlikte eklenecek.')}
        >
          Tehlikeli Alan'ı görüntüle
          <ChevronRight size={14} />
        </button>
      )}

      <AssignedTaskModal
        open={!!modalTask}
        task={modalTask}
        onClose={() => setModalTask(null)}
        onAccept={handleAcceptAssigned}
        onReject={handleRejectAssigned}
      />
    </div>
  );
}
