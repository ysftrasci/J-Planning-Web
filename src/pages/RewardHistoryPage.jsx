// J-Planning — Ödül ve Cüzdan Geçmişi Sayfası (Web)
// Mobildeki src/screens/RewardHistoryScreen.js dosyasının web karşılığı.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Gift, Wallet, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { getRedeemedRewards } from '../db/rewardRepository';
import { getWalletHistory, formatWalletTransactionReason } from '../db/taskRepository';
import EmptyState from '../components/EmptyState.jsx';
import './RewardHistoryPage.css';

function formatDate(timestamp) {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function RewardHistoryPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('wallet'); // 'wallet' | 'rewards'
  const [rewards, setRewards] = useState([]);
  const [transactions, setTransactions] = useState([]);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      getRedeemedRewards().catch(() => []),
      getWalletHistory('me').catch(() => []),
    ])
      .then(([rList, tList]) => {
        if (mounted) {
          setRewards(rList || []);
          setTransactions(tList || []);
        }
      })
      .catch((err) => console.error('Geçmiş yüklenemedi:', err));

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="reward-history-page">
      <button type="button" className="reward-history-page__back" onClick={() => navigate('/rewards')}>
        <ChevronLeft size={18} />
        Ödüller
      </button>

      <h1>Geçmiş</h1>

      <div className="reward-history-page__tabs">
        <button
          type="button"
          className={`reward-history-page__tab ${activeTab === 'wallet' ? 'reward-history-page__tab--active' : ''}`}
          onClick={() => setActiveTab('wallet')}
        >
          Cüzdan Hareketleri
        </button>
        <button
          type="button"
          className={`reward-history-page__tab ${activeTab === 'rewards' ? 'reward-history-page__tab--active' : ''}`}
          onClick={() => setActiveTab('rewards')}
        >
          Ödül Harcamaları
        </button>
      </div>

      {activeTab === 'wallet' &&
        (transactions.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title="Henüz cüzdan hareketi yok"
            subtitle="Görev tamamlayıp veya ödül kullanarak JP hareketlerini gör"
          />
        ) : (
          <div className="reward-history-page__list">
            {transactions.map((item) => (
              <div key={item.id} className="reward-history-page__card">
                <div
                  className="reward-history-page__icon-wrap"
                  style={{
                    backgroundColor:
                      item.amount > 0 ? 'var(--color-primary-soft, #E8F5E9)' : 'var(--color-danger-soft, #FFEBEE)',
                    color: item.amount > 0 ? 'var(--color-primary, #2E7D32)' : 'var(--color-danger, #C62828)',
                  }}
                >
                  {item.amount > 0 ? <ArrowDownLeft size={20} /> : <ArrowUpRight size={20} />}
                </div>
                <div className="reward-history-page__info">
                  <span className="reward-history-page__title">
                    {formatWalletTransactionReason(item.reason)}
                  </span>
                  <span className="reward-history-page__date">{formatDate(item.createdAt)}</span>
                </div>
                <span
                  className={`reward-history-page__cost ${item.amount > 0 ? 'reward-history-page__cost--positive' : ''}`}
                >
                  {item.amount > 0 ? `+${item.amount} JP` : `${item.amount} JP`}
                </span>
              </div>
            ))}
          </div>
        ))}

      {activeTab === 'rewards' &&
        (rewards.length === 0 ? (
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
        ))}
    </div>
  );
}
