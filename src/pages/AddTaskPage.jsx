import { useEffect, useState } from 'react';
import { X, Plus, ChevronDown, ChevronUp, Minus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { createTask, getActiveTasks } from '../db/taskRepository';
import { getCategories } from '../db/categoryRepository';
import { useAuth } from '../context/AuthContext.jsx';
import { listenFriends } from '../services/friendService';
import { assignTaskToFriend } from '../services/taskAssignmentService';
import { formatPeriodFrequency } from '../utils/period';
import GuestLimitModal from '../components/GuestLimitModal.jsx';
import './AddTaskPage.css';

const PRIORITIES = [
  { key: 'HIGH', label: 'Yüksek (5 JP)' },
  { key: 'MEDIUM', label: 'Orta (3 JP)' },
  { key: 'LOW', label: 'Düşük (1 JP)' },
  { key: 'ZERO', label: '0 JP (0 JP)' },
];

const DIFFICULTIES = [
  { key: 'EASY', label: 'Kolay (1 JP)' },
  { key: 'MEDIUM', label: 'Orta (2 JP)' },
  { key: 'HARD', label: 'Zor (3 JP)' },
  { key: 'ZERO', label: '0 JP (0 JP)' },
];

const PERIODS = [
  { key: 'DAILY', label: 'Gün' },
  { key: 'WEEKLY', label: 'Hafta' },
  { key: 'MONTHLY', label: 'Ay' },
  { key: 'ONCE', label: 'Tek Seferlik' },
];

const LIMITS = {
  DAILY: { maxInterval: 30, maxSubtasks: 3, unitSingular: 'gün', unitPlural: 'günde' },
  WEEKLY: { maxInterval: 12, maxSubtasks: 14, unitSingular: 'hafta', unitPlural: 'haftada' },
  MONTHLY: { maxInterval: 6, maxSubtasks: 60, unitSingular: 'ay', unitPlural: 'ayda' },
};

export default function AddTaskPage() {
  const { user, isGuest } = useAuth();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [period, setPeriod] = useState('DAILY');
  const [intervalValue, setIntervalValue] = useState(1);
  const [subtaskCount, setSubtaskCount] = useState(1);
  const [subtaskLabels, setSubtaskLabels] = useState(['']);
  const [showCustomLabels, setShowCustomLabels] = useState(false);
  const [categoryId, setCategoryId] = useState(null);
  const [assignTo, setAssignTo] = useState('me'); // 'me' | friendUid
  const [categories, setCategories] = useState([]);
  const [friends, setFriends] = useState([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [showLimitModal, setShowLimitModal] = useState(false);

  useEffect(() => {
    let mounted = true;
    getCategories()
      .then((cats) => {
        if (mounted) setCategories(cats || []);
      })
      .catch((err) => console.error('Kategoriler yüklenemedi:', err));
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!user || isGuest || !user.emailVerified) return;
    const unsub = listenFriends(user.uid, setFriends);
    return unsub;
  }, [user, isGuest]);

  const isOnce = period === 'ONCE';
  const currentLimits = LIMITS[period] || LIMITS.DAILY;

  const handlePeriodChange = (newPeriod) => {
    setPeriod(newPeriod);
    setPriority('MEDIUM');
    if (newPeriod === 'ONCE') {
      setIntervalValue(1);
      setSubtaskCount(1);
      setSubtaskLabels(['']);
    } else {
      const nextLimit = LIMITS[newPeriod];
      if (intervalValue > nextLimit.maxInterval) {
        setIntervalValue(nextLimit.maxInterval);
      }
      if (subtaskCount > nextLimit.maxSubtasks) {
        setSubtaskCount(nextLimit.maxSubtasks);
        syncLabelsToCount(nextLimit.maxSubtasks);
      }
    }
  };

  const handleIntervalChange = (val) => {
    const num = parseInt(val, 10) || 1;
    const clamped = Math.max(1, Math.min(currentLimits.maxInterval, num));
    setIntervalValue(clamped);
  };

  const syncLabelsToCount = (newCount) => {
    setSubtaskLabels((prev) => {
      const arr = [...prev];
      if (newCount > arr.length) {
        while (arr.length < newCount) arr.push('');
      } else if (newCount < arr.length) {
        arr.length = newCount;
      }
      return arr;
    });
  };

  const handleSubtaskCountChange = (val) => {
    const num = parseInt(val, 10) || 1;
    const clamped = Math.max(1, Math.min(currentLimits.maxSubtasks, num));
    setSubtaskCount(clamped);
    syncLabelsToCount(clamped);
  };

  const updateSubtaskLabel = (index, value) => {
    setSubtaskLabels((prev) => prev.map((l, i) => (i === index ? value : l)));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setErrorMessage('');

    if (!title.trim()) {
      setErrorMessage('Lütfen bir görev adı gir.');
      return;
    }

    if (isGuest) {
      try {
        const currentTasks = await getActiveTasks();
        if (currentTasks && currentTasks.length >= 10) {
          setShowLimitModal(true);
          return;
        }
      } catch (_) {}
    }

    const effectiveInterval = isOnce ? 1 : intervalValue;
    const effectiveCount = isOnce ? 1 : subtaskCount;
    const effectiveLabels = isOnce ? [''] : subtaskLabels.slice(0, effectiveCount);

    if (assignTo === 'me') {
      try {
        setSaving(true);
        await createTask({
          title: title.trim(),
          description: description ? description.trim() : '',
          categoryId,
          priority,
          period,
          intervalValue: effectiveInterval,
          subtaskCount: effectiveCount,
          subtaskLabels: effectiveLabels,
        });
        navigate('/');
      } catch (err) {
        console.error('Görev kaydetme hatası:', err);
        setErrorMessage(err.message || 'Görev kaydedilemedi.');
      } finally {
        setSaving(false);
      }
      return;
    }

    const friend = friends.find((f) => f.friendUid === assignTo);
    setSaving(true);
    try {
      await assignTaskToFriend({
        assignedByUid: user.uid,
        assignedByName: user.profile?.displayName || user.displayName || 'Arkadaşın',
        assignedToUid: assignTo,
        assignedToName: friend?.friendName || 'Arkadaş',
        title: title.trim(),
        description: description ? description.trim() : '',
        period,
        intervalValue: effectiveInterval,
        priority,
        subtaskCount: effectiveCount,
        subtaskLabels: effectiveLabels,
      });
      navigate('/assigned-by-me');
    } catch (err) {
      console.error('Arkadaşa görev atama hatası:', err);
      setErrorMessage(err.message || 'Görev atanamadı.');
    } finally {
      setSaving(false);
    }
  };

  const priorityOptions = isOnce ? DIFFICULTIES : PRIORITIES;

  return (
    <div className="add-task-page">
      {errorMessage && <p className="add-task-page__error">{errorMessage}</p>}

      <form className="add-task-page__form" onSubmit={handleSave}>
        {/* Görev Adı */}
        <label className="add-task-page__label" htmlFor="task-title">Görev Adı</label>
        <input
          id="task-title"
          className="add-task-page__input"
          type="text"
          placeholder="örn. Su iç, spor yap..."
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />

        {/* Not / Açıklama */}
        <label className="add-task-page__label" htmlFor="task-desc">Not / Açıklama (opsiyonel)</label>
        <input
          id="task-desc"
          className="add-task-page__input"
          type="text"
          placeholder="örn. Sayfa 45-60 arası okunacak"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        {/* Kime atanacak? (Misafirde gizlenir) */}
        {!isGuest && (
          <>
            <label className="add-task-page__label">Kime atanacak?</label>
            <div className="add-task-page__chip-row">
              <button
                type="button"
                className={`add-task-page__chip ${assignTo === 'me' ? 'add-task-page__chip--selected' : ''}`}
                onClick={() => setAssignTo('me')}
              >
                Kendime
              </button>
              {friends.map((f) => (
                <button
                  key={f.friendUid}
                  type="button"
                  className={`add-task-page__chip ${assignTo === f.friendUid ? 'add-task-page__chip--selected' : ''}`}
                  onClick={() => setAssignTo(f.friendUid)}
                >
                  {f.friendName}
                </button>
              ))}
            </div>
          </>
        )}

        {/* Periyot Seçimi */}
        <label className="add-task-page__label">Tekrar Sıklığı (Periyot)</label>
        <div className="add-task-page__chip-row">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={`add-task-page__chip ${period === p.key ? 'add-task-page__chip--selected' : ''}`}
              onClick={() => handlePeriodChange(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Aralık Seçimi (Her N günde/haftada/ayda bir) - Tek Seferlik değilse */}
        {!isOnce && (
          <div className="add-task-page__interval-box">
            <div className="add-task-page__interval-header">
              <span className="add-task-page__interval-title">Tekrar Aralığı</span>
              <span className="add-task-page__interval-badge">
                {intervalValue === 1 ? `Her ${currentLimits.unitSingular}` : `Her ${intervalValue} ${currentLimits.unitPlural} bir`}
              </span>
            </div>
            <div className="add-task-page__interval-chips">
              {[1, 2, 3].map((val) => (
                <button
                  key={val}
                  type="button"
                  className={`add-task-page__mini-chip ${intervalValue === val ? 'add-task-page__mini-chip--selected' : ''}`}
                  onClick={() => handleIntervalChange(val)}
                >
                  {val === 1 ? `Her ${currentLimits.unitSingular}` : `${val} ${currentLimits.unitPlural} bir`}
                </button>
              ))}
              {/* Özel giriş */}
              <div className="add-task-page__custom-interval">
                <span>Özel:</span>
                <input
                  type="number"
                  min="1"
                  max={currentLimits.maxInterval}
                  className="add-task-page__num-input"
                  value={intervalValue}
                  onChange={(e) => handleIntervalChange(e.target.value)}
                />
                <span className="add-task-page__unit-text">{currentLimits.unitSingular} (en fazla {currentLimits.maxInterval})</span>
              </div>
            </div>
          </div>
        )}

        {/* Öncelik / Zorluk */}
        <label className="add-task-page__label">{isOnce ? 'Zorluk' : 'Öncelik'}</label>
        <div className="add-task-page__chip-row">
          {priorityOptions.map((pr) => (
            <button
              key={pr.key}
              type="button"
              className={`add-task-page__chip ${priority === pr.key ? 'add-task-page__chip--selected' : ''}`}
              onClick={() => setPriority(pr.key)}
            >
              {pr.label}
            </button>
          ))}
        </div>

        {/* Kategori */}
        <label className="add-task-page__label">Kategori</label>
        <div className="add-task-page__chip-row">
          <button
            type="button"
            className={`add-task-page__chip ${categoryId === null ? 'add-task-page__chip--selected' : ''}`}
            onClick={() => setCategoryId(null)}
          >
            Yok
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`add-task-page__chip ${categoryId === c.id ? 'add-task-page__chip--selected' : ''}`}
              onClick={() => setCategoryId(c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>

        {/* Hedef Tekrar Sayısı & Alt Adımlar - Tek Seferlik değilse */}
        {!isOnce && (
          <div className="add-task-page__frequency-card">
            <div className="add-task-page__frequency-header">
              <div>
                <label className="add-task-page__label" style={{ margin: 0 }}>Periyot İçi Hedef Tekrar</label>
                <p className="add-task-page__summary-preview">
                  🎯 {formatPeriodFrequency({ period, intervalValue }, subtaskCount)}
                </p>
              </div>

              {/* Stepper Kontrolü */}
              <div className="add-task-page__stepper">
                <button
                  type="button"
                  className="add-task-page__stepper-btn"
                  onClick={() => handleSubtaskCountChange(subtaskCount - 1)}
                  disabled={subtaskCount <= 1}
                  aria-label="Azalt"
                >
                  <Minus size={16} />
                </button>
                <span className="add-task-page__stepper-val">{subtaskCount}</span>
                <button
                  type="button"
                  className="add-task-page__stepper-btn"
                  onClick={() => handleSubtaskCountChange(subtaskCount + 1)}
                  disabled={subtaskCount >= currentLimits.maxSubtasks}
                  aria-label="Artır"
                >
                  <Plus size={16} />
                </button>
              </div>
            </div>

            {/* İsteğe bağlı: Tekrarları İsimlendir Akordeonu */}
            {subtaskCount > 1 && (
              <div className="add-task-page__accordion">
                <button
                  type="button"
                  className="add-task-page__accordion-toggle"
                  onClick={() => setShowCustomLabels(!showCustomLabels)}
                >
                  <span>Tekrarları İsimlendir (örn. Sabah, Akşam) — İsteğe bağlı</span>
                  {showCustomLabels ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>

                {showCustomLabels && (
                  <div className="add-task-page__subtask-list">
                    {Array.from({ length: subtaskCount }).map((_, idx) => (
                      <div key={idx} className="add-task-page__subtask-row">
                        <span className="add-task-page__subtask-idx">{idx + 1}.</span>
                        <input
                          type="text"
                          className="add-task-page__input add-task-page__subtask-input"
                          placeholder={`${idx + 1}. tekrar için isim (isteğe bağlı)`}
                          value={subtaskLabels[idx] || ''}
                          onChange={(e) => updateSubtaskLabel(idx, e.target.value)}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="add-task-page__footer">
          <button
            type="submit"
            className="add-task-page__submit-btn"
            disabled={saving}
          >
            {saving ? 'Kaydediliyor...' : 'Görevi Kaydet'}
          </button>
        </div>
      </form>

      <GuestLimitModal
        open={showLimitModal}
        onClose={() => setShowLimitModal(false)}
        type="task"
      />
    </div>
  );
}
