// J-Planning — Görevlerim Sayfası (Web)
// Mobildeki src/screens/TasksListScreen.js dosyasının web karşılığı.
//
// NOT (Aşama 3 -> Aşama 5 sınırı): Mobil ekranda arkadaş atama bildirimleri
// (services/friendService, taskAssignmentService) ve "Attıklarım" ekranı var.
// Bu servisler henüz web'e taşınmadı, bu yüzden burada arayüz (buton, olası
// bildirim alanı) hazır tutuluyor ama gerçek veri her zaman boş dönüyor —
// Aşama 5'te services/ dosyaları eklenince burada sadece state kaynağı
// değişecek, arayüze dokunmaya gerek kalmayacak.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Send, Plus, CheckCircle2, ChevronRight, Tags } from 'lucide-react';
import {
  getActiveTasks,
  getCurrentPeriodStatus,
  completeSubtask,
  uncompleteSubtask,
  processExpiredPeriods,
  getTaskRecords,
} from '../db/taskRepository';
import { getCategories } from '../db/categoryRepository';
import { calculateCurrentStreak } from '../utils/streak';
import TaskCard from '../components/TaskCard.jsx';
import EmptyState from '../components/EmptyState.jsx';
import './TasksListPage.css';

// Aşama 5'e kadar her zaman boş: arkadaştan bana bekleyen görev ataması yok.
const PENDING_ASSIGNED_PLACEHOLDER = [];

export default function TasksListPage() {
  const navigate = useNavigate();
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  const load = useCallback(() => {
    processExpiredPeriods();

    const tasks = getActiveTasks();
    const categories = getCategories();
    const categoryMap = new Map(categories.map((c) => [c.id, c]));
    const grouped = new Map();

    tasks.forEach((task) => {
      // Arkadaşıma attığım görevler (SENT) burada gösterilmez — kendi görev
      // listem sadece benim yapmam gereken görevleri içerir.
      if (task.assignmentDirection === 'SENT') return;

      const records = getTaskRecords(task.id);
      const { status, completedSubtasks } = getCurrentPeriodStatus(task);
      const streak = calculateCurrentStreak(task, records);
      const item = { task, status, completedSubtasks, streak };

      const categoryName = task.categoryId && categoryMap.has(task.categoryId)
        ? categoryMap.get(task.categoryId).name
        : 'Kategorisiz';

      if (!grouped.has(categoryName)) grouped.set(categoryName, []);
      grouped.get(categoryName).push(item);
    });

    setSections(Array.from(grouped.entries()).map(([title, data]) => ({ title, data })));
    setLoading(false);
  }, []);

  useEffect(load, [load]);

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
      load();
    } catch (e) {
      showToast(e.message);
    }
  };

  const handleUncomplete = (task) => {
    try {
      uncompleteSubtask(task.id);
      load();
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
            onClick={() => showToast('Attıklarım ekranı Aşama 5\'te arkadaşlık sistemiyle birlikte açılacak.')}
            aria-label="Attıklarım"
            title="Attıklarım (Aşama 5)"
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

      {PENDING_ASSIGNED_PLACEHOLDER.length > 0 && (
        <button type="button" className="tasks-list-page__pending-banner">
          <CheckCircle2 size={18} />
          <span>{PENDING_ASSIGNED_PLACEHOLDER.length} arkadaşın sana görev atadı, onay bekliyor</span>
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
    </div>
  );
}
