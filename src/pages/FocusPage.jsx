import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  History,
  Coins,
  VolumeX,
  Radio,
  Flame,
  CloudRain,
  Waves,
  Music,
  ChevronRight,
  Check,
  AlertTriangle,
  Trophy,
  Pause,
  Play,
} from 'lucide-react';
import AppButton from '../components/AppButton.jsx';
import AppModal from '../components/AppModal.jsx';
import { playFocusSound, stopFocusSound } from '../services/focusSoundService.js';
import { FOCUS_MILESTONES, computeMilestoneAward } from '../utils/rewards.js';
import {
  generateSessionId,
  awardFocusMilestone,
  finalizeFocusSession,
} from '../db/focusSessionRepository.js';
import { triggerConfetti } from '../utils/confetti.js';
import './FocusPage.css';

const SOUND_OPTIONS = [
  { key: 'none', label: 'Ses Yok', Icon: VolumeX },
  { key: 'white_noise', label: 'Beyaz Gürültü', Icon: Radio },
  { key: 'summer_night_camp', label: 'Yaz Gecesi Kamp', Icon: Flame },
  { key: 'ocean_waves', label: 'Sahil / Dalga Sesi', Icon: Waves },
  { key: 'rain', label: 'Yağmur Sesi', Icon: CloudRain },
  { key: 'budgie', label: 'Muhabbet Kuşu', Icon: Music },
  { key: 'fireplace', label: 'Ateş / Şömine', Icon: Flame },
];

