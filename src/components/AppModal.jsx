// J-Planning — Ortak Alt-Sayfa Modalı (Web)
// Mobildeki <Modal animationType="slide" transparent> kullanımlarının (ör.
// CategoriesScreen'deki AddCategoryModal) web karşılığı. Ekranın altından
// yukarı kayan bir kart olarak açılır, arka plana tıklayınca kapanır.
import { useEffect } from 'react';
import './AppModal.css';

export default function AppModal({ open, visible, onClose, title, children }) {
  const isOpen = open ?? visible;

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="app-modal__overlay" onClick={onClose}>
      <div className="app-modal__card" onClick={(e) => e.stopPropagation()}>
        {title && <h2 className="app-modal__title">{title}</h2>}
        {children}
      </div>
    </div>
  );
}
