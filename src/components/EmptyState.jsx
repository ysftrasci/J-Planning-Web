// J-Planning — Boş Durum Bileşeni (Web)
// Mobildeki src/components/EmptyState.js dosyasının web karşılığı.
import './EmptyState.css';

export default function EmptyState({ icon: Icon, title, subtitle }) {
  return (
    <div className="empty-state">
      {Icon && <Icon size={40} strokeWidth={1.5} className="empty-state__icon" />}
      <p className="empty-state__title">{title}</p>
      {subtitle && <p className="empty-state__subtitle">{subtitle}</p>}
    </div>
  );
}
