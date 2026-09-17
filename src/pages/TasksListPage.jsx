import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Send, Plus, CheckCircle2, Search, X, SlidersHorizontal, Filter, BookOpen, AlertCircle } from 'lucide-react';
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
import { isDatabaseReady, waitForDatabaseReady } from '../db/database';
import { useAuth } from '../context/AuthContext.jsx';
import {
  listenPendingTasksAssignedToMe,
  acceptAssignedTask,
  rejectAssignedTask,
  syncCompletionStatusToFirestore,
  listenTaskDeletionNotices,
  dismissTaskDeletionNotice,
} from '../services/taskAssignmentService';
import { listenFriends } from '../services/friendService';
import TaskCard from '../components/TaskCard.jsx';
import EmptyState from '../components/EmptyState.jsx';
import AssignedTaskModal from '../components/AssignedTaskModal.jsx';
import AppModal from '../components/AppModal.jsx';
import AppButton from '../components/AppButton.jsx';
import GuestRestrictedModal from '../components/GuestRestrictedModal.jsx';
import GuestLimitModal from '../components/GuestLimitModal.jsx';
import { triggerConfetti } from '../utils/confetti';
import './TasksListPage.css';

export default function TasksListPage() {
  const { user, isGuest } = useAuth();
  const navigate = useNavigate();

  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [pendingAssigned, setPendingAssigned] = useState([]);
  const [deletionNotices, setDeletionNotices] = useState([]);
  const [modalTask, setModalTask] = useState(null);
  const [friendNameByUid, setFriendNameByUid] = useState({});
  const [showRestrictedModal, setShowRestrictedModal] = useState(false);
  const [showLimitModal, setShowLimitModal] = useState(false);

  // Arama ve Filtreleme State'leri
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [periodFilter, setPeriodFilter] = useState('ALL');
  const [priorityFilter, setPriorityFilter] = useState('ALL');
  const [sourceFilter, setSourceFilter] = useState('ALL');

  useEffect(() => {
    if (!user || isGuest || !user.emailVerified) return;
    const unsub = listenFriends(user.uid, (friends) => {
      const map = {};
      friends.forEach((f) => { map[f.friendUid] = f.friendName; });
      setFriendNameByUid(map);
    });
    return unsub;
  }, [user, isGuest]);

  const load = useCallback(async () => {
    // Veritabanı henüz başlatılma aşamasındaysa kullanıcıya hata fırlatmak yerine hazır olmasını bekle
    if (!isDatabaseReady()) {
      setLoading(true);
      try {
        await waitForDatabaseReady(8000);
      } catch (_) {
        if (!isDatabaseReady()) {
          setLoading(false);
          return;
        }
      }
    }

    try {
      setLoading(true);
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
      if (err.message?.includes('Veritabanı henüz başlatılmadı')) {
        setLoading(true);
        return;
      }
      console.error('Görev listesi yüklenirken hata:', err);
    } finally {
      setLoading(false);
    }
  }, [friendNameByUid]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const handleDbReady = () => {
      load();
    };
    window.addEventListener('jplanning:database-ready', handleDbReady);
    return () => {
      window.removeEventListener('jplanning:database-ready', handleDbReady);
    };
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
    if (!user || isGuest || !user.emailVerified) return;
    const unsub = listenPendingTasksAssignedToMe(user.uid, (tasks) => {
      setPendingAssigned(tasks || []);
    });
    return unsub;
  }, [user, isGuest]);

  useEffect(() => {
    if (!user || isGuest || !user.emailVerified) return;
    const unsub = listenTaskDeletionNotices(user.uid, (notices) => {
      setDeletionNotices(notices || []);
    });
    return unsub;
  }, [user, isGuest]);

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
        const periodKey = getPeriodKey(task.period, new Date());
        const isNewlyCompleted = result?.fullyCompleted === true && !result?.alreadyComplete;
        await syncCompletionStatusToFirestore(result.firestoreAssignmentId, {
          isCompleted: !!result.fullyCompleted || !!result.alreadyComplete,
          completedSubtasks: result.completedSubtasks,
          subtaskCount: result.subtaskCount,
          periodKey,
          assignedByUid: task.assignedByUserId,
          taskTitle: task.title,
          completedByName: user?.profile?.displayName || user?.displayName || 'Arkadaşın',
          isNewlyCompleted,
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
        const periodKey = getPeriodKey(task.period, new Date());
        await syncCompletionStatusToFirestore(result.firestoreAssignmentId, {
          isCompleted: false,
          completedSubtasks: result.completedSubtasks,
          subtaskCount: result.subtaskCount,
          periodKey,
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
            onClick={() => {
              if (isGuest) {
                setShowRestrictedModal(true);
              } else {
                navigate('/assigned-by-me');
              }
            }}
            title="Atadığım Görevler"
          >
            <Send size={18} />
          </button>
          <button
            type="button"
            className="tasks-list-page__add-button"
            onClick={() => {
              const totalCount = sections.reduce((acc, s) => acc + s.data.length, 0);
              if (isGuest && totalCount >= 10) {
                setShowLimitModal(true);
              } else {
                navigate('/tasks/new');
              }
            }}
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

      {/* Bildirim Banner'ları */}
      {(pendingAssigned.length > 0 || deletionNotices.length > 0) && (
        <div className="tasks-list-page__banners">
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

          {deletionNotices.map((notice) => (
            <div key={notice.id} className="tasks-list-page__deletion-banner">
              <AlertCircle size={18} className="tasks-list-page__deletion-banner-icon" />
              <span className="tasks-list-page__deletion-banner-text">
                {notice.deletedByName || 'Arkadaşın'}, gönderdiğin &apos;{notice.taskTitle}&apos; görevini sildi.
              </span>
              <button
                type="button"
                className="tasks-list-page__deletion-banner-close"
                onClick={() => dismissTaskDeletionNotice(notice.id)}
                title="Bildirimi Kapat"
                aria-label="Bildirimi Kapat"
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
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

      <GuestRestrictedModal
        open={showRestrictedModal}
        onClose={() => setShowRestrictedModal(false)}
        title="Atadığım Görevler Kayıtlı Kullanıcılara Özeldir"
        description="Arkadaşlarına görev atamak ve onların ilerlemesini takip etmek için ücretsiz bir hesap oluşturabilirsin."
      />

      <GuestLimitModal
        open={showLimitModal}
        onClose={() => setShowLimitModal(false)}
        type="task"
      />
    </div>
  );
}
