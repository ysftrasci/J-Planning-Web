import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ShieldCheck, AlertTriangle } from 'lucide-react';
import { getActiveTasks, getTaskRecords } from '../db/taskRepository.js';
import EmptyState from '../components/EmptyState.jsx';
import './DangerZonePage.css';

const DANGER_ZONE_THRESHOLD = 25; // %

export default function DangerZonePage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);

  useEffect(() => {
    const tasks = getActiveTasks();
    const data = tasks
      .map((task) => {
        const records = getTaskRecords(task.id);
        const total = records.length;
        const failed = records.filter((r) => r.status === 'FAILED').length;
        const rate = total > 0 ? Math.round((failed / total) * 100) : 0;
        return { task, failed, total, rate };
      })
      .filter((r) => r.rate >= DANGER_ZONE_THRESHOLD)
      .sort((a, b) => b.rate - a.rate);
    setRows(data);
  }, []);

  return (
    <div className="danger-zone-page">
      <button
        type="button"
        className="danger-zone-page__back"
        onClick={() => navigate('/profile')}
      >
        <ChevronLeft size={18} />
        Profil
      </button>

      <h1>Tehlikeli Alan</h1>

      <p className="danger-zone-page__intro">
        Başarısızlık oranı %{DANGER_ZONE_THRESHOLD} ve üzerinde olan görevler burada listelenir. Görevler ana listeden kaldırılmaz, sadece burada ayrıca vurgulanır.
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
                {item.failed}/{item.total} başarısız (%{item.rate})
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
