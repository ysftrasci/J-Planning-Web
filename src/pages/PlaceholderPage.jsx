// Henüz hayata geçmemiş ekranlar için geçici yer tutucu.
// İlgili Aşama (3-7) tamamlandığında gerçek ekran bileşeniyle değiştirilecek.
export default function PlaceholderPage({ title, stageLabel }) {
  return (
    <div className="card">
      <h2>{title}</h2>
      <p className="caption" style={{ marginTop: 'var(--space-sm)' }}>
        Bu ekran henüz yapım aşamasında ({stageLabel}).
      </p>
    </div>
  );
}
