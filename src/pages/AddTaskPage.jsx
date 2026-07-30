// J-Planning — Görev Ekle Sayfası (Web)
// Mobildeki src/screens/AddTaskScreen.js dosyasının web karşılığı.
//
// NOT (Aşama 3 -> Aşama 5 sınırı): "Kime atanacak?" seçiminde arkadaşa atama
// arayüzü burada zaten gösteriliyor (kullanıcı kararı), ama gerçek arkadaş
// listesi ve gönderim mantığı (services/friendService, taskAssignmentService)
// henüz web'e taşınmadı. Bu yüzden "Arkadaşıma gönder" seçilirse kaydetme
// engellenir ve Aşama 5'in henüz aktif olmadığı bilgisi gösterilir.
import { useState } from 'react';
import { X, Plus, Info } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { createTask } from '../db/taskRepository';
import { getCategories } from '../db/categoryRepository';
import AppButton from '../components/AppButton.jsx';
import './AddTaskPage.css';

const PRIORITIES = [
  { key: 'HIGH', label: 'Yüksek', jp: 5 },
  { key: 'MEDIUM', label: 'Orta', jp: 3 },
  { key: 'LOW', label: 'Düşük', jp: 1 },
];

// Tek seferlik (ONCE) görevlerde "öncelik" yerine "zorluk" seçilir.
const DIFFICULTIES = [
  { key: 'EASY', label: 'Kolay', jp: 1 },
  { key: 'MEDIUM', label: 'Orta', jp: 2 },
  { key: 'HARD', label: 'Zor', jp: 3 },
];

const PERIODS = [
  { key: 'DAILY', label: 'Günlük' },
  { key: 'WEEKLY', label: 'Haftalık' },
  { key: 'MONTHLY', label: 'Aylık' },
  { key: 'ONCE', label: 'Tek Seferlik' },
];

// Aşama 5'e kadar arkadaş listesi her zaman boş — gerçek liste
// services/friendService bağlandığında burada state olarak doldurulacak.
const FRIENDS_PLACEHOLDER = [];

export default function AddTaskPage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [period, setPeriod] = useState('DAILY');
  const [categoryId, setCategoryId] = useState(null);
  const [assignTo, setAssignTo] = useState('me'); // 'me' | 'friend' (Aşama 5'e kadar sembolik)
  const [categories] = useState(() => getCategories());
  const [subtaskLabels, setSubtaskLabels] = useState(['']);
  const [errorMessage, setErrorMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const isOnce = period === 'ONCE';

  const handlePeriodChange = (newPeriod) => {
    setPeriod(newPeriod);
    // Periyot türü değişince (normal <-> tek seferlik), öncelik/zorluk setinin
    // değişmesi gerektiği için varsayılan "Orta" seçeneğine sıfırla.
    setPriority('MEDIUM');
  };

  const addSubtaskRow = () => setSubtaskLabels((prev) => [...prev, '']);
  const removeSubtaskRow = (index) => setSubtaskLabels((prev) => prev.filter((_, i) => i !== index));
  const updateSubtaskLabel = (index, value) => {
    setSubtaskLabels((prev) => prev.map((l, i) => (i === index ? value : l)));
  };

  const handleSave = (e) => {
    e.preventDefault();
    setErrorMessage('');

    if (!title.trim()) {
      setErrorMessage('Lütfen görev adı gir.');
      return;
    }

    if (assignTo === 'friend') {
      setErrorMessage('Arkadaşına görev atama özelliği yakında (Aşama 5) aktif olacak.');
      return;
    }

    setSaving(true);
    // Tek seferlik görevlerde alt görev/sıklık kavramı yok — her zaman 1.
    const subtaskCount = isOnce ? 1 : subtaskLabels.length;
    const effectiveSubtaskLabels = isOnce ? [''] : subtaskLabels;

    createTask({ title: title.trim(), categoryId, priority, period, subtaskCount, subtaskLabels: effectiveSubtaskLabels });
    navigate('/');
  };

  return (
    <div className="add-task-page">
      <form className="add-task-page__form" onSubmit={handleSave}>
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

        <span className="add-task-page__label">Kime atanacak?</span>
        <div className="add-task-page__chip-row">
          <Chip label="Kendime" selected={assignTo === 'me'} onClick={() => setAssignTo('me')} />
          <Chip label="Arkadaşıma gönder" selected={assignTo === 'friend'} onClick={() => setAssignTo('friend')} />
        </div>
        {assignTo === 'friend' && (
          <p className="add-task-page__hint add-task-page__hint--info">
            <Info size={14} />
            Arkadaşa görev atama, Aşama 5'te arkadaşlık sistemiyle birlikte aktif olacak.
          </p>
        )}
        {assignTo === 'me' && FRIENDS_PLACEHOLDER.length === 0 && (
          <p className="add-task-page__hint">Henüz arkadaşın yok. Arkadaşlar sekmesinden ekleyebilirsin.</p>
        )}

        <span className="add-task-page__label">Periyot</span>
        <div className="add-task-page__chip-row">
          {PERIODS.map((p) => (
            <Chip key={p.key} label={p.label} selected={period === p.key} onClick={() => handlePeriodChange(p.key)} />
          ))}
        </div>

        <span className="add-task-page__label">{isOnce ? 'Zorluk' : 'Öncelik'}</span>
        <div className="add-task-page__chip-row">
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
            <span className="add-task-page__label">Kategori</span>
            <div className="add-task-page__chip-row">
              <Chip label="Yok" selected={categoryId === null} onClick={() => setCategoryId(null)} />
              {categories.map((c) => (
                <Chip key={c.id} label={c.name} selected={categoryId === c.id} onClick={() => setCategoryId(c.id)} />
              ))}
            </div>
          </>
        )}

        {!isOnce && (
          <>
            <span className="add-task-page__label">Sıklık (kaç kez yapılmalı?)</span>
            <p className="add-task-page__hint">
              Görev bu periyotta birden fazla kez yapılacaksa (ör. diş fırçalama: sabah + akşam), her tekrar
              için bir satır ekle. İsim yazmazsan sadece sayı gösterilir.
            </p>
            {subtaskLabels.map((label, index) => (
              <div key={index} className="add-task-page__subtask-row">
                <input
                  className="add-task-page__input add-task-page__subtask-input"
                  type="text"
                  placeholder={`${index + 1}. tekrar (opsiyonel isim)`}
                  value={label}
                  onChange={(e) => updateSubtaskLabel(index, e.target.value)}
                />
                {subtaskLabels.length > 1 && (
                  <button
                    type="button"
                    className="add-task-page__remove-subtask"
                    onClick={() => removeSubtaskRow(index)}
                    aria-label="Bu tekrarı kaldır"
                  >
                    <X size={18} />
                  </button>
                )}
              </div>
            ))}
            <button type="button" className="add-task-page__add-subtask-link" onClick={addSubtaskRow}>
              <Plus size={16} />
              Tekrar Ekle
            </button>
          </>
        )}

        {isOnce && (
          <div className="add-task-page__once-info">
            <Info size={16} />
            <span>Bu görev tek seferliktir. Tamamladığında JP kazanırsın, işin bittiğinde görevi kendin silebilirsin.</span>
          </div>
        )}

        {errorMessage && <p className="add-task-page__error">{errorMessage}</p>}

        <div className="add-task-page__footer">
          <AppButton type="submit" title="Görevi Kaydet" loading={saving} />
        </div>
      </form>
    </div>
  );
}

function Chip({ label, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`add-task-page__chip ${selected ? 'add-task-page__chip--selected' : ''}`}
    >
      {label}
    </button>
  );
}
