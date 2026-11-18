import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Hourglass, CheckCircle2, Clock, Pencil, Trash2, FileText, Tag, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { listenTasksIAssigned, deleteAssignedTask, updateAssignedTaskInFirestore } from '../services/taskAssignmentService';
import { deleteTask } from '../db/taskRepository';
import { getCategories } from '../db/categoryRepository';
import { periodLabel, getPeriodKey } from '../utils/period';
import EmptyState from '../components/EmptyState.jsx';
import AppModal from '../components/AppModal.jsx';
import AppButton from '../components/AppButton.jsx';
import './AssignedByMePage.css';

const PRIORITY_LABEL = { HIGH: 'Yüksek', MEDIUM: 'Orta', LOW: 'Düşük', EASY: 'Kolay', HARD: 'Zor' };

const EDIT_PRIORITIES = [
  { key: 'HIGH', label: 'Yüksek' },
  { key: 'MEDIUM', label: 'Orta' },
  { key: 'LOW', label: 'Düşük' },
];

const EDIT_PERIODS = [
  { key: 'DAILY', label: 'Günlük' },
  { key: 'WEEKLY', label: 'Haftalık' },
  { key: 'MONTHLY', label: 'Aylık' },
  { key: 'ONCE', label: 'Tek Seferlik' },
];

const SORT_OPTIONS = [
  { key: 'AZ', label: 'A → Z (varsayılan)' },
  { key: 'ZA', label: 'Z → A' },
  { key: 'NEWEST', label: 'En yeni' },
];

const UNCATEGORIZED_KEY = '__uncategorized__';

const trCollator = new Intl.Collator('tr-TR', { sensitivity: 'base', numeric: true });

function readSession(key, fallback) {
  try {
    const v = sessionStorage.getItem(key);
    return v !== null ? v : fallback;
  } catch {
    return fallback;
  }
}

function writeSession(key, value) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // sessionStorage erişilemezse sessizce geç
  }
}

function getCreatedAtMs(item) {
  const ca = item.createdAt;
  if (!ca) return null;
  if (typeof ca === 'number') return ca;
  if (typeof ca.toMillis === 'function') return ca.toMillis(); // Firestore Timestamp
  if (typeof ca.seconds === 'number') return ca.seconds * 1000;
  return null;
}

// Atanan kişinin görevi İÇİNDE BULUNDUĞUMUZ periyotta tamamlayıp tamamlamadığını söyler.
// Tercih edilen yol: atananın yazdığı periyot bitiş anı (completedPeriodEndMs).
// Eski kayıtlarda bu alan yoksa periyot anahtarı karşılaştırmasına düşülür.
function isAssignedTaskDoneNow(item, isOnce) {
  if (item.isCompleted !== true) return false;
  if (isOnce) return true;
  if (typeof item.completedPeriodEndMs === 'number' && item.completedPeriodEndMs > 0) {
    return Date.now() < item.completedPeriodEndMs;
  }
  // Yedek yol: createdAt bir Firestore Timestamp'tir; doğrudan new Date()'e verilirse
  // geçersiz tarih üretir. Önce milisaniyeye çevir.
  const createdAtMs = getCreatedAtMs(item);
  const todayKey = getPeriodKey({ ...item, createdAt: createdAtMs || null }, new Date());
  return item.completedPeriodKey === todayKey;
}

function normCategoryKey(name) {
  return (name || '').trim().toLocaleLowerCase('tr-TR');
}

