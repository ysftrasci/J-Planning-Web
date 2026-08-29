// J-Planning — Ödüller Sayfası (Web)
// Mobildeki src/screens/RewardsScreen.js dosyasının web karşılığı.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HelpCircle, History, Gift, Plus, ChevronRight } from 'lucide-react';
import { getActiveRewards, createReward, redeemReward, deleteReward } from '../db/rewardRepository';
import { getWalletBalance, getStreakFreezeCount, buyStreakFreeze } from '../db/taskRepository';
import { useAuth } from '../context/AuthContext.jsx';
import { listenFriends } from '../services/friendService';
import { assignRewardToFriend, acceptAssignedReward, rejectAssignedReward, listenPendingRewardsAssignedToMe } from '../services/rewardAssignmentService';
import { PRIORITY_JP, STREAK_BONUS_JP, STREAK_BONUS_INTERVAL } from '../utils/rewards';
import AppButton from '../components/AppButton.jsx';
import AppModal from '../components/AppModal.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { triggerConfetti } from '../utils/confetti';
import './RewardsPage.css';

export default function RewardsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [balance, setBalance] = useState(0);
  const [freezeCount, setFreezeCount] = useState(0);
  const [rewards, setRewards] = useState([]);
  const [pendingRewards, setPendingRewards] = useState([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showHowToModal, setShowHowToModal] = useState(false);
  const [pendingToDecide, setPendingToDecide] = useState(null);
  const [rewardToRedeem, setRewardToRedeem] = useState(null);
  const [rewardToDelete, setRewardToDelete] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');

  const load = useCallback(async () => {
    try {
      const [wBalance, fCount, rList] = await Promise.all([
        getWalletBalance('me'),
        getStreakFreezeCount(),
        getActiveRewards(),
      ]);
      setBalance(wBalance);
      setFreezeCount(fCount);
      setRewards(rList);
    } catch (e) {
      console.error('Ödüller yüklenirken hata:', e);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!user) return;
    const unsub = listenPendingRewardsAssignedToMe(user.uid, setPendingRewards);
    return unsub;
  }, [user]);

  const handleBuyFreeze = async () => {
    try {
      await buyStreakFreeze(50);
      triggerConfetti();
      await load();
    } catch (e) {
      setErrorMessage(e.message);
    }
  };

  const confirmRedeem = async () => {
    if (!rewardToRedeem) return;
    try {
      await redeemReward(rewardToRedeem.id);
      triggerConfetti();
      setRewardToRedeem(null);
      await load();
    } catch (e) {
      setErrorMessage(e.message);
      setRewardToRedeem(null);
    }
  };

  const confirmDelete = async () => {
    if (!rewardToDelete) return;
    try {
      await deleteReward(rewardToDelete.id);
      setRewardToDelete(null);
      await load();
    } catch (e) {
      console.error('Ödül silinemedi:', e);
    }
  };

  const handleAcceptPending = async () => {
    if (!pendingToDecide) return;
    try {
      await acceptAssignedReward(pendingToDecide.id);
      await createReward({
        title: pendingToDecide.title,
        description: pendingToDecide.description,
        cost: pendingToDecide.cost,
      });
      setPendingToDecide(null);
      await load();
    } catch (e) {
      setErrorMessage(e.message);
    }
  };

  const handleRejectPending = async () => {
    if (!pendingToDecide) return;
    try {
      await rejectAssignedReward(pendingToDecide.id);
      setPendingToDecide(null);
    } catch (e) {
      setErrorMessage(e.message);
    }
  };

  return (
    <div className="rewards-page">
      <div className="rewards-page__balance-card">
        <span className="rewards-page__balance-label">JP Bakiyen</span>
        <span className="rewards-page__balance-value">{balance} JP</span>
        <div className="rewards-page__balance-buttons">
          <button type="button" className="rewards-page__how-to-button" onClick={() => setShowHowToModal(true)}>
            <HelpCircle size={16} />
            JP nasıl kazanılır?
          </button>
          <button type="button" className="rewards-page__how-to-button" onClick={() => navigate('/rewards/history')}>
            <History size={16} />
            Geçmiş
          </button>
        </div>
      </div>

      {errorMessage && <p className="rewards-page__error-banner">{errorMessage}</p>}

      {/* Özel Güç Mağazası: Seri Dondurma Rozeti */}
      <div className="rewards-page__section">
        <h2 className="rewards-page__section-title">Özel Güçler 🧊</h2>
        <div className="rewards-page__card" style={{ border: '1px solid var(--color-accent)' }}>
          <div className="rewards-page__card-info">
            <span className="rewards-page__card-title">Seri Dondurma Rozeti 🧊</span>
            <span className="rewards-page__card-desc">
              Bir gün görevi unutursanız serinizin sıfırlanmasını engeller (Mevcut: {freezeCount} Adet).
            </span>
            <span className="rewards-page__card-cost">50 JP</span>
          </div>
          <div className="rewards-page__card-actions">
            <AppButton
              title={balance >= 50 ? 'Satın Al (50 JP)' : 'Yetersiz JP'}
              variant="primary"
              disabled={balance < 50}
              onClick={handleBuyFreeze}
              style={{ padding: 'var(--space-sm) var(--space-md)' }}
            />
          </div>
        </div>
      </div>

      {pendingRewards.length > 0 && (
        <div className="rewards-page__section">
          <h2 className="rewards-page__section-title">Sana Atanan Hedefler</h2>
          {pendingRewards.map((r) => (
            <button type="button" key={r.id} className="rewards-page__pending-card" onClick={() => setPendingToDecide(r)}>
              <Gift size={20} />
              <div className="rewards-page__pending-info">
                <span className="rewards-page__card-title">{r.title}</span>
                <span className="rewards-page__pending-meta">{r.assignedByName} tarafından — {r.cost} JP</span>
              </div>
              <ChevronRight size={16} />
            </button>
          ))}
        </div>
      )}

      <div className="rewards-page__section-header">
        <h2 className="rewards-page__section-title">Ödül Hedeflerim</h2>
        <button
          type="button"
          className="rewards-page__add-button"
          onClick={() => setShowAddModal(true)}
          aria-label="Yeni ödül hedefi ekle"
        >
          <Plus size={24} />
        </button>
      </div>

      {rewards.length === 0 ? (
        <EmptyState icon={Gift} title="Henüz ödül hedefin yok" subtitle="Kendine bir ödül belirle ve JP biriktir" />
      ) : (
        <div className="rewards-page__list">
          {rewards.map((reward) => (
            <div key={reward.id} className="rewards-page__card">
              <div className="rewards-page__card-info">
                <span className="rewards-page__card-title">{reward.title}</span>
                {reward.description && <span className="rewards-page__card-desc">{reward.description}</span>}
                <span className="rewards-page__card-cost">{reward.cost} JP</span>
              </div>
              <div className="rewards-page__card-actions">
                <AppButton
                  title={balance >= reward.cost ? 'Harca' : 'Yetersiz'}
                  variant="secondary"
                  disabled={balance < reward.cost}
                  onClick={() => setRewardToRedeem(reward)}
                  style={{ padding: 'var(--space-sm) var(--space-md)' }}
                />
                <button type="button" className="rewards-page__delete-link" onClick={() => setRewardToDelete(reward)}>
                  Sil
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <AddRewardModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSaved={async () => {
          setShowAddModal(false);
          await load();
        }}
      />

      <AppModal open={!!rewardToRedeem} onClose={() => setRewardToRedeem(null)} title="Ödülü Harcama">
        <p className="caption">
          "{rewardToRedeem?.title}" ödülünü {rewardToRedeem?.cost} JP karşılığında harcamak istiyor musun?
        </p>
        <div className="rewards-page__modal-actions">
          <AppButton title="Vazgeç" variant="ghost" onClick={() => setRewardToRedeem(null)} />
          <AppButton title="Harca" onClick={confirmRedeem} />
        </div>
      </AppModal>

      <AppModal open={!!rewardToDelete} onClose={() => setRewardToDelete(null)} title="Ödülü Sil">
        <p className="caption">"{rewardToDelete?.title}" hedefini silmek istiyor musun?</p>
        <div className="rewards-page__modal-actions">
          <AppButton title="Vazgeç" variant="ghost" onClick={() => setRewardToDelete(null)} />
          <AppButton title="Sil" variant="danger" onClick={confirmDelete} />
        </div>
      </AppModal>

      <AppModal open={!!pendingToDecide} onClose={() => setPendingToDecide(null)} title="Ödül Hedefi">
        <p className="caption">
          {pendingToDecide?.assignedByName || 'Bir arkadaşın'} sana "{pendingToDecide?.title}" ödül hedefini koydu. Kabul ediyor musun?
        </p>
        <div className="rewards-page__modal-actions">
          <AppButton title="Reddet" variant="danger" onClick={handleRejectPending} />
          <AppButton title="Kabul Et" onClick={handleAcceptPending} />
        </div>
      </AppModal>

      <HowToEarnModal open={showHowToModal} onClose={() => setShowHowToModal(false)} />
    </div>
  );
}

function AddRewardModal({ open, onClose, onSaved }) {
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [cost, setCost] = useState('');
  const [assignTo, setAssignTo] = useState('me'); // 'me' | friendUid
  const [friends, setFriends] = useState([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !user) return;
    const unsub = listenFriends(user.uid, setFriends);
    return unsub;
  }, [open, user]);

  const resetAndClose = () => {
    setTitle('');
    setDescription('');
    setCost('');
    setAssignTo('me');
    setErrorMessage('');
    onClose();
  };

  const handleSave = async (e) => {
    e.preventDefault();
    const costNum = parseInt(cost, 10);
    if (!title.trim() || !costNum || costNum <= 0) {
      setErrorMessage('Lütfen başlık ve geçerli bir JP maliyeti gir.');
      return;
    }

    if (assignTo === 'me') {
      try {
        setSaving(true);
        await createReward({ title: title.trim(), description: description.trim(), cost: costNum });
        resetAndClose();
        onSaved();
      } catch (err) {
        setErrorMessage(err.message || 'Ödül eklenemedi.');
      } finally {
        setSaving(false);
      }
      return;
    }

    const friend = friends.find((f) => f.friendUid === assignTo);
    setSaving(true);
    try {
      await assignRewardToFriend({
        assignedByUid: user.uid,
        assignedByName: user.profile?.displayName || user.displayName || 'Kullanıcı',
        assignedToUid: assignTo,
        assignedToName: friend?.friendName ?? 'Arkadaşın',
        title: title.trim(),
        description: description.trim(),
        cost: costNum,
      });
      resetAndClose();
      onSaved();
    } catch (e2) {
      setErrorMessage(e2.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppModal open={open} onClose={resetAndClose} title="Yeni Ödül Hedefi">
      <form className="rewards-page__form" onSubmit={handleSave}>
        <input
          className="rewards-page__input"
          type="text"
          placeholder="Başlık"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
          disabled={saving}
        />
        <input
          className="rewards-page__input"
          type="text"
          placeholder="Açıklama (opsiyonel)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={saving}
        />
        <input
          className="rewards-page__input"
          type="number"
          min="1"
          placeholder="Maliyet (JP)"
          value={cost}
          onChange={(e) => setCost(e.target.value)}
          disabled={saving}
        />

        <span className="rewards-page__label">Kime atanacak?</span>
        <div className="rewards-page__chip-row">
          <Chip label="Kendime" selected={assignTo === 'me'} onClick={() => setAssignTo('me')} />
          {friends.map((f) => (
            <Chip key={f.friendUid} label={f.friendName} selected={assignTo === f.friendUid} onClick={() => setAssignTo(f.friendUid)} />
          ))}
        </div>

        {errorMessage && <p className="rewards-page__form-error">{errorMessage}</p>}

        <div className="rewards-page__modal-actions">
          <AppButton type="button" title="Vazgeç" variant="ghost" onClick={resetAndClose} disabled={saving} />
          <AppButton type="submit" title={saving ? 'Kaydediliyor...' : 'Kaydet'} disabled={saving} />
        </div>
      </form>
    </AppModal>
  );
}

function HowToEarnModal({ open, onClose }) {
  return (
    <AppModal open={open} onClose={onClose} title="JP Nasıl Kazanılır?">
      <div className="rewards-page__how-to-row">
        <span>Yüksek öncelikli görev</span>
        <span className="rewards-page__how-to-value">{PRIORITY_JP.HIGH} JP</span>
      </div>
      <div className="rewards-page__how-to-row">
        <span>Orta öncelikli görev</span>
        <span className="rewards-page__how-to-value">{PRIORITY_JP.MEDIUM} JP</span>
      </div>
      <div className="rewards-page__how-to-row">
        <span>Düşük öncelikli görev</span>
        <span className="rewards-page__how-to-value">{PRIORITY_JP.LOW} JP</span>
      </div>
      <div className="rewards-page__how-to-divider" />
      <p className="rewards-page__how-to-bonus">
        Bir görevi {STREAK_BONUS_INTERVAL} gün üst üste tamamlarsan, o gün +{STREAK_BONUS_JP} JP bonus kazanırsın.
        Bu bonus her {STREAK_BONUS_INTERVAL}. tekrarda (5, 10, 15...) yeniden verilir.
      </p>
      <AppButton title="Anladım" onClick={onClose} />
    </AppModal>
  );
}

function Chip({ label, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rewards-page__chip ${selected ? 'rewards-page__chip--selected' : ''}`}
    >
      {label}
    </button>
  );
}
