import AppModal from './AppModal.jsx';
import AppButton from './AppButton.jsx';
import { Sparkles, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function GuestLimitModal({
  open,
  onClose,
  type = 'task', // 'task' | 'category' | 'reward'
}) {
  const navigate = useNavigate();

  if (!open) return null;

  const config = {
    task: {
      limit: '10',
      title: 'Görev Limitine Ulaştın 🎯',
      desc: 'Misafir modunda en fazla 10 aktif görev oluşturabilirsin. Sınırsız görev eklemek, alışkanlıklarını takip etmek ve verilerini kaybetmemek için hemen ücretsiz hesabını oluştur.',
    },
    category: {
      limit: '3',
      title: 'Kategori Limitine Ulaştın 🏷️',
      desc: 'Misafir modunda en fazla 3 kategori oluşturabilirsin. Sınırsız kategori ile hayatını planlamak için ücretsiz kayıt ol.',
    },
    reward: {
      limit: '3',
      title: 'Ödül Limitine Ulaştın 🎁',
      desc: 'Misafir modunda en fazla 3 ödül tanımlayabilirsin. Hedeflerine ulaştıkça sınırsız ödül kazanmak için hesabını kaydet.',
    },
  }[type] || config.task;

  const handleGoRegister = () => {
    onClose();
    navigate('/login?mode=register');
  };

  return (
    <AppModal open={open} onClose={onClose} title={config.title}>
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
          <Sparkles size={30} />
        </div>

        <p style={{ margin: 0, fontSize: '14px', lineHeight: 1.6, color: 'var(--color-text-secondary)' }}>
          {config.desc}
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