function formatElapsed(totalSeconds) {
  const safeSec = Math.max(0, Math.floor(totalSeconds));
  if (safeSec < 3600) {
    const m = Math.floor(safeSec / 60);
    const s = safeSec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  const h = Math.floor(safeSec / 3600);
  const m = Math.floor((safeSec % 3600) / 60);
  const s = safeSec % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatCountdown(remainingSeconds) {
  const safeSec = Math.max(0, Math.ceil(remainingSeconds));
  const m = Math.floor(safeSec / 60);
  const s = safeSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Sonraki ödüle kalan saniye ve sonraki milestone'u döndürür
function getNextMilestoneInfo(elapsedSeconds, awardedMins) {
  for (const m of FOCUS_MILESTONES) {
    if (!awardedMins.has(m.min)) {
      const remainingSec = Math.ceil((m.min * 60) - elapsedSeconds);
      return { nextMin: m.min, remainingSec: Math.max(0, remainingSec) };
    }
  }
  return null; // Tüm milestone'lar kazanıldı
}

export default function FocusPage() {
  const navigate = useNavigate();
  const [selectedSound, setSelectedSound] = useState('none');
  const [showSoundPicker, setShowSoundPicker] = useState(false);
  const [showStopConfirm, setShowStopConfirm] = useState(false);

  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [completedJp, setCompletedJp] = useState(0);
  const [completedMinutes, setCompletedMinutes] = useState(0);

  // Yukarı sayaç state
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  // Kazanılan milestone'lar (Set<number> olarak min değerleri)
  const [awardedMins, setAwardedMins] = useState(new Set());
  // Toplam kazanılan JP (anlık gösterim için)
  const [totalEarnedJp, setTotalEarnedJp] = useState(0);
  // Son milestone kutlaması
  const [celebratingMilestone, setCelebratingMilestone] = useState(null);

  const sessionIdRef = useRef(null);
  const intervalRef = useRef(null);
  const startTimeRef = useRef(null);          // Başlangıç timestamp (ms)
  const pausedElapsedRef = useRef(0);         // Duraklama anındaki geçen süre (saniye)
  const awardedMinsRef = useRef(new Set());   // Ref kopyası (closure'da güncel kalmak için)
  const totalEarnedJpRef = useRef(0);
  const selectedSoundRef = useRef('none');

  useEffect(() => {
    selectedSoundRef.current = selectedSound;
  }, [selectedSound]);

  // Unmount'ta temizle (sayfadan ayrılınca seans sıfırlanır, ses durdurulur)
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      stopFocusSound();
    };
  }, []);

  const checkAndAwardMilestones = useCallback(async (elapsed) => {
    const { newJp, newlyAwarded } = computeMilestoneAward(elapsed, awardedMinsRef.current);
    if (newlyAwarded.length === 0) return;

    // Idempotency: Ref'e hemen ekle ki interval veya render içinde ikinci kez tetiklenmesin
    for (const min of newlyAwarded) {
      awardedMinsRef.current.add(min);
    }
    setAwardedMins(new Set(awardedMinsRef.current));

    const newMilestonesList = FOCUS_MILESTONES.filter((m) => newlyAwarded.includes(m.min));
    const currentElapsedMinutes = Math.floor(elapsed / 60);

    // Cüzdana ve focus_sessions tablosuna atomik/idempotent yaz
    try {
      const res = await awardFocusMilestone({
        sessionId: sessionIdRef.current,
        durationMinutes: currentElapsedMinutes,
        soundKey: selectedSoundRef.current,
        newMilestones: newMilestonesList,
        awardedMins: awardedMinsRef.current,
      });
      totalEarnedJpRef.current = res.totalSessionJp;
      setTotalEarnedJp(res.totalSessionJp);
    } catch (e) {
      console.error('[Focus] Milestone ödül kaydetme hatası:', e);
      // Hata durumunda yerel toplamı güncelle
      totalEarnedJpRef.current += newJp;
      setTotalEarnedJp(totalEarnedJpRef.current);
    }

    // Kutlama: en son kazanılan milestone
    const lastMin = newlyAwarded[newlyAwarded.length - 1];
    setCelebratingMilestone(lastMin);
    triggerConfetti();
    setTimeout(() => setCelebratingMilestone(null), 2500);
  }, []);

  // Sekme değiştirme / ekrana geri dönme dinleyicisi
  useEffect(() => {
    const handleVisibilityOrFocusChange = () => {
      if (document.visibilityState === 'visible' && startTimeRef.current && !isPaused) {
        const now = Date.now();
        const elapsed = Math.floor((now - startTimeRef.current) / 1000) + pausedElapsedRef.current;
        setElapsedSeconds(elapsed);
        checkAndAwardMilestones(elapsed);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityOrFocusChange);
    window.addEventListener('focus', handleVisibilityOrFocusChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityOrFocusChange);
      window.removeEventListener('focus', handleVisibilityOrFocusChange);
    };
  }, [isPaused, checkAndAwardMilestones]);

  const startTick = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      if (!startTimeRef.current) return;
      const now = Date.now();
      const elapsed = Math.floor((now - startTimeRef.current) / 1000) + pausedElapsedRef.current;
      setElapsedSeconds(elapsed);
      checkAndAwardMilestones(elapsed);
    }, 1000);
  }, [checkAndAwardMilestones]);

  const handleStart = async () => {
    const newSessionId = generateSessionId();
    sessionIdRef.current = newSessionId;
    startTimeRef.current = Date.now();
    pausedElapsedRef.current = 0;
    awardedMinsRef.current = new Set();
    totalEarnedJpRef.current = 0;
    setElapsedSeconds(0);
    setAwardedMins(new Set());
    setTotalEarnedJp(0);
    setIsRunning(true);
    setIsPaused(false);
    setIsCompleted(false);
    await playFocusSound(selectedSoundRef.current);
    startTick();
  };

  const handlePause = async () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    // Duraklama anındaki geçen süreyi kaydet
    if (startTimeRef.current) {
      pausedElapsedRef.current = Math.floor((Date.now() - startTimeRef.current) / 1000) + pausedElapsedRef.current;
    }
    startTimeRef.current = null;
    await stopFocusSound();
    setIsPaused(true);
  };

  const handleResume = async () => {
    startTimeRef.current = Date.now();
    setIsPaused(false);
    await playFocusSound(selectedSoundRef.current);
    startTick();
  };

  const confirmStop = async () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    const finalElapsed = elapsedSeconds;
    const finalMinutes = Math.floor(finalElapsed / 60);
    const finalJp = totalEarnedJpRef.current;
    startTimeRef.current = null;
    await stopFocusSound();

    setShowStopConfirm(false);
    setIsRunning(false);
    setIsPaused(false);

    // Kural: Yalnızca en az 1 eşik (30 dk) kazanıldıysa seans kaydını güncelle
    // 30 dakikaya ulaşmadan bırakılan seans kayıt yazmaz, JP verilmez (eski davranış)
    if (finalMinutes >= 30 && sessionIdRef.current) {
      try {
        await finalizeFocusSession({
          sessionId: sessionIdRef.current,
          durationMinutes: finalMinutes,
        });
      } catch (e) {
        console.error('[Focus] Seans sonlandırma süresi güncelleme hatası:', e);
      }
    }

    setCompletedMinutes(finalMinutes);
    setCompletedJp(finalJp);
    setIsCompleted(true);
  };

  const handleFinishCompletion = () => {
    setIsCompleted(false);
    setIsRunning(false);
    setIsPaused(false);
    setElapsedSeconds(0);
    setAwardedMins(new Set());
    setTotalEarnedJp(0);
    sessionIdRef.current = null;
    awardedMinsRef.current = new Set();
    totalEarnedJpRef.current = 0;
    pausedElapsedRef.current = 0;
  };

  const handleSelectSound = async (key) => {
    setSelectedSound(key);
    selectedSoundRef.current = key;
    setShowSoundPicker(false);
    if (isRunning && !isPaused) {
      await playFocusSound(key);
    }
  };

  const activeSoundObj = SOUND_OPTIONS.find((s) => s.key === selectedSound) || SOUND_OPTIONS[0];
  const ActiveSoundIcon = activeSoundObj.Icon;

  // Milestone yol haritası bilgisi
  const nextMilestoneInfo = getNextMilestoneInfo(elapsedSeconds, awardedMins);
  const allMilestonesEarned = awardedMins.size === FOCUS_MILESTONES.length;

  // İlerleme çubuğu: sıradaki eşiğe göre
  let progressPct = 0;
  if (!allMilestonesEarned && nextMilestoneInfo) {
    const idx = FOCUS_MILESTONES.findIndex((m) => m.min === nextMilestoneInfo.nextMin);
    const prevMin = idx > 0 ? FOCUS_MILESTONES[idx - 1].min : 0;
    const rangeSec = (nextMilestoneInfo.nextMin - prevMin) * 60;
    const doneSec = Math.max(0, elapsedSeconds - prevMin * 60);
    progressPct = Math.min(100, Math.max(0, Math.round((doneSec / rangeSec) * 100)));
  } else if (allMilestonesEarned) {
    progressPct = 100;
  }

  // Odaklanma Tamamlandı (Tebrikler Ekranı)
  if (isCompleted) {
    return (
      <div className="focus-page focus-page--completed">
        <div className="focus-page__completed-card">
          <div className="focus-page__completed-icon-wrap">
            <Trophy size={48} color="var(--color-accent)" />
          </div>
          <h1>Tebrikler! 🎯</h1>
          <p className="focus-page__completed-text">
            <strong>{completedMinutes} dakikalık</strong> odaklanma seansını tamamladın.
          </p>
          {completedJp > 0 ? (
            <div className="focus-page__completed-badge">
              <Coins size={20} color="var(--color-accent-dark)" />
              <span>+{completedJp} JP Kazandın!</span>
            </div>
          ) : (
            <p className="focus-page__completed-subtext">
              (30 dakikadan kısa seanslarda JP ödülü verilmemektedir.)
            </p>
          )}

          <AppButton
            title="Tamam (Odaklanma Ekranına Dön)"
            onClick={handleFinishCompletion}
            style={{ width: '100%', marginTop: 'var(--space-lg)' }}
          />
        </div>
      </div>
    );
  }

  // Odaklanma Devam Ediyor (Sayaç Ekranı)
  if (isRunning) {
    return (
      <div className="focus-page focus-page--running">
        <div className="focus-page__running-content">
          <span className="focus-page__running-label">
            {isPaused ? '⏸ Odaklanma Duraklatıldı' : 'Odaklanma Modu'}
          </span>

          {/* Büyük yukarı sayan sayaç */}
          <div className={`focus-page__timer ${isPaused ? 'focus-page__timer--paused' : ''}`}>
            {formatElapsed(elapsedSeconds)}
          </div>

          {/* İlerleme çubuğu (sıradaki eşiğe göre) */}
          <div className="focus-page__progress-track">
            <div className="focus-page__progress-fill" style={{ width: `${progressPct}%` }} />
          </div>

          {/* Milestone yol haritası */}
          <div className="focus-page__milestones">
            {FOCUS_MILESTONES.map((m, idx) => {
              const earned = awardedMins.has(m.min);
              const isCelebrating = celebratingMilestone === m.min;
              const cumulativeJp = FOCUS_MILESTONES.slice(0, idx + 1).reduce((s, x) => s + x.jp, 0);
              const isNext = !earned && FOCUS_MILESTONES.slice(0, idx).every((prev) => awardedMins.has(prev.min));

              return (
                <div
                  key={m.min}
                  className={`focus-page__milestone${earned ? ' focus-page__milestone--earned' : ''}${isNext ? ' focus-page__milestone--next' : ''}${isCelebrating ? ' focus-page__milestone--celebrating' : ''}`}
                >
                  <span className="focus-page__milestone-check">{earned ? '✓' : '·'}</span>
                  <span className="focus-page__milestone-label">{m.min} dk</span>
                  <span className="focus-page__milestone-jp">+{cumulativeJp} JP</span>
                </div>
              );
            })}

            {/* Sıradaki ödüle kalan süre */}
            {nextMilestoneInfo && !isPaused && (
              <div className="focus-page__milestone-countdown">
                sonraki ödüle {formatCountdown(nextMilestoneInfo.remainingSec)}
              </div>
            )}
            {allMilestonesEarned && (
              <div className="focus-page__milestone-all-done">
                🏆 Tüm ödüller kazanıldı! Sayaç devam ediyor.
              </div>
            )}
          </div>

          {/* Toplam kazanılan JP */}
          {totalEarnedJp > 0 && (
            <div className="focus-page__earned-jp">
              <Coins size={16} color="var(--color-accent)" />
              <span>+{totalEarnedJp} JP kazanıldı</span>
            </div>
          )}

          <button
            type="button"
            className="focus-page__sound-badge"
            onClick={() => setShowSoundPicker(true)}
            title="Arka Plan Sesini Değiştir"
          >
            <ActiveSoundIcon size={18} />
            <span>Ses: {activeSoundObj.label} {isPaused ? '(Sessiz)' : ''}</span>
          </button>
        </div>

        <div className="focus-page__running-footer" style={{ display: 'flex', gap: 'var(--space-md)' }}>
          {isPaused ? (
            <AppButton
              title="Devam Et"
              icon={Play}
              variant="primary"
              onClick={handleResume}
              style={{ flex: 1 }}
            />
          ) : (
            <AppButton
              title="Duraklat"
              icon={Pause}
              variant="secondary"
              onClick={handlePause}
              style={{ flex: 1 }}
            />
          )}
          <AppButton
            title="Seansı Bitir"
            variant="danger"
            onClick={() => setShowStopConfirm(true)}
            style={{ flex: 1 }}
          />
        </div>

        {/* Ses Seçici Modal (Çalışırken) */}
        {showSoundPicker && (
          <AppModal
            open={showSoundPicker}
            onClose={() => setShowSoundPicker(false)}
            title="Arka Plan Sesi Seç"
          >
            <div className="focus-page__sound-list">
              {SOUND_OPTIONS.map((opt) => {
                const ItemIcon = opt.Icon;
                const isSelected = selectedSound === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    className={`focus-page__sound-option ${isSelected ? 'focus-page__sound-option--selected' : ''}`}
                    onClick={() => handleSelectSound(opt.key)}
                  >
                    <ItemIcon size={20} className="focus-page__sound-icon" />
                    <span className="focus-page__sound-label">{opt.label}</span>
                    {isSelected && <Check size={18} className="focus-page__sound-check" />}
                  </button>
                );
              })}
            </div>
          </AppModal>
        )}

        {/* Seansı Erken Bitirme Onay Modali */}
        {showStopConfirm && (
          <AppModal
            open={showStopConfirm}
            onClose={() => setShowStopConfirm(false)}
            title="Seansı Bitir"
          >
            <div className="focus-page__confirm-body">
              <AlertTriangle size={40} color="var(--color-danger, #ef4444)" />
              <p>
                Odaklanma seansını bitirmek istediğinize emin misiniz?
                {totalEarnedJp > 0
                  ? ` Şimdiye kadar kazandığın ${totalEarnedJp} JP korunacak.`
                  : ' Henüz JP kazanılmadı (ilk eşik 30 dakika).'}
              </p>
              <div className="focus-page__confirm-actions">
                <AppButton
                  title="Vazgeç"
                  variant="secondary"
                  onClick={() => setShowStopConfirm(false)}
                />
                <AppButton
                  title="Bitir"
                  variant="danger"
                  onClick={confirmStop}
                />
              </div>
            </div>
          </AppModal>
        )}
      </div>
    );
  }

  // Ana Odaklanma Ayar Ekranı (00:00 ve Başla)
  return (
    <div className="focus-page">
      <div className="focus-page__header">
        <div className="focus-page__header-text">
          <h1>Odaklanma</h1>
          <p className="focus-page__subtitle">
            Ders çalışırken ya da işlerini yaparken dikkatini dağıtmadan bir süre ayır.
          </p>
        </div>
        <button
          type="button"
          className="focus-page__history-button"
          onClick={() => navigate('/focus/history')}
          title="Geçmiş Seanslar"
        >
          <History size={20} />
        </button>
      </div>

      {/* Büyük sıfır sayaç */}
      <div className="focus-page__idle-timer">00:00</div>

      {/* Ödül yol haritası önizlemesi */}
      <div className="focus-page__roadmap">
        <p className="focus-page__roadmap-title">
          <Coins size={16} color="var(--color-accent-dark)" /> Ödül Yol Haritası
        </p>
        {FOCUS_MILESTONES.map((m, idx) => {
          const cumulative = FOCUS_MILESTONES.slice(0, idx + 1).reduce((s, x) => s + x.jp, 0);
          return (
            <div key={m.min} className="focus-page__roadmap-item">
              <span className="focus-page__roadmap-dot">·</span>
              <span className="focus-page__roadmap-time">{m.min} dk</span>
              <span className="focus-page__roadmap-reward">+{cumulative} JP</span>
            </div>
          );
        })}
      </div>

      <div className="focus-page__section">
        <label className="focus-page__section-title">Arka Plan Sesi</label>
        <button
          type="button"
          className="focus-page__sound-selector"
          onClick={() => setShowSoundPicker(true)}
        >
          <ActiveSoundIcon size={20} />
          <span className="focus-page__sound-selector-text">{activeSoundObj.label}</span>
          <ChevronRight size={18} color="var(--color-text-muted)" />
        </button>
      </div>

      <div className="focus-page__start-wrap">
        <AppButton
          title="Başla"
          onClick={handleStart}
          style={{ width: '100%' }}
        />
      </div>

      {/* Ses Seçici Modal (Ayar ekranı) */}
      {showSoundPicker && (
        <AppModal
          open={showSoundPicker}
          onClose={() => setShowSoundPicker(false)}
          title="Arka Plan Sesi Seç"
        >
          <div className="focus-page__sound-list">
            {SOUND_OPTIONS.map((opt) => {
              const ItemIcon = opt.Icon;
              const isSelected = selectedSound === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  className={`focus-page__sound-option ${isSelected ? 'focus-page__sound-option--selected' : ''}`}
                  onClick={() => handleSelectSound(opt.key)}
                >
                  <ItemIcon size={20} className="focus-page__sound-icon" />
                  <span className="focus-page__sound-label">{opt.label}</span>
                  {isSelected && <Check size={18} className="focus-page__sound-check" />}
                </button>
              );
            })}
          </div>
        </AppModal>
      )}
    </div>
  );
}
