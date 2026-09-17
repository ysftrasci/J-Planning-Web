import AppModal from './AppModal.jsx';
import AppButton from './AppButton.jsx';
import { Lock, UserPlus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function GuestRestrictedModal({
  open,
  onClose,
  title = 'Kayıtlı Kullanıcılara Özel',
  description = 'Bu özelliği kullanabilmek, arkadaşlarınla görev paylaşmak ve verilerini bulutta güvenceye almak için ücretsiz bir hesap oluştur.',
}) {
  const navigate = useNavigate();

  if (!open) return null;

  const handleGoRegister = () => {
    onClose();
    navigate('/login?mode=register');
  };

  return (
    <AppModal open={open} onClose={onClose} title={title}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', textAlign: 'center', alignItems: 'center' }}>
        <div
          style={{
            width: '56px',
            height: '56px',
            borderRadius: '50%',
            background: 'rgba(201, 138, 44, 0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#C98A2C',
          }}
        >
          <Lock size={30} />
        </div>

        <p style={{ margin: 0, fontSize: '14px', lineHeight: 1.6, color: 'var(--color-text-secondary)' }}>
          {description}
        </p>

        <div style={{ display: 'flex', gap: 'var(--space-sm)', width: '100%', marginTop: 'var(--space-sm)' }}>
          <AppButton
            title="Kapat"
            variant="secondary"
            onClick={onClose}
            style={{ flex: 1 }}
          />
          <AppButton
            title="Hesap Oluştur 🚀"
            variant="primary"
            onClick={handleGoRegister}
            style={{ flex: 1.4 }}
          />
        </div>
      </div>
    </AppModal>
  );
}
