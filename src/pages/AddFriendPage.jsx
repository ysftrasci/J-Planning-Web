// J-Planning — Arkadaş Ekle Sayfası (Web)
// Mobildeki src/screens/AddFriendScreen.js dosyasının web karşılığı.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
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

      <form className="add-friend-page__form" onSubmit={handleSend}>
        <label className="add-friend-page__label" htmlFor="friend-code">Arkadaşının Kullanıcı ID'si</label>
        <input
          id="friend-code"
          className="add-friend-page__input"
          type="text"
          placeholder="örn. JP-4821"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          autoFocus
        />
        <p className="add-friend-page__hint">
          Kullanıcı ID'ni Profil sekmesinden görebilirsin. Arkadaşından da kendi ID'sini istemen gerekiyor.
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
