// J-Planning — Arkadaş Detay Sayfası (Web)
// Mobildeki src/screens/FriendDetailScreen.js dosyasının web karşılığı.
import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { listenFriends, removeFriend } from '../services/friendService';
import AppButton from '../components/AppButton.jsx';
import AppModal from '../components/AppModal.jsx';
import './FriendDetailPage.css';

export default function FriendDetailPage() {
  const { friendshipId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();

  // Sayfaya FriendsListPage üzerinden gelindiyse isim state'te hazır bulunur.
  // Sayfa doğrudan yenilenirse (state kaybolur), arkadaş listesinden tekrar bulunur.
  const [friendName, setFriendName] = useState(location.state?.friendName || '');
  const [loading, setLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (friendName || !user) return;
    const unsub = listenFriends(user.uid, (friends) => {
      const match = friends.find((f) => f.id === friendshipId);
      if (match) setFriendName(match.friendName);
    });
    return unsub;
  }, [friendName, user, friendshipId]);

  const handleRemove = async () => {
    setLoading(true);
    try {
      await removeFriend(friendshipId);
      navigate('/friends');
    } catch (e) {
      setErrorMessage(e.message);
      setShowConfirm(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="friend-detail-page">
      <button type="button" className="friend-detail-page__back" onClick={() => navigate('/friends')}>
        <ChevronLeft size={18} />
        Arkadaşlarım
      </button>

      {errorMessage && <p className="friend-detail-page__error">{errorMessage}</p>}

      <div className="friend-detail-page__content">
        <div className="friend-detail-page__avatar">
          <span>{friendName ? friendName.charAt(0).toUpperCase() : '?'}</span>
        </div>
        <h1 className="friend-detail-page__name">{friendName || 'Yükleniyor...'}</h1>
        <p className="friend-detail-page__hint">
          Bu arkadaşınla birbirinize atadığınız görev ve ödül hedeflerini karşılıklı görebilirsiniz.
        </p>
      </div>

      <div className="friend-detail-page__footer">
        <AppButton title="Arkadaşlığı Sonlandır" variant="danger" onClick={() => setShowConfirm(true)} />
      </div>

      <AppModal open={showConfirm} onClose={() => setShowConfirm(false)} title="Arkadaşlığı Sonlandır">
        <p className="caption">{friendName} ile arkadaşlığını sonlandırmak istediğine emin misin?</p>
        <div className="friend-detail-page__modal-actions">
          <AppButton title="Vazgeç" variant="ghost" onClick={() => setShowConfirm(false)} />
          <AppButton title="Sonlandır" variant="danger" onClick={handleRemove} loading={loading} />
        </div>
      </AppModal>
    </div>
  );
}
