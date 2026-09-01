// J-Planning — E-posta Doğrulama Bekleme Ekranı (Web)
// Kayıt olduktan sonra e-postasını henüz doğrulamamış kullanıcılar
// AppRouter.jsx -> RequireAuth tarafından buraya yönlendirilir.
// Kullanıcı e-postasındaki linke tıklayıp "Doğruladım, devam et" dediğinde
// (veya sekmeyi yenilediğinde) AuthContext firebaseUser.reload() ile
// emailVerified durumunu tazeler ve RequireAuth otomatik olarak asıl
// uygulamaya geçiş yapar.
import { useState, useEffect } from 'react';
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

  const COOLDOWN_SECONDS = 60;
  const storageKey = user?.uid ? `jplanning:last_verify_email_${user.uid}` : 'jplanning:last_verify_email';

  const getRemainingSeconds = () => {
    try {
      const last = localStorage.getItem(storageKey);
      if (!last) return 0;
      const elapsed = Math.floor((Date.now() - Number(last)) / 1000);
      return Math.max(0, COOLDOWN_SECONDS - elapsed);
    } catch {
      return 0;
    }
  };

  const [cooldown, setCooldown] = useState(getRemainingSeconds);

  // Geri sayım sayacı
  useEffect(() => {
    const timer = setInterval(() => {
      const rem = getRemainingSeconds();
      setCooldown(rem);
    }, 1000);
    return () => clearInterval(timer);
  }, [storageKey]);

  // Kullanıcı mail kutusundan linke tıklayıp bu sekmeye geri döndüğünde otomatik algıla
  useEffect(() => {
    const handleFocus = async () => {
      if (checking || resending) return;
      try {
        if (typeof refreshAuthUser === 'function') {
          const verified = await refreshAuthUser();
          if (verified) {
            navigate('/', { replace: true });
          }
        }
      } catch (_) {}
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [refreshAuthUser, navigate, checking, resending]);

  const handleResend = async () => {
    if (cooldown > 0 || resending) return;
    setResending(true);
    setMessage('');
    try {
      await resendVerificationEmail();
      setCooldown(COOLDOWN_SECONDS);
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
            disabled={resending || cooldown > 0}
          >
            {resending
              ? 'Gönderiliyor...'
              : cooldown > 0
              ? `Tekrar göndermek için lütfen bekleyin (${cooldown} sn)`
              : 'Doğrulama e-postasını tekrar gönder'}
          </button>
          <button type="button" className="login-link" onClick={signOut}>
            Çıkış yap
          </button>
        </div>
      </div>
    </div>
  );
}
