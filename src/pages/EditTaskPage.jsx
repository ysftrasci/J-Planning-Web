// J-Planning — Görev Düzenle Sayfası (Web)
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, X, Plus, Info, ShieldAlert } from 'lucide-react';
import { getDb } from '../db/database';
import { updateTask, getSubtaskLabels } from '../db/taskRepository';
import { getCategories } from '../db/categoryRepository';
import { updateAssignedTaskInFirestore } from '../services/taskAssignmentService';
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
  { key: 'DAILY', label: 'Günlük' },
  { key: 'WEEKLY', label: 'Haftalık' },
  { key: 'MONTHLY', label: 'Aylık' },
  { key: 'ONCE', label: 'Tek Seferlik' },
];

function Chip({ label, selected, onClick }) {
  return (
    <button
      type="button"
      className={`edit-task-page__chip ${selected ? 'edit-task-page__chip--selected' : ''}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export default function EditTaskPage() {
  const { taskId } = useParams();
  const navigate = useNavigate();

  const [task, setTask] = useState(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [period, setPeriod] = useState('DAILY');
  const [categoryId, setCategoryId] = useState(null);
  const [categories] = useState(() => getCategories());
  const [subtaskLabels, setSubtaskLabels] = useState(['']);
  const [errorMessage, setErrorMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const db = getDb();
      let t = db.getFirstSync('SELECT * FROM tasks WHERE id = ?', [taskId]);
      if (!t) {
        t = db.getFirstSync('SELECT * FROM tasks WHERE firestoreAssignmentId = ?', [taskId]);
      }
      if (t) {
        setTask(t);
        setTitle(t.title || '');
        setDescription(t.description || '');
        setPriority(t.priority || 'MEDIUM');
        setPeriod(t.period || 'DAILY');
        setCategoryId(t.categoryId || null);

        const labels = getSubtaskLabels(t);
        if (labels && labels.length > 0) {
          setSubtaskLabels(labels);
        } else {
          const count = t.subtaskCount || 1;
          setSubtaskLabels(Array.from({ length: count }, () => ''));
        }
      }
    } catch (e) {
      console.error('Görev yükleme hatası:', e);
    } finally {
      setLoaded(true);
    }
  }, [taskId]);

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
          <p className="caption">Düzenlemek istediğiniz görev mevcut değil veya silinmiş.</p>
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

  const handlePeriodChange = (newPeriod) => {
    setPeriod(newPeriod);
    setPriority('MEDIUM');
  };

  const addSubtaskRow = () => setSubtaskLabels((prev) => [...prev, '']);
  const removeSubtaskRow = (index) => setSubtaskLabels((prev) => prev.filter((_, i) => i !== index));
  const updateSubtaskLabel = (index, value) => {
    setSubtaskLabels((prev) => prev.map((l, i) => (i === index ? value : l)));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setErrorMessage('');

    if (!title.trim()) {
      setErrorMessage('Lütfen görev adı gir.');
      return;
    }

    const subtaskCount = isOnce ? 1 : subtaskLabels.length;
    const effectiveSubtaskLabels = isOnce ? [''] : subtaskLabels;

    setSaving(true);
    try {
      updateTask(taskId, {
        title: title.trim(),
        description: description ? description.trim() : '',
        categoryId,
        priority,
        period,
        subtaskCount,
        subtaskLabels: effectiveSubtaskLabels,
      });

      if (isSentToFriend && task.firestoreAssignmentId) {
        await updateAssignedTaskInFirestore(task.firestoreAssignmentId, {
          title: title.trim(),
          priority,
          period,
          subtaskCount,
          subtaskLabels: effectiveSubtaskLabels,
        });
      }

      navigate(`/task/${taskId}`);
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
        İptal
      </button>

      <h1>Görevi Düzenle</h1>

      {isSentToFriend && (
        <div className="edit-task-page__hint-banner">
          <Info size={16} />
          <span>
            Bu görev <strong>{task.assignedToName}</strong> kullanıcısına atandı. Yapacağınız değişiklikler arkadaşınızın ekranında da güncellenecektir.
          </span>
        </div>
      )}

      <form className="edit-task-page__form" onSubmit={handleSave}>
        <label className="edit-task-page__label" htmlFor="task-title">Görev Adı</label>
        <input
          id="task-title"
          className="edit-task-page__input"
          type="text"
          placeholder="örn. Su iç, spor yap..."
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />

        <label className="edit-task-page__label" htmlFor="task-description">Not / Açıklama (opsiyonel)</label>
        <input
          id="task-description"
          className="edit-task-page__input"
          type="text"
          placeholder="örn. Sayfa 45-60 arası okunacak"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <span className="edit-task-page__label">Periyot</span>
        <div className="edit-task-page__chip-row">
          {PERIODS.map((p) => (
            <Chip key={p.key} label={p.label} selected={period === p.key} onClick={() => handlePeriodChange(p.key)} />
          ))}
        </div>

        <span className="edit-task-page__label">{isOnce ? 'Zorluk' : 'Öncelik'}</span>
        <div className="edit-task-page__chip-row">
          {(isOnce ? DIFFICULTIES : PRIORITIES).map((p) => (
            <Chip
              key={p.key}
              label={`${p.label} (${p.jp} JP)`}
              selected={priority === p.key}
              onClick={() => setPriority(p.key)}
            />
          ))}
        </div>

        {categories.length > 0 && (
          <>
            <span className="edit-task-page__label">Kategori</span>
            <div className="edit-task-page__chip-row">
              <Chip label="Yok" selected={categoryId === null} onClick={() => setCategoryId(null)} />
              {categories.map((c) => (
                <Chip key={c.id} label={c.name} selected={categoryId === c.id} onClick={() => setCategoryId(c.id)} />
              ))}
            </div>
          </>
        )}

        {!isOnce && (
          <>
            <span className="edit-task-page__label">Sıklık (kaç kez yapılmalı?)</span>
            <p className="edit-task-page__hint">
              Görev bu periyotta birden fazla kez yapılacaksa, her tekrar için bir satır ekle.
            </p>
            {subtaskLabels.map((label, index) => (
              <div key={index} className="edit-task-page__subtask-row">
                <input
                  className="edit-task-page__input edit-task-page__subtask-input"
                  type="text"
                  placeholder={`${index + 1}. tekrar (opsiyonel isim)`}
                  value={label}
                  onChange={(e) => updateSubtaskLabel(index, e.target.value)}
                />
                {subtaskLabels.length > 1 && (
                  <button
                    type="button"
                    className="edit-task-page__remove-subtask"
                    onClick={() => removeSubtaskRow(index)}
                    aria-label="Bu tekrarı kaldır"
                  >
                    <X size={18} />
                  </button>
                )}
              </div>
            ))}
            <button type="button" className="edit-task-page__add-subtask-link" onClick={addSubtaskRow}>
              <Plus size={16} />
              Tekrar Ekle
            </button>
          </>
        )}

        {errorMessage && <p className="edit-task-page__error">{errorMessage}</p>}

        <div className="edit-task-page__footer">
          <AppButton type="submit" title="Değişiklikleri Kaydet" loading={saving} />
        </div>
      </form>
    </div>
  );
}
