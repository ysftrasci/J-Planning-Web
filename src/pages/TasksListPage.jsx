import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Send, Plus, CheckCircle2, Search, X, SlidersHorizontal, Filter, BookOpen } from 'lucide-react';
import {
  getActiveTasks,
  completeSubtask,
  uncompleteSubtask,
  processExpiredPeriods,
  getAllTaskRecords,
  createTaskFromAssignment,
} from '../db/taskRepository';
import { getCategories } from '../db/categoryRepository';
import { calculateCurrentStreak } from '../utils/streak';
import { getPeriodKey } from '../utils/period';
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
  const [toast, setToast] = useState('');
  const [pendingAssigned, setPendingAssigned] = useState([]);
  const [modalTask, setModalTask] = useState(null);
  const [friendNameByUid, setFriendNameByUid] = useState({});

  // Arama ve Filtreleme State'leri
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [periodFilter, setPeriodFilter] = useState('ALL');
  const [priorityFilter, setPriorityFilter] = useState('ALL');
  const [sourceFilter, setSourceFilter] = useState('ALL');

  useEffect(() => {
    if (!user) return;
    const unsub = listenFriends(user.uid, (friends) => {
      const map = {};
      friends.forEach((f) => { map[f.friendUid] = f.friendName; });
      setFriendNameByUid(map);
    });
    return unsub;
  }, [user]);

  const load = useCallback(async () => {
    try {
      await processExpiredPeriods();

      const [tasks, categories, allRecords] = await Promise.all([
        getActiveTasks(),
        getCategories(),
        getAllTaskRecords(),
      ]);
      const categoryMap = new Map((categories || []).map((c) => [c.id, c]));
      const grouped = new Map();

      const recordsByTaskId = new Map();
      for (const r of (allRecords || [])) {
        if (!recordsByTaskId.has(r.taskId)) {
          recordsByTaskId.set(r.taskId, []);
        }
        recordsByTaskId.get(r.taskId).push(r);
      }

      const now = new Date();

      const items = (tasks || []).map((task) => {
        if (task.assignmentDirection === 'SENT') return null;

        const displayTask = task.assignedByUserId && friendNameByUid[task.assignedByUserId]
          ? { ...task, assignedByName: friendNameByUid[task.assignedByUserId] }
          : task;

        const taskRecords = recordsByTaskId.get(task.id) || [];
        const currentPeriodKey = getPeriodKey(task.period, now);
        const currentRecord = taskRecords.find((r) => r.periodKey === currentPeriodKey);

        const status = currentRecord ? currentRecord.status : 'PENDING';
        const completedSubtasks = currentRecord ? (currentRecord.completedSubtasks || 0) : 0;
        const streak = calculateCurrentStreak(task, taskRecords);

        return { task: displayTask, status, completedSubtasks, streak };
      });

      items.forEach((item) => {
        if (!item) return;
        const task = item.task;
        const categoryName = task.categoryId && categoryMap.has(task.categoryId)
          ? categoryMap.get(task.categoryId).name
          : 'KATEGORİSİZ';

        if (!grouped.has(categoryName)) grouped.set(categoryName, []);
        grouped.get(categoryName).push(item);
      });

      setSections(Array.from(grouped.entries()).map(([title, data]) => ({ title, data })));
    } catch (err) {
      console.error('Görev listesi yüklenirken hata:', err);
    } finally {
      setLoading(false);
    }
  }, [friendNameByUid]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const handleCloudUpdate = () => {
      load();
    };
    window.addEventListener('jplanning:cloud-sync-update', handleCloudUpdate);
    return () => {
      window.removeEventListener('jplanning:cloud-sync-update', handleCloudUpdate);
    };
  }, [load]);

  useEffect(() => {
    if (!user) return;
    const unsub = listenPendingTasksAssignedToMe(user.uid, (tasks) => {
      setPendingAssigned(tasks || []);
    });
    return unsub;
  }, [user]);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const handleComplete = async (task) => {
    // 1. ANINDA ARAYÜZÜ GÜNCELLE (Optimistic Update — 0ms Gecikme)
    setSections((prev) =>
      prev.map((sec) => ({
        ...sec,
        data: sec.data.map((item) => {
          if (item.task.id === task.id) {
            const nextCompleted = Math.min(task.subtaskCount || 1, (item.completedSubtasks || 0) + 1);
            const isDone = nextCompleted >= (task.subtaskCount || 1);
            return {
              ...item,
              completedSubtasks: nextCompleted,
              status: isDone ? 'SUCCESSFUL' : 'PENDING_PARTIAL',
              streak: isDone ? item.streak + 1 : item.streak,
            };
          }
          return item;
        }),
      }))
    );

    triggerConfetti();

    // 2. Arka planda Turso veritabanına yaz
    try {
      const result = await completeSubtask(task.id);
      if (result?.firestoreAssignmentId) {
        await syncCompletionStatusToFirestore(result.firestoreAssignmentId, {
          isCompleted: !!result.fullyCompleted || !!result.alreadyComplete,
          completedSubtasks: result.completedSubtasks,
          subtaskCount: result.subtaskCount,
        });
      }
    } catch (e) {
      showToast(e.message);
      await load();
    }
  };

  const handleUncomplete = async (task) => {
    // 1. ANINDA ARAYÜZÜ GERİ AL (Optimistic Update — 0ms Gecikme)
    setSections((prev) =>
      prev.map((sec) => ({
        ...sec,
        data: sec.data.map((item) => {
          if (item.task.id === task.id) {
            const nextCompleted = Math.max(0, (item.completedSubtasks || 0) - 1);
            return {
              ...item,
              completedSubtasks: nextCompleted,
              status: nextCompleted > 0 ? 'PENDING_PARTIAL' : 'PENDING',
              streak: Math.max(0, item.streak - 1),
            };
          }
          return item;
        }),
      }))
    );

    // 2. Arka planda Turso veritabanından geri al
    try {
      const result = await uncompleteSubtask(task.id);
      if (result?.firestoreAssignmentId) {
        await syncCompletionStatusToFirestore(result.firestoreAssignmentId, {
          isCompleted: false,
          completedSubtasks: result.completedSubtasks,
          subtaskCount: result.subtaskCount,
        });
      }
    } catch (e) {
      showToast(e.message);
      await load();
    }
  };

  const handleAcceptAssigned = async () => {
    if (!modalTask) return;
    try {
      await acceptAssignedTask(modalTask.id);
      await createTaskFromAssignment(modalTask);
      setModalTask(null);
      await load();
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

  const filteredSections = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    
    return sections.map((section) => {
      const filteredData = section.data.filter(({ task }) => {
        if (query) {
          const matchTitle = (task.title || '').toLowerCase().includes(query);
          const matchDesc = (task.description || '').toLowerCase().includes(query);
          const matchAssigner = (task.assignedByName || '').toLowerCase().includes(query);
          if (!matchTitle && !matchDesc && !matchAssigner) return false;
        }

        if (periodFilter !== 'ALL' && task.period !== periodFilter) {
          return false;
        }

        if (priorityFilter !== 'ALL' && task.priority !== priorityFilter) {
          return false;
        }

        if (sourceFilter === 'MINE' && task.assignmentDirection === 'RECEIVED') {
          return false;
        }
        if (sourceFilter === 'RECEIVED' && task.assignmentDirection !== 'RECEIVED') {
          return false;
        }

        return true;
      });

      return {
        ...section,
        data: filteredData,
      };
    }).filter((section) => section.data.length > 0);
  }, [sections, searchQuery, periodFilter, priorityFilter, sourceFilter]);

  const hasActiveFilters = periodFilter !== 'ALL' || priorityFilter !== 'ALL' || sourceFilter !== 'ALL';
  const totalTasksCount = sections.reduce((sum, s) => sum + s.data.length, 0);

  return (
    <div className="tasks-list-page">
      {toast && (
        <div className="tasks-list-page__toast" role="alert">
          <CheckCircle2 size={18} />
          <span>{toast}</span>
        </div>
      )}

      {/* Header: Başlık ve Üst Butonlar */}
      <div className="tasks-list-page__header">
        <h1>Görevlerim</h1>
        <div className="tasks-list-page__header-buttons">
          <button
            type="button"
            className="tasks-list-page__note-button"
            onClick={() => navigate('/daily-notes')}
          >
            <BookOpen size={16} />
            <span>Günün Özeti</span>
          </button>
          <button
            type="button"
            className="tasks-list-page__icon-button"
            onClick={() => navigate('/assigned-by-me')}
            title="Atadığım Görevler"
          >
            <Send size={18} />
          </button>
          <button
            type="button"
            className="tasks-list-page__add-button"
            onClick={() => navigate('/tasks/new')}
            title="Yeni Görev Ekle"
          >
            <Plus size={22} />
          </button>
        </div>
      </div>

      {/* Arama ve Filtre Çubuğu */}
      <div className="tasks-list-page__filter-bar">
        <div className="tasks-list-page__search-wrap">
          <Search size={18} className="tasks-list-page__search-icon" />
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
              aria-label="Aramayı temizle"
            >
              <X size={16} />
            </button>
          )}
        </div>

        <div className="tasks-list-page__chips-row">
          <button
            type="button"
            className={`tasks-list-page__chip ${periodFilter === 'ALL' && priorityFilter === 'ALL' && sourceFilter === 'ALL' ? 'tasks-list-page__chip--active' : ''}`}
            onClick={() => {
              setPeriodFilter('ALL');
              setPriorityFilter('ALL');
              setSourceFilter('ALL');
            }}
          >
            Tümü
          </button>
          <button
            type="button"
            className={`tasks-list-page__chip ${periodFilter === 'DAILY' ? 'tasks-list-page__chip--active' : ''}`}
            onClick={() => setPeriodFilter(periodFilter === 'DAILY' ? 'ALL' : 'DAILY')}
          >
            Günlük
          </button>
          <button
            type="button"
            className={`tasks-list-page__chip ${priorityFilter === 'HIGH' ? 'tasks-list-page__chip--active' : ''}`}
            onClick={() => setPriorityFilter(priorityFilter === 'HIGH' ? 'ALL' : 'HIGH')}
          >
            Yüksek Öncelik
          </button>
          <button
            type="button"
            className={`tasks-list-page__chip ${sourceFilter === 'RECEIVED' ? 'tasks-list-page__chip--active' : ''}`}
            onClick={() => setSourceFilter(sourceFilter === 'RECEIVED' ? 'ALL' : 'RECEIVED')}
          >
            Arkadaşımdan
          </button>
          <button
            type="button"
            className={`tasks-list-page__chip ${hasActiveFilters ? 'tasks-list-page__chip--active' : ''}`}
            onClick={() => setShowFilterModal(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <SlidersHorizontal size={14} />
            <span>Filtrele</span>
          </button>
        </div>
      </div>

      {/* Sana Atanan Görevler Banner'ı */}
      {pendingAssigned.length > 0 && (
        <button
          type="button"
          className="tasks-list-page__pending-banner"
          onClick={() => setModalTask(pendingAssigned[0])}
        >
          <Send size={18} />
          <span>Sana atanan {pendingAssigned.length} yeni görev var!</span>
        </button>
      )}

      {/* Görev Listesi */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--color-text-muted)' }}>Yükleniyor...</div>
      ) : filteredSections.length === 0 ? (
        totalTasksCount === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="Henüz görev eklemedin"
            subtitle="Sağ üstteki + butonuna basarak ilk görevini oluştur."
          />
        ) : (
          <EmptyState
            icon={Filter}
            title="Eşleşen görev bulunamadı"
            subtitle="Arama kriterlerini veya filtreleri değiştirerek tekrar dene."
          />
        )
      ) : (
        <div className="tasks-list-page__sections">
          {filteredSections.map((section) => (
            <div key={section.title} className="tasks-list-page__section">
              <h3 className="tasks-list-page__section-title">{section.title}</h3>
              <div className="tasks-list-page__list">
                {section.data.map(({ task, status, completedSubtasks, streak }) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    status={status}
                    completedSubtasks={completedSubtasks}
                    streak={streak}
                    onComplete={() => handleComplete(task)}
                    onUncomplete={() => handleUncomplete(task)}
                    onClick={() => navigate(`/tasks/${task.id}`)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Alt Tehlikeli Alan Linki */}
      <button
        type="button"
        className="tasks-list-page__danger-zone-link"
        onClick={() => navigate('/profile/danger-zone')}
      >
        Tehlikeli Alanı görüntüle &gt;
      </button>

      {/* Atanan Görev Karar Modalı */}
      <AssignedTaskModal
        task={modalTask}
        open={!!modalTask}
        onClose={() => setModalTask(null)}
        onAccept={handleAcceptAssigned}
        onReject={handleRejectAssigned}
      />

      {/* Filtreleme Seçenekleri Modalı */}
      {showFilterModal && (
        <AppModal
          open={showFilterModal}
          onClose={() => setShowFilterModal(false)}
          title="Görevleri Filtrele"
        >
          <div className="tasks-list-page__filter-modal">
            <div className="tasks-list-page__filter-group">
              <span className="tasks-list-page__filter-label">Periyot:</span>
              <div className="tasks-list-page__chip-row">
                {[
                  { id: 'ALL', label: 'Tümü' },
                  { id: 'DAILY', label: 'Günlük' },
                  { id: 'WEEKLY', label: 'Haftalık' },
                  { id: 'MONTHLY', label: 'Aylık' },
                  { id: 'ONCE', label: 'Tek Seferlik' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`tasks-list-page__chip ${periodFilter === opt.id ? 'tasks-list-page__chip--active' : ''}`}
                    onClick={() => setPeriodFilter(opt.id)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="tasks-list-page__filter-group">
              <span className="tasks-list-page__filter-label">Öncelik:</span>
              <div className="tasks-list-page__chip-row">
                {[
                  { id: 'ALL', label: 'Tümü' },
                  { id: 'HIGH', label: 'Yüksek' },
                  { id: 'MEDIUM', label: 'Orta' },
                  { id: 'LOW', label: 'Düşük' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`tasks-list-page__chip ${priorityFilter === opt.id ? 'tasks-list-page__chip--active' : ''}`}
                    onClick={() => setPriorityFilter(opt.id)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="tasks-list-page__filter-group">
              <span className="tasks-list-page__filter-label">Kaynak:</span>
              <div className="tasks-list-page__chip-row">
                {[
                  { id: 'ALL', label: 'Tümü' },
                  { id: 'MINE', label: 'Kendi Görevlerim' },
                  { id: 'RECEIVED', label: 'Bana Atananlar' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`tasks-list-page__chip ${sourceFilter === opt.id ? 'tasks-list-page__chip--active' : ''}`}
                    onClick={() => setSourceFilter(opt.id)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="tasks-list-page__modal-actions">
              <AppButton
                title="Sıfırla"
                variant="ghost"
                onClick={() => {
                  setPeriodFilter('ALL');
                  setPriorityFilter('ALL');
                  setSourceFilter('ALL');
                }}
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
