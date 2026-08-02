import { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, BookOpen, Save, Calendar, CheckCircle2 } from 'lucide-react';
import { getDailyNote, saveDailyNote, getDailyNotesByMonth, getAllDailyNoteMonths } from '../db/dailyNoteRepository';
import { toDateStr } from '../utils/period';
import AppButton from '../components/AppButton.jsx';
import EmptyState from '../components/EmptyState.jsx';
import './DailyNotesPage.css';

function monthLabelOf(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
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
  const [todaySaved, setTodaySaved] = useState(false);
  const [monthNotes, setMonthNotes] = useState([]);
  const [editingDateKey, setEditingDateKey] = useState(null);
  const [editingText, setEditingText] = useState('');

  const loadData = useCallback(() => {
    const months = getAllDailyNoteMonths();
    setAvailableMonths(months);
    if (!months.includes(selectedMonthKey)) {
      setSelectedMonthKey(months[0] || todayMonthKey);
    }
    const currentToday = getDailyNote(todayKey);
    setTodayNoteText(currentToday?.content || '');

    const notes = getDailyNotesByMonth(selectedMonthKey);
    setMonthNotes(notes);
  }, [selectedMonthKey, todayKey, todayMonthKey]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSaveTodayNote = (e) => {
    e?.preventDefault();
    saveDailyNote(todayKey, todayNoteText);
    setTodaySaved(true);
    setTimeout(() => setTodaySaved(false), 2500);
    loadData();
  };

  const handleSaveEditingNote = (dateKey) => {
    saveDailyNote(dateKey, editingText);
    setEditingDateKey(null);
    setEditingText('');
    loadData();
  };

  const currentMonthIndex = availableMonths.indexOf(selectedMonthKey);
  const canGoOlder = currentMonthIndex < availableMonths.length - 1;
  const canGoNewer = currentMonthIndex > 0;

  const goOlderMonth = () => {
    if (canGoOlder) setSelectedMonthKey(availableMonths[currentMonthIndex + 1]);
  };
  const goNewerMonth = () => {
    if (canGoNewer) setSelectedMonthKey(availableMonths[currentMonthIndex - 1]);
  };

  return (
    <div className="daily-notes-page">
      <button type="button" className="daily-notes-page__back" onClick={() => navigate('/')}>
        <ChevronLeft size={18} />
        Görevlerim
      </button>

      <div className="daily-notes-page__header">
        <h1>Günün Notları</h1>
        <p className="caption">Her gün aklından geçenleri ve aldığın notları burada biriktirebilirsin.</p>
      </div>

      {/* Bugünün Notu Yazma Kartı */}
      <div className="daily-notes-page__card daily-notes-page__card--today">
        <div className="daily-notes-page__card-header">
          <BookOpen size={20} className="daily-notes-page__icon" />
          <div>
            <h3>Bugünün Notu ({formatDateLabel(todayKey)})</h3>
            <span className="daily-notes-page__sub">Gününüzü değerlendirin veya düşündüklerinizi yazın</span>
          </div>
        </div>
        <form onSubmit={handleSaveTodayNote}>
          <textarea
            className="daily-notes-page__textarea"
            placeholder="Bugün nasıl geçti? Aklındakileri buraya yaz..."
            rows={4}
            value={todayNoteText}
            onChange={(e) => setTodayNoteText(e.target.value)}
          />
          <div className="daily-notes-page__card-footer">
            {todaySaved && (
              <span className="daily-notes-page__saved-msg">
                <CheckCircle2 size={16} /> Kaydedildi
              </span>
            )}
            <AppButton type="submit" title="Kaydet" icon={Save} />
          </div>
        </form>
      </div>

      {/* Aylık Not Listesi Seçici */}
      <div className="daily-notes-page__month-bar">
        <h2>Aylık Not Geçmişi</h2>
        <div className="daily-notes-page__month-nav">
          <button
            type="button"
            className="daily-notes-page__nav-btn"
            disabled={!canGoOlder}
            onClick={goOlderMonth}
            aria-label="Önceki Ay"
          >
            <ChevronLeft size={20} />
          </button>
          <span className="daily-notes-page__month-title">{monthLabelOf(selectedMonthKey)}</span>
          <button
            type="button"
            className="daily-notes-page__nav-btn"
            disabled={!canGoNewer}
            onClick={goNewerMonth}
            aria-label="Sonraki Ay"
          >
            <ChevronRight size={20} />
          </button>
        </div>
      </div>

      {/* Aylık Notlar Listesi */}
      <div className="daily-notes-page__notes-list">
        {monthNotes.length === 0 ? (
          <EmptyState
            title="Bu Ay Not Bulunmuyor"
            description="Bu ay için kaydedilmiş herhangi bir günün notu yok. Yukarıdan bugünün notunu ekleyebilirsiniz."
          />
        ) : (
          monthNotes.map((note) => {
            const isEditing = editingDateKey === note.dateKey;
            return (
              <div key={note.id} className="daily-notes-page__note-item">
                <div className="daily-notes-page__note-header">
                  <div className="daily-notes-page__note-date">
                    <Calendar size={16} />
                    <span>{formatDateLabel(note.dateKey)}</span>
                  </div>
                  {!isEditing && (
                    <button
                      type="button"
                      className="daily-notes-page__edit-btn"
                      onClick={() => {
                        setEditingDateKey(note.dateKey);
                        setEditingText(note.content);
                      }}
                    >
                      Düzenle
                    </button>
                  )}
                </div>

                {isEditing ? (
                  <div className="daily-notes-page__edit-box">
                    <textarea
                      className="daily-notes-page__textarea"
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      rows={3}
                    />
                    <div className="daily-notes-page__edit-actions">
                      <button
                        type="button"
                        className="daily-notes-page__cancel-btn"
                        onClick={() => setEditingDateKey(null)}
                      >
                        Vazgeç
                      </button>
                      <AppButton title="Güncelle" onClick={() => handleSaveEditingNote(note.dateKey)} />
                    </div>
                  </div>
                ) : (
                  <p className="daily-notes-page__note-content">{note.content}</p>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
