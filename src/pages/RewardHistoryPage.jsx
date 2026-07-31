// J-Planning — Ödül Geçmişi Sayfası (Web)
// Mobildeki src/screens/RewardHistoryScreen.js dosyasının web karşılığı.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Gift } from 'lucide-react';
import { getRedeemedRewards } from '../db/rewardRepository';
import EmptyState from '../components/EmptyState.jsx';
import './RewardHistoryPage.css';

function formatDate(timestamp) {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function RewardHistoryPage() {
  const navigate = useNavigate();
  const [rewards, setRewards] = useState([]);

  useEffect(() => {
    setRewards(getRedeemedRewards());
  }, []);

  return (
    <div className="reward-history-page">
      <button type="button" className="reward-history-page__back" onClick={() => navigate('/rewards')}>
        <ChevronLeft size={18} />
        Ödüller
      </button>

      <h1>Harcama Geçmişi</h1>

      {rewards.length === 0 ? (
        <EmptyState icon={Gift} title="Henüz harcanmış ödül yok" subtitle="Bir ödül harcadığında burada görünecek" />
      ) : (
        <div className="reward-history-page__list">
          {rewards.map((item) => (
            <div key={item.id} className="reward-history-page__card">
              <div className="reward-history-page__icon-wrap">
                <Gift size={20} />
              </div>
              <div className="reward-history-page__info">
                <span className="reward-history-page__title">{item.title}</span>
                <span className="reward-history-page__date">{formatDate(item.redeemedAt)}</span>
              </div>
              <span className="reward-history-page__cost">-{item.cost} JP</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
