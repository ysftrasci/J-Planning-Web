// J-Planning — Kategoriler Sayfası (Web)
// Mobildeki src/screens/CategoriesScreen.js dosyasının web karşılığı.
import { useCallback, useEffect, useState } from 'react';
import { Plus, Tag, Trash2 } from 'lucide-react';
import { getCategories, createCategory, deleteCategory } from '../db/categoryRepository';
import AppButton from '../components/AppButton.jsx';
import AppModal from '../components/AppModal.jsx';
import EmptyState from '../components/EmptyState.jsx';
import './CategoriesPage.css';

const COLOR_OPTIONS = ['#C98A2C', '#5B8A6B', '#C4512E', '#5B7A9C', '#8A6BA8', '#9C6B1E'];

export default function CategoriesPage() {
  const [categories, setCategories] = useState([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [categoryToDelete, setCategoryToDelete] = useState(null);

  const load = useCallback(async () => {
    try {
      const list = await getCategories();
      setCategories(list);
    } catch (e) {
      console.error('Kategoriler yüklenemedi:', e);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const confirmDelete = async () => {
    if (!categoryToDelete) return;
    try {
      await deleteCategory(categoryToDelete.id);
      setCategoryToDelete(null);
      await load();
    } catch (e) {
      console.error('Kategori silinemedi:', e);
    }
  };

  return (
    <div className="categories-page">
      <div className="categories-page__header">
        <h1>Kategoriler</h1>
        <button
          type="button"
          className="categories-page__add-button"
          onClick={() => setShowAddModal(true)}
          aria-label="Yeni kategori ekle"
        >
          <Plus size={24} />
        </button>
      </div>

      {categories.length === 0 ? (
        <EmptyState
          icon={Tag}
          title="Henüz kategori yok"
          subtitle="Sağ üstteki + ile yeni kategori ekle"
        />
      ) : (
        <ul className="categories-page__list">
          {categories.map((item) => (
            <li key={item.id} className="categories-page__row">
              <span className="categories-page__color-dot" style={{ backgroundColor: item.color }} />
              <span className="categories-page__name">{item.name}</span>
              <button
                type="button"
                className="categories-page__delete-button"
                onClick={() => setCategoryToDelete(item)}
                aria-label={`${item.name} kategorisini sil`}
              >
                <Trash2 size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <AddCategoryModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSaved={async () => {
          setShowAddModal(false);
          await load();
        }}
      />

      <AppModal
        open={!!categoryToDelete}
        onClose={() => setCategoryToDelete(null)}
        title="Kategoriyi Sil"
      >
        <p className="caption">
          "{categoryToDelete?.name}" kategorisini silmek istiyor musun? Bu kategorideki görevler
          "Kategorisiz" olarak kalacak.
        </p>
        <div className="categories-page__modal-actions">
          <AppButton title="Vazgeç" variant="ghost" onClick={() => setCategoryToDelete(null)} />
          <AppButton title="Sil" variant="danger" onClick={confirmDelete} />
        </div>
      </AppModal>
    </div>
  );
}

function AddCategoryModal({ open, onClose, onSaved }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLOR_OPTIONS[0]);
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleClose = () => {
    setName('');
    setColor(COLOR_OPTIONS[0]);
    setErrorMessage('');
    setIsSubmitting(false);
    onClose();
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMessage('Lütfen kategori adı gir.');
      return;
    }
    try {
      setIsSubmitting(true);
      await createCategory(name.trim(), color);
      setName('');
      setColor(COLOR_OPTIONS[0]);
      setErrorMessage('');
      setIsSubmitting(false);
      onSaved();
    } catch (err) {
      setIsSubmitting(false);
      setErrorMessage(err.message || 'Kategori eklenemedi.');
    }
  };

  return (
    <AppModal open={open} onClose={handleClose} title="Yeni Kategori">
      <form className="categories-page__form" onSubmit={handleSave}>
        <input
          className="categories-page__input"
          type="text"
          placeholder="Kategori adı"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          disabled={isSubmitting}
        />
        {errorMessage && <p className="categories-page__error">{errorMessage}</p>}
        <div className="categories-page__color-row">
          {COLOR_OPTIONS.map((c) => (
            <button
              type="button"
              key={c}
              onClick={() => setColor(c)}
              disabled={isSubmitting}
              aria-label={`Renk seç: ${c}`}
              className={`categories-page__color-option ${color === c ? 'categories-page__color-option--selected' : ''}`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        <div className="categories-page__modal-actions">
          <AppButton type="button" title="Vazgeç" variant="ghost" onClick={handleClose} disabled={isSubmitting} />
          <AppButton type="submit" title={isSubmitting ? 'Kaydediliyor...' : 'Kaydet'} disabled={isSubmitting} />
        </div>
      </form>
    </AppModal>
  );
}
