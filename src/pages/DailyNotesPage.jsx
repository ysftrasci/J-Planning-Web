import { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp, BookOpen, Save, Calendar, CheckCircle2, Clock, Pencil, Trash2 } from 'lucide-react';
import { getDailyNote, saveDailyNote, deleteDailyNote, getDailyNotesByMonth, getAllDailyNoteMonths } from '../db/dailyNoteRepository';
import { toDateStr } from '../utils/period';
import AppButton from '../components/AppButton.jsx';
import AppModal from '../components/AppModal.jsx';
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
  const [todayStudyTimeText, setTodayStudyTimeText] = useState('');
  const [todaySaved, setTodaySaved] = useState(false);
  const [monthNotes, setMonthNotes] = useState([]);
  const [expandedDateKeys, setExpandedDateKeys] = useState(new Set());
  const [editingDateKey, setEditingDateKey] = useState(null);
  const [editingText, setEditingText] = useState('');
  const [editingStudyTimeText, setEditingStudyTimeText] = useState('');
  const [dateKeyToDelete, setDateKeyToDelete] = useState(null);

  const loadData = useCallback(() => {
    const months = getAllDailyNoteMonths();
    setAvailableMonths(months);
    if (!months.includes(selectedMonthKey)) {
      setSelectedMonthKey(months[0] || todayMonthKey);
    }
    const currentToday = getDailyNote(todayKey);
    setTodayNoteText(currentToday?.content || '');
    setTodayStudyTimeText(currentToday?.studyTimeText || '');

    const notes = getDailyNotesByMonth(selectedMonthKey);
    setMonthNotes(notes);
  }, [selectedMonthKey, todayKey, todayMonthKey]);

  useEffect(() => {
    loadData();

    const handleCloudUpdate = () => {
      loadData();
    };
    window.addEventListener('jplanning:cloud-sync-update', handleCloudUpdate);
    return () => {
      window.removeEventListener('jplanning:cloud-sync-update', handleCloudUpdate);
    };
  }, [loadData]);

  const toggleExpand = (dateKey) => {
    setExpandedDateKeys((prev) => {
      const next = new Set(prev);
      if (next.has(dateKey)) next.delete(dateKey);
      else next.add(dateKey);
      return next;
    });
  };

  const handleSaveTodayNote = (e) => {
    e?.preventDefault();
    saveDailyNote(todayKey, todayNoteText, todayStudyTimeText);
    setTodaySaved(true);
    setTimeout(() => setTodaySaved(false), 2500);
    loadData();
  };

  const handleSaveEditingNote = (dateKey) => {
    saveDailyNote(dateKey, editingText, editingStudyTimeText);
    setEditingDateKey(null);
    setEditingText('');
    setEditingStudyTimeText('');
    loadData();
  };

  const confirmDeleteNote = () => {
    if (!dateKeyToDelete) return;
    deleteDailyNote(dateKeyToDelete);
    if (dateKeyToDelete === todayKey) {
      setTodayNoteText('');
      setTodayStudyTimeText('');
    }
    setDateKeyToDelete(null);
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
        <h1>Günün Özeti</h1>
        <p className="caption">Her gün aklından geçenleri, günün özetini ve çalışma süreni burada biriktirebilirsin.</p>
      </div>

      {/* Bugünün Özeti Yazma Kartı */}
      <div className="daily-notes-page__card daily-notes-page__card--today">
        <div className="daily-notes-page__card-header">
          <BookOpen size={20} className="daily-notes-page__icon" />
          <div>
            <h3>Bugünün Özeti ({formatDateLabel(todayKey)})</h3>
            <span className="daily-notes-page__sub">Gününüzü değerlendirin, çalışma sürenizi ve notlarınızı yazın</span>
          </div>
        </div>
        <form onSubmit={handleSaveTodayNote}>
          <label className="daily-notes-page__input-label" htmlFor="today-study-time">
            <Clock size={16} /> Bugün Kaç Saat Çalıştınız? (opsiyonel)
          </label>
          <input
            id="today-study-time"
            type="text"
            className="daily-notes-page__input"
            maxLength={50}
            placeholder="ör. 2 saat 30 dakika, 45 dk..."
            value={todayStudyTimeText}
            onChange={(e) => setTodayStudyTimeText(e.target.value)}
          />

          <div className="daily-notes-page__label-row">
            <label className="daily-notes-page__input-label" htmlFor="today-summary">
              Günün Notu / Özeti (opsiyonel)
            </label>
            <span className="daily-notes-page__char-count">{todayNoteText.length} / 1000</span>
          </div>
          <textarea
            id="today-summary"
            className="daily-notes-page__textarea"
            maxLength={1000}
            placeholder="Bugün nasıl geçti? Aklındakileri ve günün özetini buraya yaz..."
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

      {/* Aylık Özet Listesi Seçici */}
      <div className="daily-notes-page__month-bar">
        <h2>Aylık Özet Geçmişi</h2>
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

      {/* Aylık Özetler Listesi */}
      <div className="daily-notes-page__notes-list">
        {monthNotes.length === 0 ? (
          <EmptyState
            title="Bu Ayda Özet Bulunmuyor"
            description="Bu ay için kaydedilmiş herhangi bir günün özeti yok. Yukarıdan bugünün özetini ekleyebilirsiniz."
          />
        ) : (
          monthNotes.map((note) => {
            const isEditing = editingDateKey === note.dateKey;
            const isExpanded = expandedDateKeys.has(note.dateKey);

            return (
              <div key={note.id} className={`daily-notes-page__note-item ${isExpanded ? 'daily-notes-page__note-item--expanded' : ''}`}>
                <div
                  className="daily-notes-page__note-header"
                  onClick={() => !isEditing && toggleExpand(note.dateKey)}
                  style={{ cursor: isEditing ? 'default' : 'pointer' }}
                >
                  <div className="daily-notes-page__note-date">
                    <Calendar size={16} />
                    <span>{formatDateLabel(note.dateKey)}</span>
                    {note.studyTimeText && !isEditing && (
                      <span className="daily-notes-page__study-badge">
                        <Clock size={13} /> {note.studyTimeText}
                      </span>
                    )}
                  </div>
                  {!isEditing && (
                    <div className="daily-notes-page__header-actions">
                      <button
                        type="button"
                        className="daily-notes-page__edit-icon-btn"
                        title="Günü Düzenle"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingDateKey(note.dateKey);
                          setEditingText(note.content || '');
                          setEditingStudyTimeText(note.studyTimeText || '');
                          setExpandedDateKeys((prev) => new Set(prev).add(note.dateKey));
                        }}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        className="daily-notes-page__delete-icon-btn"
                        title="Günün Özetini Sil"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDateKeyToDelete(note.dateKey);
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                      <span className="daily-notes-page__expand-icon">
                        {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                      </span>
                    </div>
                  )}
                </div>

                {/* Katlanmış Halde Kısa Önizleme */}
                {!isExpanded && !isEditing && note.content && (
                  <p
                    className="daily-notes-page__note-preview"
                    onClick={() => toggleExpand(note.dateKey)}
                  >
                    {note.content.length > 80 ? `${note.content.slice(0, 80)}...` : note.content}
                  </p>
                )}

                {/* Genişletilmiş Gövde veya Düzenleme Modu */}
                {isEditing ? (
                  <div className="daily-notes-page__edit-box">
                    <label className="daily-notes-page__input-label">
                      <Clock size={15} /> Çalışma Süresi (opsiyonel)
                    </label>
                    <input
                      type="text"
                      className="daily-notes-page__input"
                      maxLength={50}
                      value={editingStudyTimeText}
                      onChange={(e) => setEditingStudyTimeText(e.target.value)}
                      placeholder="ör. 2 saat 30 dakika"
                    />

                    <div className="daily-notes-page__label-row">
                      <label className="daily-notes-page__input-label">Günün Özeti</label>
                      <span className="daily-notes-page__char-count">{editingText.length} / 1000</span>
                    </div>
                    <textarea
                      className="daily-notes-page__textarea"
                      maxLength={1000}
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      rows={4}
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
                  isExpanded && (
                    <div className="daily-notes-page__expanded-body">
                      {note.content ? (
                        <p className="daily-notes-page__note-content">{note.content}</p>
                      ) : (
                        <p className="daily-notes-page__empty-body-text">Bu gün için herhangi bir özet metni yazılmadı.</p>
                      )}
                    </div>
                  )
                )}
              </div>
            );
          })
        )}
      </div>

      <AppModal open={!!dateKeyToDelete} onClose={() => setDateKeyToDelete(null)} title="Günün Özetini Sil">
        <p className="caption">
          {dateKeyToDelete && formatDateLabel(dateKeyToDelete)} tarihli günün özetini silmek istediğinize emin misiniz?
        </p>
        <div className="daily-notes-page__modal-actions" style={{ display: 'flex', gap: 'var(--space-md)', justifyContent: 'flex-end', marginTop: 'var(--space-md)' }}>
          <AppButton title="Vazgeç" variant="ghost" onClick={() => setDateKeyToDelete(null)} />
          <AppButton title="Sil" variant="danger" onClick={confirmDeleteNote} />
        </div>
      </AppModal>
    </div>
  );
}
