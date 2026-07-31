// J-Planning — Arkadaşlarım Sayfası (Web)
// Mobildeki src/screens/FriendsListScreen.js dosyasının web karşılığı.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserPlus, ChevronRight, Users, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { listenFriends, listenPendingReceivedRequests, acceptFriendRequest, rejectFriendRequest } from '../services/friendService';
import EmptyState from '../components/EmptyState.jsx';
import './FriendsListPage.css';

export default function FriendsListPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [friends, setFriends] = useState([]);
  const [pendingReceived, setPendingReceived] = useState([]);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!user) return;
    const unsubFriends = listenFriends(user.uid, setFriends);
    const unsubPending = listenPendingReceivedRequests(user.uid, setPendingReceived);
    return () => {
      unsubFriends();
      unsubPending();
    };
  }, [user]);

  const handleAccept = (req) => {
    acceptFriendRequest(req.id).catch((e) => setErrorMessage(e.message));
  };

  const handleReject = (req) => {
    rejectFriendRequest(req.id).catch((e) => setErrorMessage(e.message));
  };

  return (
    <div className="friends-list-page">
      <div className="friends-list-page__header">
        <h1>Arkadaşlarım</h1>
        <button
          type="button"
          className="friends-list-page__add-button"
          onClick={() => navigate('/friends/add')}
          aria-label="Arkadaş ekle"
        >
          <UserPlus size={18} />
        </button>
      </div>

      {errorMessage && <p className="friends-list-page__error">{errorMessage}</p>}

      {pendingReceived.length > 0 && (
        <div className="friends-list-page__pending-section">
          <h2 className="friends-list-page__section-title">Bekleyen İstekler</h2>
          {pendingReceived.map((req) => (
            <div key={req.id} className="friends-list-page__pending-card">
              <div className="friends-list-page__pending-info">
                <span className="friends-list-page__name">{req.fromName}</span>
                <span className="friends-list-page__code">{req.fromCode}</span>
              </div>
              <button
                type="button"
                className="friends-list-page__reject-button"
                onClick={() => handleReject(req)}
                aria-label="İsteği reddet"
              >
                <X size={16} />
              </button>
              <button type="button" className="friends-list-page__accept-button" onClick={() => handleAccept(req)}>
                Kabul Et
              </button>
            </div>
          ))}
          <h2 className="friends-list-page__section-title">Arkadaşlarım</h2>
        </div>
      )}

      {friends.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Henüz arkadaşın yok"
          subtitle="Sağ üstteki butonla arkadaşının Kullanıcı ID'sini girerek istek gönder"
        />
      ) : (
        <div className="friends-list-page__list">
          {friends.map((item) => (
            <button
              type="button"
              key={item.id}
              className="friends-list-page__friend-card"
              onClick={() => navigate(`/friends/${item.id}`, { state: { friendName: item.friendName, friendUid: item.friendUid } })}
            >
              <div className="friends-list-page__avatar">
                {item.friendPhotoURL ? (
                  <img src={item.friendPhotoURL} alt="" className="friends-list-page__avatar-image" />
                ) : (
                  <span className="friends-list-page__avatar-text">{item.friendName.charAt(0).toUpperCase()}</span>
                )}
              </div>
              <div className="friends-list-page__friend-info">
                <span className="friends-list-page__name">{item.friendName}</span>
                <span className="friends-list-page__code">{item.friendCode}</span>
              </div>
              <ChevronRight size={18} className="friends-list-page__chevron" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
