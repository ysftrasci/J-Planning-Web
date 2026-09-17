// J-Planning — Giriş / Kayıt Sayfası (Web)
// Misafir Modu desteği: "Misafir olarak devam et" butonu ve onay adımı içerir.
// Misafirken kayıt olma durumunda yerel IndexedDB verisini yeni hesaba köprüler.

import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AppButton from '../components/AppButton.jsx';
import { registerWithEmail, loginWithEmail, sendResetPasswordEmail } from '../services/emailAuth';
import { getUserProfile } from '../db/userProfileRepository';
import AccountDeletionPendingModal from '../components/AccountDeletionPendingModal';
import GuestConfirmationModal from '../components/GuestConfirmationModal.jsx';
import { bridgeGuestDataToNewUser } from '../db/localSqliteEngine';
import { useAuth } from '../context/AuthContext.jsx';
import './LoginPage.css';

export default function LoginPage() {
  const { signOut, startGuestSession, isGuest } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const initialMode = searchParams.get('mode') === 'register' ? 'register' : 'login';
  const [mode, setMode] = useState(initialMode); // 'login' | 'register'

  useEffect(() => {
    const qMode = searchParams.get('mode');
    if (qMode === 'register' || qMode === 'login') {
      setMode(qMode);
    }
  }, [searchParams]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [guestLoading, setGuestLoading] = useState(false);
  const [showGuestConfirmModal, setShowGuestConfirmModal] = useState(false);
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
        const userObj = await registerWithEmail(name, email, password);
        const newUid = userObj?.uid || userObj?.user?.uid;
        // Misafirken kayıt oluyorsa yerel IndexedDB verisini yeni hesaba köprüle
        if (newUid) {
          await bridgeGuestDataToNewUser(newUid).catch((bridgeErr) => {
            console.warn('[Migration Bridge] Misafir verisi köprüleme uyarısı:', bridgeErr);
          });
        }
      } else {
        const userObj = await loginWithEmail(email, password);
        const uid = userObj?.uid || userObj?.user?.uid;
        if (uid) {
          const profile = await getUserProfile(uid);
          if (profile?.isDeleting === true) {
            setPendingUid(uid);
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

  const handleGuestConfirm = async () => {
    setGuestLoading(true);
    setErrorMessage('');
    try {
      await startGuestSession();
      setShowGuestConfirmModal(false);
      navigate('/');
    } catch (err) {
      setErrorMessage(err.message || 'Misafir oturumu başlatılamadı.');
    } finally {
      setGuestLoading(false);
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
            disabled={guestLoading}
          />

          {mode === 'login' && !isGuest && (
            <>
              <div className="login-divider">
                <span>veya</span>
              </div>
              <button
                type="button"
                className="login-guest-btn"
                onClick={() => setShowGuestConfirmModal(true)}
                disabled={loading || guestLoading}
              >
                {guestLoading ? 'Başlatılıyor...' : '👤 Misafir Olarak Devam Et'}
              </button>
            </>
          )}

          {mode === 'login' && (
            <button
              type="button"
              className="login-link"
              onClick={handleForgotPassword}
              disabled={resetLoading || guestLoading}
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
            disabled={guestLoading}
          >
            {mode === 'register' ? 'Zaten hesabın var mı? Giriş yap' : 'Hesabın yok mu? Kayıt ol'}
          </button>

          {isGuest && (
            <button
              type="button"
              className="login-link"
              style={{ marginTop: '8px', opacity: 0.8 }}
              onClick={() => navigate('/')}
            >
              ← Misafir moduna geri dön
            </button>
          )}
        </div>
      </form>

      {showGuestConfirmModal && (
        <GuestConfirmationModal
          open={showGuestConfirmModal}
          onClose={() => setShowGuestConfirmModal(false)}
          onConfirm={handleGuestConfirm}
          loading={guestLoading}
        />
      )}

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
