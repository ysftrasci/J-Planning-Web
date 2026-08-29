import { useEffect, useState } from 'react';
import { X, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { createTask } from '../db/taskRepository';
import { getCategories } from '../db/categoryRepository';
import { useAuth } from '../context/AuthContext.jsx';
import { listenFriends } from '../services/friendService';
import { assignTaskToFriend } from '../services/taskAssignmentService';
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
  { key: 'DAILY', label: 'Günlük' },
  { key: 'WEEKLY', label: 'Haftalık' },
  { key: 'MONTHLY', label: 'Aylık' },
  { key: 'ONCE', label: 'Tek Seferlik' },
];

export default function AddTaskPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [period, setPeriod] = useState('DAILY');
  const [categoryId, setCategoryId] = useState(null);
  const [assignTo, setAssignTo] = useState('me'); // 'me' | friendUid
  const [categories, setCategories] = useState([]);
  const [friends, setFriends] = useState([]);
  const [subtaskLabels, setSubtaskLabels] = useState(['']);
  const [errorMessage, setErrorMessage] = useState('');
  const [saving, setSaving] = useState(false);

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
    if (!user) return;
    const unsub = listenFriends(user.uid, setFriends);
    return unsub;
  }, [user]);

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

    if (assignTo === 'me') {
      try {
        setSaving(true);
        await createTask({
          title: title.trim(),
          description: description ? description.trim() : '',
          categoryId,
          priority,
          period,
          subtaskCount,
          subtaskLabels: effectiveSubtaskLabels,
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
        priority,
        subtaskCount,
        subtaskLabels: effectiveSubtaskLabels,
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
          placeholder="örn. Su iç, spor yap.."
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

        {/* Kime atanacak? */}
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

        {/* Periyot */}
        <label className="add-task-page__label">Periyot</label>
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

        {/* Sıklık */}
        {!isOnce && (
          <div className="add-task-page__frequency-section">
            <label className="add-task-page__label">Sıklık (kaç kez yapılmalı?)</label>
            <p className="add-task-page__hint">
              Görev bu periyotta birden fazla kez yapılacaksa (ör. diş fırçalama: sabah + akşam), her tekrar için bir satır ekle. İsim yazmazsan sadece sayı gösterilir.
            </p>

            {subtaskLabels.map((lbl, idx) => (
              <div key={idx} className="add-task-page__subtask-row">
                <input
                  type="text"
                  className="add-task-page__input add-task-page__subtask-input"
                  placeholder={`${idx + 1}. tekrar (opsiyonel isim)`}
                  value={lbl}
                  onChange={(e) => updateSubtaskLabel(idx, e.target.value)}
                />
                {subtaskLabels.length > 1 && (
                  <button
                    type="button"
                    className="add-task-page__remove-subtask"
                    onClick={() => removeSubtaskRow(idx)}
                    aria-label="Tekrarı sil"
                  >
                    <X size={18} />
                  </button>
                )}
              </div>
            ))}

            <button
              type="button"
              className="add-task-page__add-subtask-link"
              onClick={addSubtaskRow}
            >
              + Tekrar Ekle
            </button>
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
    </div>
  );
}
