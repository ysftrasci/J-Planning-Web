import { useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import AppModal from './AppModal';
import AppButton from './AppButton';
import { deleteAccountCompletely, abandonAccountDeletionAndReset } from '../services/deleteAccountService';

export default function AccountDeletionPendingModal({ open, uid, onSuccess, onSignOut }) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [error, setError] = useState('');
  const [failCount, setFailCount] = useState(0);

  const handleConfirm = async () => {
    if (!password) {
      setError('İşlemi tamamlamak için şifrenizi girmeniz gerekiyor.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await deleteAccountCompletely({ uid, password });
      if (onSuccess) onSuccess();
    } catch (err) {
      setFailCount((prev) => prev + 1);
      const code = err?.code || '';
      if (code.includes('wrong-password') || code.includes('invalid-credential')) {
        setError('Şifre hatalı, lütfen tekrar deneyin.');
      } else {
        setError(err.message || 'Silme işlemi tamamlanırken bir sorun oluştu.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResetAccount = async () => {
    const confirmed = window.confirm(
      'Hesabınız sıfırlanacaktır. Bu işlem yarım kalan silme kilidini kaldırır ve sıfırdan yeni bir profille başlamanıza izin verir. Devam edilsin mi?'
    );
    if (!confirmed) return;

    setResetLoading(true);
    setError('');
    try {
      await abandonAccountDeletionAndReset(uid);
      if (onSignOut) await onSignOut();
    } catch (err) {
      setError(
        'Hesap sıfırlama işlemi başarısız oldu (Ağ hatası). Lütfen internet bağlantınızı kontrol edin veya destek@jplanning.com ile iletişime geçin.'
      );
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <AppModal open={open} onClose={() => {}} title="Hesap Silme Tamamlanmadı ⚠️">
      <div className="profile-page__modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <AlertTriangle size={44} color="var(--color-danger)" />
        </div>
        <p style={{ textAlign: 'center', fontSize: 'var(--font-body-size)', lineHeight: 1.5 }}>
          Hesabınız daha önce silinme sürecine girmiş ancak işlem tamamlanamamış.
          <br />
          Hesap silme işlemini tamamen bitirmek için şifrenizi girin.
        </p>

        <input
          type="password"
          className="profile-page__delete-password-input"
          placeholder="Şifreniz"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          disabled={loading || resetLoading}
          style={{
            width: '100%',
            padding: 'var(--space-sm) var(--space-md)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg)',
            color: 'var(--color-text-primary)',
          }}
        />

        {error && (
          <p style={{ color: 'var(--color-danger)', fontSize: 'var(--font-caption-size)', margin: 0, textAlign: 'center' }}>
            {error}
          </p>
        )}

        <div style={{ display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-xs)' }}>
          <AppButton
            title="Çıkış Yap"
            variant="secondary"
            onClick={onSignOut}
            disabled={loading || resetLoading}
            style={{ flex: 1 }}
          />
          <AppButton
            title={loading ? 'Siliniyor...' : 'Silmeyi Tamamla'}
            variant="danger"
            onClick={handleConfirm}
            disabled={loading || resetLoading}
            loading={loading}
            style={{ flex: 1 }}
          />
        </div>

        {failCount >= 1 && (
          <div
            style={{
              marginTop: 'var(--space-sm)',
              padding: 'var(--space-sm)',
              borderRadius: 'var(--radius-md)',
              background: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-xs)',
              alignItems: 'center',
            }}
          >
            <p style={{ fontSize: '13px', margin: 0, opacity: 0.9, textAlign: 'center' }}>
              Silme işlemi tamamlanamıyor mu? Dilerseniz kilitli hesabı sıfırlayıp temiz bir başlangıç yapabilirsiniz.
            </p>
            <AppButton
              title={resetLoading ? 'Sıfırlanıyor...' : 'Hesabımı Sıfırla ve Devam Et'}
              variant="secondary"
              onClick={handleResetAccount}
              disabled={loading || resetLoading}
              loading={resetLoading}
              style={{ fontSize: '13px' }}
            />
          </div>
        )}
      </div>
    </AppModal>
  );
}
