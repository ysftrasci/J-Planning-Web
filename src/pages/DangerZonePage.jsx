import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ShieldCheck, AlertTriangle } from 'lucide-react';
import { getActiveTasks, getTaskRecords } from '../db/taskRepository.js';
import { calculateCompletionStats } from '../utils/streak.js';
import EmptyState from '../components/EmptyState.jsx';
import './DangerZonePage.css';

const DANGER_ZONE_SUCCESS_THRESHOLD = 75; // %

function formatDangerZoneStats(item) {
  const { task, total, successCount, rate } = item;
  if (task.period === 'DAILY') {
    return `${total} gün içinde ${successCount} kez tamamlandı (%${rate} başarı)`;
  }
  if (task.period === 'WEEKLY') {
    return `${total} haftada ${successCount} kez tamamlandı (%${rate} başarı)`;
  }
  if (task.period === 'MONTHLY') {
    return `${total} ayda ${successCount} kez tamamlandı (%${rate} başarı)`;
  }
  return `${total} periyotta ${successCount} kez tamamlandı (%${rate} başarı)`;
}

export default function DangerZonePage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);

  useEffect(() => {
    let mounted = true;
    async function loadDangerData() {
      try {
        const tasks = (await getActiveTasks()) || [];
        const taskDataList = await Promise.all(
          tasks.map(async (task) => {
            const records = (await getTaskRecords(task.id)) || [];
            const stats = calculateCompletionStats(records);
            return { task, ...stats };
          })
        );
        const data = taskDataList
          .filter((r) => r.total > 0 && r.rate < DANGER_ZONE_SUCCESS_THRESHOLD)
          .sort((a, b) => a.rate - b.rate);
        if (mounted) setRows(data);
      } catch (err) {
        console.error('Tehlikeli alan verisi yüklenirken hata:', err);
      }
    }
    loadDangerData();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="danger-zone-page">
      <button
        type="button"
        className="danger-zone-page__back"
        onClick={() => navigate('/')}
      >
        <ChevronLeft size={18} />
        Görevlerim
      </button>

      <h1>Tehlikeli Alan</h1>

      <p className="danger-zone-page__intro">
        Başarı oranı %{DANGER_ZONE_SUCCESS_THRESHOLD}'in altında olan görevler burada listelenir. Görevler ana listeden kaldırılmaz, sadece burada ayrıca vurgulanır.
      </p>

      {rows.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="Harika gidiyorsun!"
          subtitle="Henüz sık başarısız olduğun bir görev yok."
        />
      ) : (
        <div className="danger-zone-page__list">
          {rows.map((item) => (
            <div key={item.task.id} className="danger-zone-page__card card">
              <div className="danger-zone-page__header-row">
                <AlertTriangle size={18} color="var(--color-danger)" />
                <span className="danger-zone-page__task-title">{item.task.title}</span>
              </div>
              <span className="danger-zone-page__rate">
                {formatDangerZoneStats(item)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
