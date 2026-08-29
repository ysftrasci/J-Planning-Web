import { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, BookOpen, Clock, Calendar, Pencil, Trash2 } from 'lucide-react';
import { getDailyNote, saveDailyNote, deleteDailyNote, getDailyNotesByMonth, getAllDailyNoteMonths } from '../db/dailyNoteRepository';
import { toDateStr } from '../utils/period';
import AppModal from '../components/AppModal.jsx';
import AppButton from '../components/AppButton.jsx';
import './DailyNotesPage.css';

function monthLabelOf(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  const label = d.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function formatDateLabel(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d);
  return dateObj.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' });
}

export default function DailyNotesPage() {
  const navigate = useNavigate();
  const todayKey = useMemo(() => toDateStr(new Date()), []);
  const todayMonthKey = useMemo(() => todayKey.slice(0, 7), [todayKey]);

  const [availableMonths, setAvailableMonths] = useState([]);
  const [selectedMonthKey, setSelectedMonthKey] = useState(todayMonthKey);
  const [todayNoteText, setTodayNoteText] = useState('');
  const [todayStudyTimeText, setTodayStudyTimeText] = useState('');
  const [monthNotes, setMonthNotes] = useState([]);
  const [editingDateKey, setEditingDateKey] = useState(null);
  const [editingText, setEditingText] = useState('');
  const [editingStudyTimeText, setEditingStudyTimeText] = useState('');
  const [dateKeyToDelete, setDateKeyToDelete] = useState(null);

  const loadData = useCallback(async (targetMonthKey) => {
    try {
      const activeMonth = targetMonthKey || selectedMonthKey || todayMonthKey;
      const months = await getAllDailyNoteMonths();
      if (!months.includes(todayMonthKey)) {
        months.unshift(todayMonthKey);
      }
      setAvailableMonths(months);
      
      const currentToday = await getDailyNote(todayKey);
      setTodayNoteText(currentToday?.content || '');
      setTodayStudyTimeText(currentToday?.studyTimeText || '');

      const notes = await getDailyNotesByMonth(activeMonth);
      setMonthNotes(notes || []);
    } catch (e) {
      console.error('Günlük notlar yüklenirken hata:', e);
    }
  }, [selectedMonthKey, todayKey, todayMonthKey]);

  useEffect(() => {
    loadData(selectedMonthKey);

    const handleCloudUpdate = () => {
      loadData(selectedMonthKey);
    };
    window.addEventListener('jplanning:cloud-sync-update', handleCloudUpdate);
    return () => {
      window.removeEventListener('jplanning:cloud-sync-update', handleCloudUpdate);
    };
  }, [loadData, selectedMonthKey]);

  const handleSaveTodayNote = async (e) => {
    e?.preventDefault();
    try {
      await saveDailyNote(todayKey, todayNoteText, todayStudyTimeText);
      await loadData(selectedMonthKey);
    } catch (err) {
      console.error('Bugünün notu kaydedilemedi:', err);
    }
  };

  const handleSaveEditingNote = async (dateKey) => {
    try {
      await saveDailyNote(dateKey, editingText, editingStudyTimeText);
      setEditingDateKey(null);
      setEditingText('');
      setEditingStudyTimeText('');
      await loadData(selectedMonthKey);
    } catch (err) {
      console.error('Not güncellenemedi:', err);
    }
  };

  const confirmDeleteNote = async () => {
    if (!dateKeyToDelete) return;
    const targetKey = dateKeyToDelete;
    try {
      await deleteDailyNote(targetKey);
      if (targetKey === todayKey) {
        setTodayNoteText('');
        setTodayStudyTimeText('');
      }
      setMonthNotes((prev) => prev.filter((n) => n.dateKey !== targetKey && n.id !== targetKey));
      setDateKeyToDelete(null);
      await loadData(selectedMonthKey);
    } catch (err) {
      console.error('[DailyNotes] Not silinemedi:', err);
    }
  };

  const currentMonthIndex = availableMonths.indexOf(selectedMonthKey);
  const canGoOlder = currentMonthIndex < availableMonths.length - 1;
  const canGoNewer = currentMonthIndex > 0;

  const goOlderMonth = () => {
    if (canGoOlder) {
      const nextMonth = availableMonths[currentMonthIndex + 1];
      setSelectedMonthKey(nextMonth);
      loadData(nextMonth);
    }
  };

  const goNewerMonth = () => {
    if (canGoNewer) {
      const prevMonth = availableMonths[currentMonthIndex - 1];
      setSelectedMonthKey(prevMonth);
      loadData(prevMonth);
    }
  };

  return (
    <div className="daily-notes-page">
      <button type="button" className="daily-notes-page__back" onClick={() => navigate('/')}>
        <ChevronLeft size={16} />
        Görevlerim
      </button>

      <h1 className="daily-notes-page__title">Günün Özeti</h1>
      <p className="daily-notes-page__subtitle">
        Her gün aklından geçenleri, günün özetini ve çalışma süreni burada biriktirebilirsin.
      </p>

      {/* Bugünün Özeti Kartı */}
      <div className="daily-notes-page__card">
        <div className="daily-notes-page__card-header">
          <BookOpen size={20} className="daily-notes-page__book-icon" />
          <div>
            <h3 className="daily-notes-page__card-title">Bugünün Özeti ({formatDateLabel(todayKey)})</h3>
            <p className="daily-notes-page__card-subtitle">Gününüzü değerlendirin, çalışma sürenizi ve notlarınızı yazın</p>
          </div>
        </div>

        <div className="daily-notes-page__field">
          <label className="daily-notes-page__field-label">
            <Clock size={16} />
            <span>Bugün Kaç Saat Çalıştınız? (opsiyonel)</span>
          </label>
          <input
            type="text"
            className="daily-notes-page__input"
            placeholder="ör. 2 saat 30 dakika, 45 dk..."
            value={todayStudyTimeText}
            onChange={(e) => setTodayStudyTimeText(e.target.value)}
          />
        </div>

        <div className="daily-notes-page__field">
          <div className="daily-notes-page__label-row">
            <label className="daily-notes-page__field-label">Günün Notu / Özeti (opsiyonel)</label>
            <span className="daily-notes-page__char-counter">{todayNoteText.length} / 1000</span>
          </div>
          <textarea
            className="daily-notes-page__textarea"
            placeholder="Bugün nasıl geçti? Aklındakileri ve günün özetini buraya yaz..."
            maxLength={1000}
            rows={4}
            value={todayNoteText}
            onChange={(e) => setTodayNoteText(e.target.value)}
          />
        </div>

        <button
          type="button"
          className="daily-notes-page__save-btn"
          onClick={handleSaveTodayNote}
        >
          Kaydet
        </button>
      </div>

      {/* Aylık Özet Geçmişi Başlığı */}
      <div className="daily-notes-page__history-header">
        <h2 className="daily-notes-page__history-title">Aylık Özet Geçmişi</h2>
        <div className="daily-notes-page__month-selector">
          <button type="button" className="daily-notes-page__month-nav-btn" onClick={goOlderMonth} aria-label="Önceki Ay">
            <ChevronLeft size={16} />
          </button>
          <span className="daily-notes-page__month-name">{monthLabelOf(selectedMonthKey)}</span>
          <button type="button" className="daily-notes-page__month-nav-btn" onClick={goNewerMonth} aria-label="Sonraki Ay">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Ayın Notları */}
      {monthNotes.length === 0 ? (
        <div className="daily-notes-page__empty-text">Bu Ayda Özet Bulunmuyor</div>
      ) : (
        <div className="daily-notes-page__notes-list">
          {monthNotes.map((note) => (
            <div key={note.id} className="daily-notes-page__note-item">
              <div className="daily-notes-page__note-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Calendar size={16} className="daily-notes-page__book-icon" />
                  <span className="daily-notes-page__note-date">{formatDateLabel(note.dateKey)}</span>
                </div>
                {note.studyTimeText && (
                  <span className="daily-notes-page__study-badge">
                    <Clock size={13} /> {note.studyTimeText}
                  </span>
                )}
              </div>
              {note.content && <p className="daily-notes-page__note-content">{note.content}</p>}
              <div className="daily-notes-page__note-actions">
                <button
                  type="button"
                  className="daily-notes-page__small-btn"
                  onClick={() => {
                    setEditingDateKey(note.dateKey);
                    setEditingText(note.content || '');
                    setEditingStudyTimeText(note.studyTimeText || '');
                  }}
                >
                  <Pencil size={12} /> Düzenle
                </button>
                <button
                  type="button"
                  className="daily-notes-page__small-btn daily-notes-page__small-btn--danger"
                  onClick={() => setDateKeyToDelete(note.dateKey)}
                >
                  <Trash2 size={12} /> Sil
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Silme Onay Modalı */}
      {dateKeyToDelete && (
        <AppModal
          open={!!dateKeyToDelete}
          onClose={() => setDateKeyToDelete(null)}
          title="Notu Sil"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '8px 0' }}>
            <p style={{ margin: 0, fontSize: '14px', lineHeight: 1.5 }}>
              {dateKeyToDelete ? formatDateLabel(dateKeyToDelete) : ''} tarihli notu silmek istiyor musunuz?
            </p>
            <div style={{ display: 'flex', gap: '12px' }}>
              <AppButton title="Vazgeç" variant="secondary" onClick={() => setDateKeyToDelete(null)} />
              <AppButton title="Sil" variant="danger" onClick={confirmDeleteNote} />
            </div>
          </div>
        </AppModal>
      )}
    </div>
  );
}
