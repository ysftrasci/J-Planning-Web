// J-Planning — E-posta Doğrulama Bekleme Ekranı (Web)
// Kayıt olduktan sonra e-postasını henüz doğrulamamış kullanıcılar
// AppRouter.jsx -> RequireAuth tarafından buraya yönlendirilir.
// Kullanıcı e-postasındaki linke tıklayıp "Doğruladım, devam et" dediğinde
// (veya sekmeyi yenilediğinde) AuthContext firebaseUser.reload() ile
// emailVerified durumunu tazeler ve RequireAuth otomatik olarak asıl
// uygulamaya geçiş yapar.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppButton from '../components/AppButton.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { resendVerificationEmail } from '../services/emailAuth';
import './LoginPage.css';

export default function VerifyEmailPage() {
  const { user, signOut, refreshAuthUser } = useAuth();
  const navigate = useNavigate();
  const [resending, setResending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState('');

  const handleResend = async () => {
    setResending(true);
    setMessage('');
    try {
      await resendVerificationEmail();
      setMessage('Doğrulama e-postası tekrar gönderildi. Gelen kutunu (ve spam klasörünü) kontrol et.');
    } catch (e) {
      setMessage(e.message);
    } finally {
      setResending(false);
    }
  };

  const handleCheckAgain = async () => {
    setChecking(true);
    setMessage('');
    try {
      const verified = await refreshAuthUser();
      if (verified) {
        navigate('/', { replace: true });
      } else {
        setMessage('Henüz doğrulanmamış görünüyor. E-postandaki linke tıkladıktan sonra tekrar dene.');
      }
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card card">
        <div className="login-icon" aria-hidden="true">
          ✉️
        </div>
        <h1 className="login-title">E-postanı Doğrula</h1>
        <p className="caption login-subtitle">
          <strong>{user?.email}</strong> adresine bir doğrulama linki gönderdik.
          Hesabını kullanabilmek için önce e-postandaki linke tıklaman gerekiyor.
        </p>

        {message && <p className="login-error" style={{ color: 'var(--color-text-secondary)' }}>{message}</p>}

        <div className="login-form">
          <AppButton
            title={checking ? 'Kontrol ediliyor...' : 'Doğruladım, devam et'}
            onClick={handleCheckAgain}
            disabled={checking}
          />
          <button
            type="button"
            className="login-link"
            onClick={handleResend}
            disabled={resending}
          >
            {resending ? 'Gönderiliyor...' : 'Doğrulama e-postasını tekrar gönder'}
          </button>
          <button type="button" className="login-link" onClick={signOut}>
            Çıkış yap
          </button>
        </div>
      </div>
    </div>
  );
}