export default function AssignedByMePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState([]);
  // Firestore'dan en az bir kez veri geldi mi? Gelmeden geçersiz-seçim sıfırlaması çalışmasın.
  const [tasksLoaded, setTasksLoaded] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [categories, setCategories] = useState([]);

  // Filtre & Sıralama state'leri — başlangıç değeri sessionStorage'dan okunur
  const [sortKey, setSortKey] = useState(() => readSession('abm_sort', 'AZ'));
  const [filterPerson, setFilterPerson] = useState(() => readSession('abm_person', ''));
  const [filterCategory, setFilterCategory] = useState(() => readSession('abm_category', ''));

  // Düzenleme modalı state'leri
  const [editingTask, setEditingTask] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editCategoryId, setEditCategoryId] = useState(null);
  const [editPriority, setEditPriority] = useState('MEDIUM');
  const [editPeriod, setEditPeriod] = useState('DAILY');
  const [editIntervalValue, setEditIntervalValue] = useState(1);
  const [editSubtaskCount, setEditSubtaskCount] = useState(1);
  const [editSubtaskLabels, setEditSubtaskLabels] = useState(['']);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState('');

  useEffect(() => {
    getCategories()
      .then((cats) => setCategories(cats || []))
      .catch((e) => console.warn('Kategoriler yüklenemedi:', e));
  }, []);

  useEffect(() => {
    if (!user) return;
    const unsub = listenTasksIAssigned(user.uid, (incoming) => {
      setTasks(incoming);
      setTasksLoaded(true);
    });
    return unsub;
  }, [user]);

  // Sıralama & filtre tercihlerini sessionStorage'a yaz (her değişimde)
  useEffect(() => { writeSession('abm_sort', sortKey); }, [sortKey]);
  useEffect(() => { writeSession('abm_person', filterPerson); }, [filterPerson]);
  useEffect(() => { writeSession('abm_category', filterCategory); }, [filterCategory]);

  // Aktif görevler (PENDING + ACCEPTED)
  const activeTasks = useMemo(
    () => tasks.filter((t) => t.status === 'ACCEPTED' || t.status === 'PENDING'),
    [tasks]
  );

  // Benzersiz kişiler (assignedToUid'e göre tekilleştir, alfabetik)
  const uniquePersons = useMemo(() => {
    const map = new Map();
    for (const t of activeTasks) {
      if (t.assignedToUid && !map.has(t.assignedToUid)) {
        map.set(t.assignedToUid, t.assignedToName || 'Arkadaşın');
      }
    }
    return [...map.entries()]
      .sort((a, b) => trCollator.compare(a[1], b[1]))
      .map(([uid, name]) => ({ uid, name }));
  }, [activeTasks]);

  // Benzersiz kategoriler (normalizasyon ile tekilleştir, alfabetik)
  const uniqueCategories = useMemo(() => {
    const map = new Map(); // lowerName → displayName
    let hasUncategorized = false;
    for (const t of activeTasks) {
      const name = (t.categoryName || '').trim();
      if (!name) {
        hasUncategorized = true;
      } else {
        const key = normCategoryKey(name);
        if (!map.has(key)) map.set(key, name);
      }
    }
    const named = [...map.entries()]
      .sort((a, b) => trCollator.compare(a[1], b[1]))
      .map(([key, name]) => ({ key, name }));
    if (hasUncategorized) named.push({ key: UNCATEGORIZED_KEY, name: 'Kategorisiz' });
    return named;
  }, [activeTasks]);

  // Seçilen kişi/kategori hâlâ listede var mı? Yoksa Tümü'ne dön.
  // ÖNEMLI: tasksLoaded=true olmadan çalışmasın; yükleme sırasında geçerli seçimi silme.
  useEffect(() => {
    if (!tasksLoaded) return;
    if (filterPerson && !uniquePersons.find((p) => p.uid === filterPerson)) {
      setFilterPerson('');
      writeSession('abm_person', '');
    }
  }, [uniquePersons, filterPerson, tasksLoaded]);

  useEffect(() => {
    if (!tasksLoaded) return;
    if (filterCategory) {
      const exists =
        filterCategory === UNCATEGORIZED_KEY
          ? uniqueCategories.find((c) => c.key === UNCATEGORIZED_KEY)
          : uniqueCategories.find((c) => c.key === filterCategory);
      if (!exists) {
        setFilterCategory('');
        writeSession('abm_category', '');
      }
    }
  }, [uniqueCategories, filterCategory, tasksLoaded]);

  // Filtre + Sıralama (useMemo ile)
  const displayTasks = useMemo(() => {
    let list = activeTasks;

    if (filterPerson) {
      list = list.filter((t) => t.assignedToUid === filterPerson);
    }

    if (filterCategory) {
      if (filterCategory === UNCATEGORIZED_KEY) {
        list = list.filter((t) => !(t.categoryName || '').trim());
      } else {
        list = list.filter(
          (t) => normCategoryKey(t.categoryName) === filterCategory
        );
      }
    }

    // Sırala
    list = [...list].sort((a, b) => {
      if (sortKey === 'NEWEST') {
        const ta = getCreatedAtMs(a);
        const tb = getCreatedAtMs(b);
        if (ta === null && tb === null) return 0;
        if (ta === null) return 1;
        if (tb === null) return -1;
        if (tb !== ta) return tb - ta;
      } else {
        const titleA = (a.title || '');
        const titleB = (b.title || '');
        if (!titleA && titleB) return 1;
        if (titleA && !titleB) return -1;
        const cmp = trCollator.compare(titleA, titleB);
        if (cmp !== 0) return sortKey === 'ZA' ? -cmp : cmp;
      }
      // İkincil: atanan kişi adı, sonra id
      const pCmp = trCollator.compare(a.assignedToName || '', b.assignedToName || '');
      if (pCmp !== 0) return pCmp;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });

    return list;
  }, [activeTasks, filterPerson, filterCategory, sortKey]);

  const hasActiveFilters = filterPerson || filterCategory;

  const clearFilters = () => {
    setFilterPerson('');
    setFilterCategory('');
  };

  const openEditModal = (item) => {
    setEditingTask(item);
    setEditTitle(item.title || '');
    setEditDescription(item.description || '');
    setEditPriority(item.priority || 'MEDIUM');
    setEditPeriod(item.period || 'DAILY');
    setEditIntervalValue(item.intervalValue || 1);
    const count = Math.max(1, item.subtaskCount || 1);
    setEditSubtaskCount(count);
    setEditSubtaskLabels(
      Array.isArray(item.subtaskLabels) && item.subtaskLabels.length > 0
        ? [...item.subtaskLabels]
        : Array.from({ length: count }, () => '')
    );

    // Kategori eşleme: categoryId veya categoryName üzerinden mevcut kategorilerden bul
    const matchedCategory = categories.find(
      (c) =>
        c.id === item.categoryId ||
        (item.categoryName && (c.name || '').trim().toLowerCase() === item.categoryName.trim().toLowerCase())
    );
    setEditCategoryId(matchedCategory ? matchedCategory.id : (item.categoryId || null));
    setEditError('');
  };

  const handleSubtaskCountChange = (newCount) => {
    const val = Math.max(1, Math.min(20, parseInt(newCount, 10) || 1));
    setEditSubtaskCount(val);
    setEditSubtaskLabels((prev) => {
      const copy = [...prev];
      while (copy.length < val) copy.push('');
      return copy.slice(0, val);
    });
  };

  const handleSubtaskLabelChange = (index, value) => {
    setEditSubtaskLabels((prev) => {
      const copy = [...prev];
      copy[index] = value;
      return copy;
    });
  };

  const handleSaveEdit = async (e) => {
    e?.preventDefault();
    if (!editingTask) return;
    const cleanTitle = editTitle.trim();
    if (!cleanTitle) {
      setEditError('Görev adı boş olamaz.');
      return;
    }

    setSavingEdit(true);
    setEditError('');
    try {
      const isOnce = editPeriod === 'ONCE';
      const effectiveInterval = isOnce ? 1 : Math.max(1, parseInt(editIntervalValue, 10) || 1);
      const effectiveCount = isOnce ? 1 : Math.max(1, parseInt(editSubtaskCount, 10) || 1);
      const effectiveLabels = isOnce
        ? null
        : editSubtaskLabels.slice(0, effectiveCount).map((l) => String(l || '').trim());

      const selectedCategory = categories.find((c) => c.id === editCategoryId);
      const categoryName = selectedCategory ? selectedCategory.name.trim() : null;

      await updateAssignedTaskInFirestore(editingTask.id, {
        title: cleanTitle,
        description: editDescription.trim(),
        categoryId: editCategoryId || null,
        categoryName: categoryName || null,
        priority: editPriority,
        period: editPeriod,
        intervalValue: effectiveInterval,
        subtaskCount: effectiveCount,
        subtaskLabels: effectiveLabels,
      });

      setEditingTask(null);
    } catch (err) {
      console.error('Atanan görev güncellenirken hata:', err);
      setEditError(err.message || 'Görev güncellenemedi.');
    } finally {
      setSavingEdit(false);
    }
  };

  const confirmDelete = async () => {
    if (!taskToDelete) return;
    setDeleting(true);
    setErrorMessage('');
    try {
      await deleteAssignedTask(taskToDelete.id);
      await deleteTask(taskToDelete.id);
      setTaskToDelete(null);
    } catch (e) {
      console.error('Atanan görev silinirken hata:', e);
      setErrorMessage(e.message || 'Görev silinirken bir sorun oluştu.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="assigned-by-me-page">
      <button type="button" className="assigned-by-me-page__back" onClick={() => navigate('/')}>
        <ChevronLeft size={18} />
        Görevlerim
      </button>

      <h1>Attıklarım</h1>
      <p className="assigned-by-me-page__intro">
        Arkadaşlarına attığın görevler burada listelenir. Tamamlama durumunu gerçek zamanlı takip edebilirsin.
      </p>

      {errorMessage && (
        <p style={{ color: 'var(--color-danger)', fontSize: '14px', marginBottom: 'var(--space-sm)' }}>
          {errorMessage}
        </p>
      )}

      {activeTasks.length === 0 ? (
        <EmptyState
          icon={Clock}
          title="Henüz kimseye görev atamadın"
          subtitle="Görev eklerken 'Kime atanacak?' kısmından bir arkadaşını seçebilirsin"
        />
      ) : (
        <>
          {/* Filtre & Sıralama Çubuğu */}
          <div className="assigned-by-me-page__controls">
            <div className="assigned-by-me-page__selects">
              <select
                className="assigned-by-me-page__select"
                value={filterPerson}
                onChange={(e) => setFilterPerson(e.target.value)}
                aria-label="Kişiye göre filtrele"
              >
                <option value="">Tüm kişiler</option>
                {uniquePersons.map((p) => (
                  <option key={p.uid} value={p.uid}>{p.name}</option>
                ))}
              </select>

              <select
                className="assigned-by-me-page__select"
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                aria-label="Kategoriye göre filtrele"
              >
                <option value="">Tüm kategoriler</option>
                {uniqueCategories.map((c) => (
                  <option key={c.key} value={c.key}>{c.name}</option>
                ))}
              </select>

              <select
                className="assigned-by-me-page__select"
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value)}
                aria-label="Sıralama"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </select>
            </div>

            <div className="assigned-by-me-page__filter-meta">
              <span className="assigned-by-me-page__filter-count">
                {activeTasks.length} görevden {displayTasks.length} tanesi
              </span>
              {hasActiveFilters && (
                <button
                  type="button"
                  className="assigned-by-me-page__clear-filters"
                  onClick={clearFilters}
                  aria-label="Filtreleri temizle"
                >
                  <X size={12} />
                  Filtreleri temizle
                </button>
              )}
            </div>
          </div>

          {/* Liste veya boş durum */}
          {displayTasks.length === 0 ? (
            <div className="assigned-by-me-page__filter-empty">
              <p>Seçilen filtrelere uygun görev bulunamadı.</p>
              <button
                type="button"
                className="assigned-by-me-page__clear-filters assigned-by-me-page__clear-filters--lg"
                onClick={clearFilters}
              >
                Filtreleri temizle
              </button>
            </div>
          ) : (
            <div className="assigned-by-me-page__list">
              {displayTasks.map((item) => {
                const isPending = item.status === 'PENDING';
                const isOnce = item.period === 'ONCE';
                const isDone = isAssignedTaskDoneNow(item, isOnce);
                const StatusIcon = isPending ? Hourglass : isDone ? CheckCircle2 : Clock;
                const statusClass = isPending
                  ? 'assigned-by-me-page__status--pending'
                  : isDone
                    ? 'assigned-by-me-page__status--done'
                    : 'assigned-by-me-page__status--waiting';
                const catName = (item.categoryName || '').trim();

                return (
                  <div key={item.id} className="assigned-by-me-page__card">
                    <div className="assigned-by-me-page__card-header">
                      <span className="assigned-by-me-page__title">{item.title}</span>

                      <div className="assigned-by-me-page__actions">
                        <span className={`assigned-by-me-page__status ${statusClass}`}>
                          <StatusIcon size={13} />
                          <span>{isPending ? 'Onay Bekliyor' : isDone ? 'Tamamlandı' : 'Bekliyor'}</span>
                        </span>

                        <button
                          type="button"
                          className="assigned-by-me-page__btn assigned-by-me-page__btn--edit"
                          onClick={() => openEditModal(item)}
                          title="Düzenle"
                        >
                          <Pencil size={12} />
                          <span>Düzenle</span>
                        </button>

                        <button
                          type="button"
                          className="assigned-by-me-page__btn assigned-by-me-page__btn--delete"
                          onClick={() => setTaskToDelete(item)}
                          title="Sil"
                        >
                          <Trash2 size={12} />
                          <span>Sil</span>
                        </button>
                      </div>
                    </div>

                    {item.description && (
                      <div className="assigned-by-me-page__desc-row">
                        <FileText size={13} className="assigned-by-me-page__desc-icon" />
                        <span className="assigned-by-me-page__description">{item.description}</span>
                      </div>
                    )}

                    <div className="assigned-by-me-page__meta">
                      {item.assignedToName || 'Arkadaşın'} • {periodLabel(item)} • {PRIORITY_LABEL[item.priority] || 'Orta'}
                      {catName && (
                        <span className="assigned-by-me-page__cat-badge">
                          <Tag size={10} />
                          {catName}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Düzenleme Modalı */}
      {editingTask && (
        <AppModal
          open={!!editingTask}
          onClose={() => setEditingTask(null)}
          title="Atanan Görevi Düzenle"
        >
          <form className="assigned-by-me-page__edit-form" onSubmit={handleSaveEdit}>
            {editError && (
              <p style={{ color: 'var(--color-danger)', fontSize: '13px', margin: 0 }}>
                {editError}
              </p>
            )}

            <div className="assigned-by-me-page__edit-field">
              <label className="assigned-by-me-page__edit-label">Görev Adı</label>
              <input
                className="assigned-by-me-page__edit-input"
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="Görev adı..."
                required
              />
            </div>

            <div className="assigned-by-me-page__edit-field">
              <label className="assigned-by-me-page__edit-label">Açıklama / Not</label>
              <textarea
                className="assigned-by-me-page__edit-textarea"
                rows={5}
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Açıklama (opsiyonel)..."
              />
            </div>

            {/* Kategori Seçimi (Her zaman düzenlenebilir) */}
            <div className="assigned-by-me-page__edit-field">
              <label className="assigned-by-me-page__edit-label">Kategori</label>
              <div className="assigned-by-me-page__edit-chips">
                <button
                  type="button"
                  className={`assigned-by-me-page__edit-chip ${editCategoryId === null ? 'assigned-by-me-page__edit-chip--selected' : ''}`}
                  onClick={() => setEditCategoryId(null)}
                >
                  Yok
                </button>
                {categories.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`assigned-by-me-page__edit-chip ${editCategoryId === c.id ? 'assigned-by-me-page__edit-chip--selected' : ''}`}
                    onClick={() => setEditCategoryId(c.id)}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="assigned-by-me-page__edit-field">
              <div className="assigned-by-me-page__edit-field-header">
                <label className="assigned-by-me-page__edit-label">Öncelik</label>
                {editingTask?.status === 'ACCEPTED' && (
                  <span className="assigned-by-me-page__edit-locked-hint">
                    Görev kabul edildiği için değiştirilemez
                  </span>
                )}
              </div>
              <div className="assigned-by-me-page__edit-chips">
                {EDIT_PRIORITIES.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    disabled={editingTask?.status === 'ACCEPTED'}
                    className={`assigned-by-me-page__edit-chip ${editPriority === p.key ? 'assigned-by-me-page__edit-chip--selected' : ''} ${editingTask?.status === 'ACCEPTED' ? 'assigned-by-me-page__edit-chip--disabled' : ''}`}
                    onClick={() => editingTask?.status !== 'ACCEPTED' && setEditPriority(p.key)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="assigned-by-me-page__edit-field">
              <div className="assigned-by-me-page__edit-field-header">
                <label className="assigned-by-me-page__edit-label">Periyot</label>
                {editingTask?.status === 'ACCEPTED' && (
                  <span className="assigned-by-me-page__edit-locked-hint">
                    Görev kabul edildiği için değiştirilemez
                  </span>
                )}
              </div>
              <div className="assigned-by-me-page__edit-chips">
                {EDIT_PERIODS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    disabled={editingTask?.status === 'ACCEPTED'}
                    className={`assigned-by-me-page__edit-chip ${editPeriod === p.key ? 'assigned-by-me-page__edit-chip--selected' : ''} ${editingTask?.status === 'ACCEPTED' ? 'assigned-by-me-page__edit-chip--disabled' : ''}`}
                    onClick={() => editingTask?.status !== 'ACCEPTED' && setEditPeriod(p.key)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {editPeriod !== 'ONCE' && (
              <>
                <div className="assigned-by-me-page__edit-field">
                  <div className="assigned-by-me-page__edit-field-header">
                    <label className="assigned-by-me-page__edit-label">
                      Tekrar Aralığı ({editPeriod === 'DAILY' ? 'Kaç günde bir' : editPeriod === 'WEEKLY' ? 'Kaç haftada bir' : 'Kaç ayda bir'})
                    </label>
                    {editingTask?.status === 'ACCEPTED' && (
                      <span className="assigned-by-me-page__edit-locked-hint">
                        Görev kabul edildiği için değiştirilemez
                      </span>
                    )}
                  </div>
                  <input
                    className="assigned-by-me-page__edit-input"
                    type="number"
                    min="1"
                    max="30"
                    disabled={editingTask?.status === 'ACCEPTED'}
                    value={editIntervalValue}
                    onChange={(e) => editingTask?.status !== 'ACCEPTED' && setEditIntervalValue(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  />
                </div>

                <div className="assigned-by-me-page__edit-field">
                  <div className="assigned-by-me-page__edit-field-header">
                    <label className="assigned-by-me-page__edit-label">Alt Görev / Tekrar Sayısı</label>
                    {editingTask?.status === 'ACCEPTED' && (
                      <span className="assigned-by-me-page__edit-locked-hint">
                        Görev kabul edildiği için değiştirilemez
                      </span>
                    )}
                  </div>
                  <input
                    className="assigned-by-me-page__edit-input"
                    type="number"
                    min="1"
                    max="20"
                    disabled={editingTask?.status === 'ACCEPTED'}
                    value={editSubtaskCount}
                    onChange={(e) => editingTask?.status !== 'ACCEPTED' && handleSubtaskCountChange(e.target.value)}
                  />
                </div>

                {editSubtaskCount > 1 && (
                  <div className="assigned-by-me-page__edit-field">
                    <label className="assigned-by-me-page__edit-label">Alt Görev Başlıkları (opsiyonel)</label>
                    {editSubtaskLabels.map((lbl, idx) => (
                      <input
                        key={idx}
                        className="assigned-by-me-page__edit-input"
                        type="text"
                        style={{ marginTop: idx > 0 ? '4px' : '0' }}
                        placeholder={`${idx + 1}. adım`}
                        value={lbl}
                        onChange={(e) => handleSubtaskLabelChange(idx, e.target.value)}
                      />
                    ))}
                  </div>
                )}
              </>
            )}

            <div className="assigned-by-me-page__edit-actions">
              <AppButton
                title="Vazgeç"
                variant="secondary"
                type="button"
                onClick={() => setEditingTask(null)}
              />
              <AppButton
                title="Kaydet"
                variant="primary"
                type="submit"
                loading={savingEdit}
              />
            </div>
          </form>
        </AppModal>
      )}

      {/* Silme Onay Modalı */}
      {taskToDelete && (
        <AppModal
          open={!!taskToDelete}
          onClose={() => setTaskToDelete(null)}
          title="Atanan Görevi Sil"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '8px 0' }}>
            <p style={{ margin: 0, fontSize: '14px', lineHeight: 1.5 }}>
              <strong>"{taskToDelete.title}"</strong> görevini silmek istediğine emin misin? Görev arkadaşının listesinden de kaldırılacaktır.
            </p>
            <div style={{ display: 'flex', gap: '12px' }}>
              <AppButton
                title="Vazgeç"
                variant="secondary"
                onClick={() => setTaskToDelete(null)}
              />
              <AppButton
                title="Evet, Sil"
                variant="danger"
                loading={deleting}
                onClick={confirmDelete}
              />
            </div>
          </div>
        </AppModal>
      )}
    </div>
  );
}
