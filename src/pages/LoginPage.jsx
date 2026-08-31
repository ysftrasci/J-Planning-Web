// J-Planning — Giriş / Kayıt Sayfası (Web)
// Mobildeki src/screens/LoginScreen.js dosyasının web karşılığı.
// View/TextInput/Alert/Pressable yerine div/input/window.alert/button
// kullanılıyor; giriş-kayıt mantığı (mode toggle, şifre sıfırlama) aynen
// korunuyor. Başarılı girişte AuthContext otomatik yakalayıp yönlendirecek.
import { useState } from 'react';
import AppButton from '../components/AppButton.jsx';
import { registerWithEmail, loginWithEmail, sendResetPasswordEmail } from '../services/emailAuth';
import { getUserProfile } from '../db/userProfileRepository';
import AccountDeletionPendingModal from '../components/AccountDeletionPendingModal';
import { useAuth } from '../context/AuthContext.jsx';
import './LoginPage.css';

export default function LoginPage() {
  const { signOut } = useAuth();
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [pendingUid, setPendingUid] = useState(null);
  const [showPendingModal, setShowPendingModal] = useState(false);

  const handleForgotPassword = async () => {
    if (!email.trim()) {
      window.alert('E-posta Gerekli: Şifre sıfırlama linki gönderebilmemiz için önce e-posta alanına adresini yaz.');
      return;
    }
    const confirmed = window.confirm(
      `${email.trim()} adresine bir şifre sıfırlama linki gönderilecek. Devam edilsin mi?`
    );
    if (!confirmed) return;

    setResetLoading(true);
    setErrorMessage('');
    try {
      await sendResetPasswordEmail(email);
      window.alert('Gönderildi: E-postana bir şifre sıfırlama linki gönderdik. Gelen kutunu (ve spam klasörünü) kontrol et.');
    } catch (e) {
      setErrorMessage(e.message);
    } finally {
      setResetLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage('');

    if (!email.trim() || !password) {
      setErrorMessage('Lütfen e-posta ve şifreni gir.');
      return;
    }
    if (mode === 'register' && !name.trim()) {
      setErrorMessage('Lütfen adını gir.');
      return;
    }

    setLoading(true);
    try {
      if (mode === 'register') {
        await registerWithEmail(name, email, password);
      } else {
        const cred = await loginWithEmail(email, password);
        if (cred?.user) {
          const profile = await getUserProfile(cred.user.uid);
          if (profile?.isDeleting === true) {
            setPendingUid(cred.user.uid);
            setShowPendingModal(true);
            setLoading(false);
            return;
          }
        }
      }
      // Başarılı girişte AuthContext otomatik olarak yakalayıp yönlendirecek.
    } catch (e) {
      setErrorMessage(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card card" onSubmit={handleSubmit}>
        <div className="login-icon" aria-hidden="true">
          ✓
        </div>
        <h1 className="login-title">J-Planning</h1>
        <p className="caption login-subtitle">
          Görevlerini takip et, JP kazan, arkadaşlarınla motive ol.
        </p>

        <div className="login-form">
          {mode === 'register' && (
            <input
              className="login-input"
              type="text"
              placeholder="Adın"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
          )}
          <input
            className="login-input"
            type="email"
            placeholder="E-posta"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
          <input
            className="login-input"
            type="password"
            placeholder="Şifre"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          />

          {errorMessage && <p className="login-error">{errorMessage}</p>}

          <AppButton
            type="submit"
            title={mode === 'register' ? 'Kayıt Ol' : 'Giriş Yap'}
            loading={loading}
          />

          {mode === 'login' && (
            <button
              type="button"
              className="login-link"
              onClick={handleForgotPassword}
              disabled={resetLoading}
            >
              Şifremi Unuttum
            </button>
          )}

          <button
            type="button"
            className="login-link"
            onClick={() => {
              setErrorMessage('');
              setMode(mode === 'register' ? 'login' : 'register');
            }}
          >
            {mode === 'register' ? 'Zaten hesabın var mı? Giriş yap' : 'Hesabın yok mu? Kayıt ol'}
          </button>
        </div>
      </form>

      {showPendingModal && (
        <AccountDeletionPendingModal
          open={showPendingModal}
          uid={pendingUid}
          onSuccess={() => {
            setShowPendingModal(false);
            setPendingUid(null);
            window.alert('Hesabınız kalıcı olarak silindi.');
          }}
          onSignOut={async () => {
            await signOut();
            setShowPendingModal(false);
            setPendingUid(null);
          }}
        />
      )}
    </div>
  );
}
