// J-Planning — Ortak Buton Bileşeni (Web)
// Mobildeki src/components/AppButton.js dosyasının web karşılığı.
// Pressable/StyleSheet yerine <button> + CSS class'ları kullanılıyor,
// variant mantığı (primary/secondary/ghost/danger) aynen korunuyor.
import './AppButton.css';

// variant: 'primary' | 'secondary' | 'ghost' | 'danger'
export default function AppButton({
  title,
  onClick,
  type = 'button',
  variant = 'primary',
  disabled,
  loading,
  style,
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`app-button app-button--${variant}`}
      style={style}
    >
      {loading ? <span className="app-button__spinner" aria-hidden="true" /> : title}
    </button>
  );
}
