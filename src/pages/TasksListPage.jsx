import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Send, Plus, CheckCircle2, ChevronRight, Tags, Bell, Search, X, SlidersHorizontal, Filter, BookOpen } from 'lucide-react';
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
import AppModal from '../components/AppModal.jsx';
import AppButton from '../components/AppButton.jsx';
import { triggerConfetti } from '../utils/confetti';
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
  const [searchQuery, setSearchQuery] = useState('');
  
  // Filtre durumları
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [periodFilter, setPeriodFilter] = useState('ALL'); // 'ALL' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'ONCE'
  const [priorityFilter, setPriorityFilter] = useState('ALL'); // 'ALL' | 'HIGH' | 'MEDIUM' | 'LOW'
  const [sourceFilter, setSourceFilter] = useState('ALL'); // 'ALL' | 'MINE' | 'RECEIVED'

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
      if (task.assignmentDirection === 'SENT') return;

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
      if (result?.fullyCompleted) {
        triggerConfetti();
        if (result.bonus > 0) {
          showToast(`Seri Bonusu! 🔥 ${result.newStreak} günlük seriye ulaştın! +${result.bonus} JP bonus kazandın (toplam +${result.total} JP).`);
        }
      }
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

  const isFilterActive = periodFilter !== 'ALL' || priorityFilter !== 'ALL' || sourceFilter !== 'ALL';

  const resetFilters = () => {
    setPeriodFilter('ALL');
    setPriorityFilter('ALL');
    setSourceFilter('ALL');
  };

  const filteredSections = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sections
      .map((sec) => {
        const matchingData = sec.data.filter((item) => {
          const t = item.task;
          const matchesQuery = !q || t.title.toLowerCase().includes(q) || (t.description && t.description.toLowerCase().includes(q));

          let matchesPeriod = true;
          if (periodFilter !== 'ALL') matchesPeriod = t.period === periodFilter;

          let matchesPriority = true;
          if (priorityFilter !== 'ALL') matchesPriority = t.priority === priorityFilter;

          let matchesSource = true;
          if (sourceFilter === 'MINE') matchesSource = !t.assignmentDirection;
          else if (sourceFilter === 'RECEIVED') matchesSource = t.assignmentDirection === 'RECEIVED';

          return matchesQuery && matchesPeriod && matchesPriority && matchesSource;
        });
        return { ...sec, data: matchingData };
      })
      .filter((sec) => sec.data.length > 0);
  }, [sections, searchQuery, periodFilter, priorityFilter, sourceFilter]);

  const pendingBannerText = useMemo(() => {
    if (!pendingAssigned || pendingAssigned.length === 0) return '';
    const sendersMap = new Map();
    pendingAssigned.forEach((t) => {
      const name = t.assignedByName || 'Bir arkadaşın';
      sendersMap.set(name, (sendersMap.get(name) || 0) + 1);
    });

    const senders = Array.from(sendersMap.entries());
    if (senders.length === 1) {
      const [name, count] = senders[0];
      return `${name} sana ${count} görev atadı, onay bekliyor`;
    }
    return `${pendingAssigned.length} görev isteğin var (${senders.length} arkadaşından), onay bekliyor`;
  }, [pendingAssigned]);

  const hasTasks = sections.length > 0;

  return (
    <div className="tasks-list-page">
      <div className="tasks-list-page__header">
        <h1>Görevlerim</h1>
        <div className="tasks-list-page__header-buttons">
          <button
            type="button"
            className="tasks-list-page__note-button"
            onClick={() => navigate('/daily-notes')}
            aria-label="Günün Notu"
            title="Günün Notu"
          >
            <BookOpen size={16} />
            <span>Günün Notu</span>
          </button>
          <button
            type="button"
            className={`tasks-list-page__icon-button ${isFilterActive ? 'tasks-list-page__icon-button--active' : ''}`}
            onClick={() => setShowFilterModal(true)}
            aria-label="Filtrele"
            title="Filtrele"
          >
            <SlidersHorizontal size={18} />
          </button>
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
          <span>{pendingBannerText}</span>
          <ChevronRight size={16} />
        </button>
      )}

      {toast && <div className="tasks-list-page__toast">{toast}</div>}

      {/* Arama ve Filtreleme Bölümü */}
      <div className="tasks-list-page__filter-bar">
        <div className="tasks-list-page__search-wrap">
          <Search size={16} color="var(--color-text-secondary)" />
          <input
            type="text"
            className="tasks-list-page__search-input"
            placeholder="Görevlerde ara..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="tasks-list-page__search-clear"
              onClick={() => setSearchQuery('')}
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="tasks-list-page__chips-row">
          <button
            type="button"
            className={`tasks-list-page__chip ${!isFilterActive ? 'tasks-list-page__chip--active' : ''}`}
            onClick={resetFilters}
          >
            Tümü
          </button>
          <button
            type="button"
            className={`tasks-list-page__chip ${periodFilter === 'DAILY' ? 'tasks-list-page__chip--active' : ''}`}
            onClick={() => setPeriodFilter((prev) => (prev === 'DAILY' ? 'ALL' : 'DAILY'))}
          >
            Günlük
          </button>
          <button
            type="button"
            className={`tasks-list-page__chip ${priorityFilter === 'HIGH' ? 'tasks-list-page__chip--active' : ''}`}
            onClick={() => setPriorityFilter((prev) => (prev === 'HIGH' ? 'ALL' : 'HIGH'))}
          >
            Yüksek Öncelik
          </button>
          <button
            type="button"
            className={`tasks-list-page__chip ${sourceFilter === 'RECEIVED' ? 'tasks-list-page__chip--active' : ''}`}
            onClick={() => setSourceFilter((prev) => (prev === 'RECEIVED' ? 'ALL' : 'RECEIVED'))}
          >
            Arkadaşımdan
          </button>
        </div>
      </div>

      {!loading && filteredSections.length === 0 && (
        <EmptyState
          icon={CheckCircle2}
          title={searchQuery || isFilterActive ? 'Eşleşen görev bulunamadı' : 'Henüz görev yok'}
          subtitle={searchQuery || isFilterActive ? 'Filtreleri veya arama kelimesini değiştirmeyi dene' : 'Sağ üstteki + butonuna dokunarak ilk görevini ekle'}
        />
      )}

      {filteredSections.map((section) => (
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
          onClick={() => navigate('/profile/danger-zone')}
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

      {/* Detaylı Filtreleme Modalı */}
      {showFilterModal && (
        <AppModal
          open={showFilterModal}
          onClose={() => setShowFilterModal(false)}
          title="Görevleri Filtrele"
        >
          <div className="tasks-list-page__filter-modal">
            <div className="tasks-list-page__filter-group">
              <label className="tasks-list-page__filter-label">Periyot</label>
              <div className="tasks-list-page__chip-row">
                <Chip label="Tümü" selected={periodFilter === 'ALL'} onClick={() => setPeriodFilter('ALL')} />
                <Chip label="Günlük" selected={periodFilter === 'DAILY'} onClick={() => setPeriodFilter('DAILY')} />
                <Chip label="Haftalık" selected={periodFilter === 'WEEKLY'} onClick={() => setPeriodFilter('WEEKLY')} />
                <Chip label="Aylık" selected={periodFilter === 'MONTHLY'} onClick={() => setPeriodFilter('MONTHLY')} />
                <Chip label="Tek Seferlik" selected={periodFilter === 'ONCE'} onClick={() => setPeriodFilter('ONCE')} />
              </div>
            </div>

            <div className="tasks-list-page__filter-group">
              <label className="tasks-list-page__filter-label">Öncelik / Zorluk</label>
              <div className="tasks-list-page__chip-row">
                <Chip label="Tümü" selected={priorityFilter === 'ALL'} onClick={() => setPriorityFilter('ALL')} />
                <Chip label="Yüksek / Zor" selected={priorityFilter === 'HIGH'} onClick={() => setPriorityFilter('HIGH')} />
                <Chip label="Orta" selected={priorityFilter === 'MEDIUM'} onClick={() => setPriorityFilter('MEDIUM')} />
                <Chip label="Düşük / Kolay" selected={priorityFilter === 'LOW'} onClick={() => setPriorityFilter('LOW')} />
              </div>
            </div>

            <div className="tasks-list-page__filter-group">
              <label className="tasks-list-page__filter-label">Görev Kaynağı</label>
              <div className="tasks-list-page__chip-row">
                <Chip label="Tümü" selected={sourceFilter === 'ALL'} onClick={() => setSourceFilter('ALL')} />
                <Chip label="Kendi Görevlerim" selected={sourceFilter === 'MINE'} onClick={() => setSourceFilter('MINE')} />
                <Chip label="Arkadaşımdan Gelenler" selected={sourceFilter === 'RECEIVED'} onClick={() => setSourceFilter('RECEIVED')} />
              </div>
            </div>

            <div className="tasks-list-page__modal-actions">
              <AppButton
                title="Filtreleri Sıfırla"
                variant="secondary"
                onClick={resetFilters}
              />
              <AppButton
                title="Uygula"
                onClick={() => setShowFilterModal(false)}
              />
            </div>
          </div>
        </AppModal>
      )}
    </div>
  );
}

function Chip({ label, selected, onClick }) {
  return (
    <button
      type="button"
      className={`tasks-list-page__chip ${selected ? 'tasks-list-page__chip--active' : ''}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
