// J-Planning — Arkadaş Ekle Sayfası (Web)
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Copy, Check } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { sendFriendRequest } from '../services/friendService';
import AppButton from '../components/AppButton.jsx';
import './AddFriendPage.css';

export default function AddFriendPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [copied, setCopied] = useState(false);

  const myCode = user?.profile?.userCode;

  const handleCopyMyCode = () => {
    if (myCode) {
      navigator.clipboard?.writeText(myCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (!code.trim()) {
      setErrorMessage('Lütfen bir Kullanıcı ID gir.');
      return;
    }
    setLoading(true);
    setErrorMessage('');
    try {
      await sendFriendRequest(user, code);
      setSuccessMessage(`${code.trim().toUpperCase()} kodlu kullanıcıya arkadaşlık isteği gönderildi.`);
      setTimeout(() => navigate('/friends'), 1200);
    } catch (e2) {
      setErrorMessage(e2.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="add-friend-page">
      <button type="button" className="add-friend-page__back" onClick={() => navigate('/friends')}>
        <ChevronLeft size={18} />
        Arkadaşlarım
      </button>

      <h1>Arkadaş Ekle</h1>

      {myCode && (
        <div
          style={{
            background: 'var(--color-surface, #ffffff)',
            border: '1px solid var(--color-border, #e5e5e5)',
            borderRadius: 'var(--radius-lg, 12px)',
            padding: 'var(--space-md, 16px)',
            marginBottom: 'var(--space-lg, 24px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          <div>
            <span style={{ fontSize: '12px', color: 'var(--color-text-secondary, #666)', display: 'block' }}>
              Senin Kullanıcı Kodun
            </span>
            <strong style={{ fontSize: '18px', letterSpacing: '1px', color: 'var(--color-primary, #C98A2C)' }}>
              {myCode}
            </strong>
          </div>
          <button
            type="button"
            onClick={handleCopyMyCode}
            style={{
              padding: '6px 14px',
              borderRadius: 'var(--radius-pill, 999px)',
              border: '1px solid var(--color-border, #e5e5e5)',
              background: copied ? 'var(--color-success, #10b981)' : 'var(--color-surface-hover, #f5f5f5)',
              color: copied ? '#fff' : 'inherit',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '13px',
              fontWeight: '600',
              transition: 'all 0.2s ease',
            }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Kopyalandı' : 'Kodu Kopyala'}
          </button>
        </div>
      )}

      <form className="add-friend-page__form" onSubmit={handleSend}>
        <label className="add-friend-page__label" htmlFor="friend-code">Arkadaşının Kullanıcı ID'si</label>
        <input
          id="friend-code"
          className="add-friend-page__input"
          type="text"
          placeholder="örn. JP-K89X42"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          autoFocus
        />
        <p className="add-friend-page__hint">
          Arkadaşının sana gönderdiği kodu buraya girerek arkadaşlık isteği gönderebilirsin.
        </p>

        {errorMessage && <p className="add-friend-page__error">{errorMessage}</p>}
        {successMessage && <p className="add-friend-page__success">{successMessage}</p>}

        <div className="add-friend-page__footer">
          <AppButton type="submit" title="İstek Gönder" loading={loading} />
        </div>
      </form>
    </div>
  );
}
