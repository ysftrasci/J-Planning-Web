import AppModal from './AppModal.jsx';
import AppButton from './AppButton.jsx';
import { Info, ShieldAlert } from 'lucide-react';

export default function GuestConfirmationModal({ open, onConfirm, onClose, loading = false }) {
  if (!open) return null;

  return (
    <AppModal open={open} onClose={onClose} title="Misafir Modu Hakkında">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
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
            <ShieldAlert size={32} />
          </div>
        </div>

        <div style={{ fontSize: '14px', lineHeight: 1.6, color: 'var(--color-text-secondary)', textAlign: 'left' }}>
          <p style={{ margin: '0 0 10px 0' }}>
            <strong>J-Planning'i kayıt olmadan denemek üzeresin.</strong>
          </p>
          <ul style={{ margin: 0, paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <li>Görevlerin, kategorilerin ve puanların <strong>yalnızca bu tarayıcının yerel hafızasında</strong> saklanır.</li>
            <li>Tarayıcı geçmişini veya site verilerini temizlersen girdiğin veriler kaybolabilir.</li>
            <li>Dilediğin zaman ücretsiz bir hesap oluşturarak verilerini kalıcı hale getirebilirsin.</li>
          </ul>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-sm)' }}>
          <AppButton
            title="Vazgeç"
            variant="secondary"
            onClick={onClose}
            disabled={loading}
            style={{ flex: 1 }}
          />
          <AppButton
            title={loading ? 'Başlatılıyor...' : 'Anladım, Devam Et'}
            variant="primary"
            onClick={onConfirm}
            loading={loading}
            disabled={loading}
            style={{ flex: 1 }}
          />
        </div>
      </div>
    </AppModal>
  );
}
