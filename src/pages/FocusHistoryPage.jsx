import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Timer } from 'lucide-react';
import { getFocusSessions } from '../db/focusSessionRepository.js';
import EmptyState from '../components/EmptyState.jsx';
import './FocusHistoryPage.css';

const SOUND_LABELS = {
  none: 'Ses Yok',
  white_noise: 'Beyaz Gürültü',
  summer_night_camp: 'Yaz Gecesi Kamp',
  ocean_waves: 'Sahil / Dalga Sesi',
  rain: 'Yağmur Sesi',
  budgie: 'Muhabbet Kuşu',
  fireplace: 'Ateş / Şömine',
};

function monthKeyOf(dateStr) {
  return dateStr.slice(0, 7);
}

function monthLabelOf(monthKey) {
  if (!monthKey) return '';
  const d = new Date(`${monthKey}-01T12:00:00`);
  return d.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
}

function formatSessionDate(timestamp) {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export default function FocusHistoryPage() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState([]);
  const [selectedMonthKey, setSelectedMonthKey] = useState(null);

  useEffect(() => {
    let mounted = true;
    getFocusSessions()
      .then((list) => {
        if (mounted) setSessions(list || []);
      })
      .catch((err) => console.error('Odaklanma geçmişi yüklenemedi:', err));
    return () => {
      mounted = false;
    };
  }, []);

  const availableMonths = useMemo(() => {
    const months = new Set(
      sessions.map((s) => monthKeyOf(new Date(s.completedAt).toISOString()))
    );
    return Array.from(months).sort().reverse();
  }, [sessions]);

  const effectiveMonthKey = selectedMonthKey || availableMonths[0];

  const filteredSessions = useMemo(() => {
    if (!effectiveMonthKey) return [];
    return sessions.filter(
      (s) => monthKeyOf(new Date(s.completedAt).toISOString()) === effectiveMonthKey
    );
  }, [sessions, effectiveMonthKey]);

  const monthTotalMinutes = filteredSessions.reduce((sum, s) => sum + s.durationMinutes, 0);
  const monthTotalJP = filteredSessions.reduce((sum, s) => sum + (s.jpEarned || 0), 0);

  const currentMonthIndex = availableMonths.indexOf(effectiveMonthKey);
  const canGoOlder = currentMonthIndex < availableMonths.length - 1;
  const canGoNewer = currentMonthIndex > 0;

  const goOlderMonth = () => {
    if (canGoOlder) setSelectedMonthKey(availableMonths[currentMonthIndex + 1]);
  };
  const goNewerMonth = () => {
    if (canGoNewer) setSelectedMonthKey(availableMonths[currentMonthIndex - 1]);
  };

  return (
    <div className="focus-history-page">
      <button
        type="button"
        className="focus-history-page__back"
        onClick={() => navigate('/focus')}
      >
        <ChevronLeft size={18} />
        Odaklanma
      </button>

      <h1>Odaklanma Geçmişi</h1>

      {availableMonths.length > 0 && (
        <>
          <div className="focus-history-page__month-selector">
            <button
              type="button"
              className="focus-history-page__month-nav"
              onClick={goOlderMonth}
              disabled={!canGoOlder}
            >
              <ChevronLeft size={20} />
            </button>
            <span className="focus-history-page__month-label">
              {monthLabelOf(effectiveMonthKey)}
            </span>
            <button
              type="button"
              className="focus-history-page__month-nav"
              onClick={goNewerMonth}
              disabled={!canGoNewer}
            >
              <ChevronRight size={20} />
            </button>
          </div>

          <div className="focus-history-page__summary-row">
            <div className="focus-history-page__stat-card">
              <span className="focus-history-page__stat-val">{filteredSessions.length}</span>
              <span className="focus-history-page__stat-lbl">Seans</span>
            </div>
            <div className="focus-history-page__stat-card">
              <span className="focus-history-page__stat-val">{monthTotalMinutes}</span>
              <span className="focus-history-page__stat-lbl">Dakika</span>
            </div>
            <div className="focus-history-page__stat-card">
              <span className="focus-history-page__stat-val">{monthTotalJP}</span>
              <span className="focus-history-page__stat-lbl">JP Kazanıldı</span>
            </div>
          </div>
        </>
      )}

      {filteredSessions.length === 0 ? (
        <EmptyState
          icon={Timer}
          title="Henüz odaklanma seansı yok"
          subtitle="Bir seansı tamamladığında burada görünecek"
        />
      ) : (
        <div className="focus-history-page__list">
          {filteredSessions.map((item) => (
            <div key={item.id} className="focus-history-page__card">
              <div className="focus-history-page__icon-wrap">
                <Timer size={18} color="var(--color-accent-dark)" />
              </div>
              <div className="focus-history-page__info">
                <span className="focus-history-page__date">
                  {formatSessionDate(item.completedAt)}
                </span>
                <span className="focus-history-page__meta">
                  {item.durationMinutes} dk • {SOUND_LABELS[item.soundKey] || 'Ses Yok'}
                </span>
              </div>
              {item.jpEarned > 0 && (
                <span className="focus-history-page__jp">+{item.jpEarned} JP</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
