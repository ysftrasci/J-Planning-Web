import { Lock, ArrowLeft, UserPlus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import AppButton from './AppButton.jsx';

export default function GuestRestrictedView({
  title = 'Kayıtlı Kullanıcılara Özel',
  description = 'Arkadaşlık özellikleri, anlık bildirimler ve sosyal görev atamaları yalnızca kayıtlı hesaplarda kullanılabilir. Ücretsiz hesap oluşturarak tüm bu özelliklerin kilidini açabilirsin.',
}) {
  const navigate = useNavigate();

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '65vh',
        padding: 'var(--space-lg) var(--space-md)',
        textAlign: 'center',
      }}
    >
      <div
        className="card"
        style={{
          maxWidth: '420px',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 'var(--space-md)',
          padding: 'var(--space-xl) var(--space-lg)',
        }}
      >
        <div
          style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            background: 'rgba(201, 138, 44, 0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#C98A2C',
          }}
        >
          <Lock size={32} />
        </div>

        <h2 style={{ fontSize: '18px', fontWeight: '700', margin: 0, color: 'var(--color-text-primary)' }}>
          {title}
        </h2>

        <p style={{ margin: 0, fontSize: '14px', lineHeight: 1.6, color: 'var(--color-text-secondary)' }}>
          {description}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', width: '100%', marginTop: 'var(--space-xs)' }}>
          <AppButton
            title="Ücretsiz Hesap Oluştur 🚀"
            variant="primary"
            onClick={() => navigate('/login?mode=register')}
            style={{ width: '100%' }}
          />
          <AppButton
            title="← Görevlerime Dön"
            variant="secondary"
            onClick={() => navigate('/')}
            style={{ width: '100%' }}
          />
        </div>
      </div>
    </div>
  );
}
