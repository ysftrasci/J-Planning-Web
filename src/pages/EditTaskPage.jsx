// J-Planning — Görev Düzenle Sayfası (Web)
import { useEffect, useState } from 'react';
import { ChevronLeft, Plus, Minus, ChevronDown, ChevronUp, ShieldAlert } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { getDb } from '../db/database';
import {
  updateTask,
  getSubtaskLabels,
  createSentTaskRecord,
  createTaskFromAssignment,
  findTaskByIdOrFirestoreId,
} from '../db/taskRepository';
import { getCategories } from '../db/categoryRepository';
import { useAuth } from '../context/AuthContext.jsx';
import { updateAssignedTaskInFirestore } from '../services/taskAssignmentService';
import { formatPeriodFrequency } from '../utils/period';
import AppButton from '../components/AppButton.jsx';
import './EditTaskPage.css';

const PRIORITIES = [
  { key: 'HIGH', label: 'Yüksek', jp: 5 },
  { key: 'MEDIUM', label: 'Orta', jp: 3 },
  { key: 'LOW', label: 'Düşük', jp: 1 },
  { key: 'ZERO', label: '0 JP', jp: 0 },
];

const DIFFICULTIES = [
  { key: 'EASY', label: 'Kolay', jp: 1 },
  { key: 'MEDIUM', label: 'Orta', jp: 2 },
  { key: 'HARD', label: 'Zor', jp: 3 },
  { key: 'ZERO', label: '0 JP', jp: 0 },
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

export default function EditTaskPage() {
  const { taskId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [task, setTask] = useState(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [period, setPeriod] = useState('DAILY');
  const [intervalValue, setIntervalValue] = useState(1);
  const [subtaskCount, setSubtaskCount] = useState(1);
  const [subtaskLabels, setSubtaskLabels] = useState(['']);
  const [showCustomLabels, setShowCustomLabels] = useState(false);
  const [categoryId, setCategoryId] = useState(null);
  const [categories, setCategories] = useState([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

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
    let isMounted = true;

    async function loadTaskData() {
      try {
        let t = await findTaskByIdOrFirestoreId(taskId);

        if (t) {
          if (!isMounted) return;
          setTask(t);
          setTitle(t.title || '');
          setDescription(t.description || '');
          setPriority(t.priority || 'MEDIUM');
          setPeriod(t.period || 'DAILY');
          setIntervalValue(Math.max(1, t.intervalValue || 1));
          setCategoryId(t.categoryId || null);

          const count = Math.max(1, t.subtaskCount || 1);
          setSubtaskCount(count);

          const labels = getSubtaskLabels(t);
          if (labels && labels.length > 0) {
            setSubtaskLabels(labels);
            const hasCustomNames = labels.some((l) => l && l.trim().length > 0);
            if (hasCustomNames) setShowCustomLabels(true);
          } else {
            setSubtaskLabels(Array.from({ length: count }, () => ''));
          }
          return;
        }

        // Yerelde yoksa doğrudan Firestore'dan çek (Attıklarım sayfasından açıldığında)
        const docRef = doc(db, 'assignedTasks', taskId);
        const snap = await getDoc(docRef);
        if (snap.exists()) {
          const data = snap.data();
          const isSent = data.assignedByUid === user?.uid;
          const isReceived = data.assignedToUid === user?.uid;

          const count = Math.max(1, data.subtaskCount || 1);
          const interval = Math.max(1, data.intervalValue || 1);
          const rawLabels = Array.isArray(data.subtaskLabels) && data.subtaskLabels.length > 0
            ? data.subtaskLabels
            : Array.from({ length: count }, () => '');

          // Kendi Turso kaydımızı oluşturalım ki yerelde de saklansın
          let createdLocalId = null;
          if (isSent) {
            createdLocalId = await createSentTaskRecord({
              title: data.title,
              description: data.description || '',
              priority: data.priority,
              period: data.period,
              intervalValue: interval,
              subtaskCount: count,
              subtaskLabels: rawLabels,
              assignedToUserId: data.assignedToUid,
              assignedToName: data.assignedToName,
              firestoreAssignmentId: snap.id,
            });
          }

          const remoteTaskObj = {
            id: createdLocalId || snap.id,
            firestoreAssignmentId: snap.id,
            title: data.title || '',
            description: data.description || '',
            priority: data.priority || 'MEDIUM',
            period: data.period || 'DAILY',
            intervalValue: interval,
            assignedToUserId: data.assignedToUid,
            assignedToName: data.assignedToName,
            assignmentDirection: isSent ? 'SENT' : isReceived ? 'RECEIVED' : 'NONE',
            subtaskCount: count,
            subtaskLabels: rawLabels,
          };

          if (!isMounted) return;
          setTask(remoteTaskObj);
          setTitle(remoteTaskObj.title);
          setDescription(remoteTaskObj.description);
          setPriority(remoteTaskObj.priority);
          setPeriod(remoteTaskObj.period);
          setIntervalValue(interval);
          setSubtaskCount(count);
          setSubtaskLabels(rawLabels);
          if (rawLabels.some((l) => l && l.trim().length > 0)) {
            setShowCustomLabels(true);
          }
        }
      } catch (e) {
        console.error('Görev yükleme hatası:', e);
      } finally {
        if (isMounted) setLoaded(true);
      }
    }

    loadTaskData();

    return () => {
      isMounted = false;
    };
  }, [taskId, user]);

  if (!loaded) return null;

  if (!task) {
    return (
      <div className="edit-task-page">
        <button type="button" className="edit-task-page__back" onClick={() => navigate(-1)}>
          <ChevronLeft size={18} />
          Geri
        </button>
        <div className="edit-task-page__blocked">
          <h2>Görev Bulunamadı</h2>
          <p className="caption">Düzenlemek istediğin görev mevcut değil veya silinmiş.</p>
        </div>
      </div>
    );
  }

  const isReceivedFromFriend = task.assignmentDirection === 'RECEIVED';
  const isSentToFriend = task.assignmentDirection === 'SENT';

  if (isReceivedFromFriend) {
    return (
      <div className="edit-task-page">
        <button type="button" className="edit-task-page__back" onClick={() => navigate(-1)}>
          <ChevronLeft size={18} />
          Geri
        </button>
        <div className="edit-task-page__blocked">
          <ShieldAlert size={48} className="edit-task-page__blocked-icon" />
          <h2>Görev Düzenlenemez</h2>
          <p className="caption">
            Bu görevi sana <strong>{task.assignedByName || 'bir arkadaşın'}</strong> atadı. Arkadaşının sana
            gönderdiği görevleri yalnızca görevi oluşturan/gönderen kişi düzenleyebilir.
          </p>
          <AppButton title="Detaylara Dön" onClick={() => navigate(`/task/${taskId}`)} style={{ marginTop: 'var(--space-md)' }} />
        </div>
      </div>
    );
  }

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

    const effectiveInterval = isOnce ? 1 : intervalValue;
    const effectiveCount = isOnce ? 1 : subtaskCount;
    const effectiveLabels = isOnce ? [''] : subtaskLabels.slice(0, effectiveCount);

    setSaving(true);
    try {
      await updateTask(task.id, {
        title: title.trim(),
        description: description ? description.trim() : '',
        categoryId,
        priority,
        period,
        intervalValue: effectiveInterval,
        subtaskCount: effectiveCount,
        subtaskLabels: effectiveLabels,
      });

      const firestoreDocId = task.firestoreAssignmentId || (taskId !== task.id ? taskId : null);
      if (isSentToFriend && firestoreDocId) {
        await updateAssignedTaskInFirestore(firestoreDocId, {
          title: title.trim(),
          description: description ? description.trim() : '',
          priority,
          period,
          intervalValue: effectiveInterval,
          subtaskCount: effectiveCount,
          subtaskLabels: effectiveLabels,
        });
      }

      if (isSentToFriend) {
        navigate('/assigned-by-me');
      } else {
        navigate(`/task/${task.id}`);
      }
    } catch (err) {
      console.error('Görev güncelleme hatası:', err);
      setErrorMessage(err.message || 'Görev güncellenemedi.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="edit-task-page">
      <button type="button" className="edit-task-page__back" onClick={() => navigate(-1)}>
        <ChevronLeft size={18} />
        Geri
      </button>

      <h1>Görevi Düzenle</h1>

      {isSentToFriend && (
        <div className="edit-task-page__hint-banner">
          <ShieldAlert size={18} />
          <span>
            Bu görevi arkadaşına sen atadın. Yaptığın değişiklikler arkadaşının listesine de yansıyacaktır.
          </span>
        </div>
      )}

      {errorMessage && <p className="edit-task-page__error">{errorMessage}</p>}

      <form className="edit-task-page__form" onSubmit={handleSave}>
        <label className="edit-task-page__label" htmlFor="edit-task-title">
          Görev Adı
        </label>
        <input
          id="edit-task-title"
          type="text"
          className="edit-task-page__input"
          placeholder="Örn: Kitap Oku, Spor Yap"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        <label className="edit-task-page__label" htmlFor="edit-task-desc">
          Açıklama (İsteğe Bağlı)
        </label>
        <textarea
          id="edit-task-desc"
          className="edit-task-page__input"
          style={{ minHeight: '80px', resize: 'vertical' }}
          placeholder="Görevle ilgili ek ayrıntılar..."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        {!isSentToFriend && (
          <>
            <label className="edit-task-page__label">Kategori</label>
            <div className="edit-task-page__chip-group">
              <Chip
                label="Kategorisiz"
                selected={categoryId === null}
                onClick={() => setCategoryId(null)}
              />
              {categories.map((cat) => (
                <Chip
                  key={cat.id}
                  label={cat.name}
                  color={cat.color}
                  selected={categoryId === cat.id}
                  onClick={() => setCategoryId(cat.id)}
                />
              ))}
            </div>
          </>
        )}

        <label className="edit-task-page__label">Tekrar Sıklığı (Periyot)</label>
        <div className="edit-task-page__chip-group">
          {PERIODS.map((p) => (
            <Chip
              key={p.key}
              label={p.label}
              selected={period === p.key}
              onClick={() => handlePeriodChange(p.key)}
            />
          ))}
        </div>

        {/* Aralık Seçimi (Her N günde/haftada/ayda bir) - Tek Seferlik değilse */}
        {!isOnce && (
          <div className="edit-task-page__interval-box">
            <div className="edit-task-page__interval-header">
              <span className="edit-task-page__interval-title">Tekrar Aralığı</span>
              <span className="edit-task-page__interval-badge">
                {intervalValue === 1 ? `Her ${currentLimits.unitSingular}` : `Her ${intervalValue} ${currentLimits.unitPlural} bir`}
              </span>
            </div>
            <div className="edit-task-page__interval-chips">
              {[1, 2, 3].map((val) => (
                <button
                  key={val}
                  type="button"
                  className={`edit-task-page__mini-chip ${intervalValue === val ? 'edit-task-page__mini-chip--selected' : ''}`}
                  onClick={() => handleIntervalChange(val)}
                >
                  {val === 1 ? `Her ${currentLimits.unitSingular}` : `${val} ${currentLimits.unitPlural} bir`}
                </button>
              ))}
              <div className="edit-task-page__custom-interval">
                <span>Özel:</span>
                <input
                  type="number"
                  min="1"
                  max={currentLimits.maxInterval}
                  className="edit-task-page__num-input"
                  value={intervalValue}
                  onChange={(e) => handleIntervalChange(e.target.value)}
                />
                <span className="edit-task-page__unit-text">{currentLimits.unitSingular} (en fazla {currentLimits.maxInterval})</span>
              </div>
            </div>
          </div>
        )}

        <label className="edit-task-page__label">
          {isOnce ? 'Zorluk Seviyesi' : 'Öncelik'}
        </label>
        <div className="edit-task-page__chip-group">
          {(isOnce ? DIFFICULTIES : PRIORITIES).map((p) => (
            <Chip
              key={p.key}
              label={`${p.label} (${p.jp} JP)`}
              selected={priority === p.key}
              onClick={() => setPriority(p.key)}
            />
          ))}
        </div>

        {/* Hedef Tekrar Sayısı & Alt Adımlar - Tek Seferlik değilse */}
        {!isOnce && (
          <div className="edit-task-page__frequency-card">
            <div className="edit-task-page__frequency-header">
              <div>
                <label className="edit-task-page__label" style={{ margin: 0 }}>Periyot İçi Hedef Tekrar</label>
                <p className="edit-task-page__summary-preview">
                  🎯 {formatPeriodFrequency({ period, intervalValue }, subtaskCount)}
                </p>
              </div>

              {/* Stepper Kontrolü */}
              <div className="edit-task-page__stepper">
                <button
                  type="button"
                  className="edit-task-page__stepper-btn"
                  onClick={() => handleSubtaskCountChange(subtaskCount - 1)}
                  disabled={subtaskCount <= 1}
                  aria-label="Azalt"
                >
                  <Minus size={16} />
                </button>
                <span className="edit-task-page__stepper-val">{subtaskCount}</span>
                <button
                  type="button"
                  className="edit-task-page__stepper-btn"
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
              <div className="edit-task-page__accordion">
                <button
                  type="button"
                  className="edit-task-page__accordion-toggle"
                  onClick={() => setShowCustomLabels(!showCustomLabels)}
                >
                  <span>Tekrarları İsimlendir (örn. Sabah, Akşam) — İsteğe bağlı</span>
                  {showCustomLabels ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>

                {showCustomLabels && (
                  <div className="edit-task-page__subtask-list">
                    {Array.from({ length: subtaskCount }).map((_, idx) => (
                      <div key={idx} className="edit-task-page__subtask-row">
                        <span className="edit-task-page__subtask-idx">{idx + 1}.</span>
                        <input
                          type="text"
                          className="edit-task-page__input edit-task-page__subtask-input"
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

        <div className="edit-task-page__actions">
          <AppButton
            type="button"
            title="İptal"
            variant="ghost"
            onClick={() => navigate(-1)}
            disabled={saving}
          />
          <AppButton
            type="submit"
            title={saving ? 'Kaydediliyor...' : 'Değişiklikleri Kaydet'}
            loading={saving}
          />
        </div>
      </form>
    </div>
  );
}

function Chip({ label, selected, onClick, color }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`edit-task-page__chip ${selected ? 'edit-task-page__chip--selected' : ''}`}
      style={color ? { '--chip-color': color } : undefined}
    >
      {color && <span className="edit-task-page__chip-dot" style={{ background: color }} />}
      {label}
    </button>
  );
}
