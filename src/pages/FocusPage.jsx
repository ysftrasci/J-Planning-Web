import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Clock,
  History,
  Coins,
  Volume2,
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
  PartyPopper,
} from 'lucide-react';
import AppButton from '../components/AppButton.jsx';
import AppModal from '../components/AppModal.jsx';
import { playFocusSound, stopFocusSound } from '../services/focusSoundService.js';
import { calculateFocusSessionJP } from '../utils/rewards.js';
import { addWalletTransaction } from '../db/taskRepository.js';
import { recordFocusSession } from '../db/focusSessionRepository.js';
import './FocusPage.css';

const DURATION_OPTIONS = [
  { minutes: 30, label: '30 dk' },
  { minutes: 45, label: '45 dk' },
  { minutes: 60, label: '60 dk' },
];

const SOUND_OPTIONS = [
  { key: 'none', label: 'Ses Yok', Icon: VolumeX },
  { key: 'white_noise', label: 'Beyaz Gürültü', Icon: Radio },
  { key: 'summer_night_camp', label: 'Yaz Gecesi Kamp', Icon: Flame },
  { key: 'ocean_waves', label: 'Sahil / Dalga Sesi', Icon: Waves },
  { key: 'rain', label: 'Yağmur Sesi', Icon: CloudRain },
  { key: 'budgie', label: 'Muhabbet Kuşu', Icon: Music },
  { key: 'fireplace', label: 'Ateş / Şömine', Icon: Flame },
];

function formatTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function FocusPage() {
  const navigate = useNavigate();
  const [selectedMinutes, setSelectedMinutes] = useState(30);
  const [customMinutesInput, setCustomMinutesInput] = useState('');
  const [selectedSound, setSelectedSound] = useState('none');
  const [showSoundPicker, setShowSoundPicker] = useState(false);
  const [showStopConfirm, setShowStopConfirm] = useState(false);

  const [isRunning, setIsRunning] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [completedJp, setCompletedJp] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState(30 * 60);

  const intervalRef = useRef(null);
  const totalSecondsRef = useRef(30 * 60);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      stopFocusSound();
    };
  }, []);

  const handleSelectDuration = (minutes) => {
    setSelectedMinutes(minutes);
    setCustomMinutesInput('');
  };

  const handleCustomMinutesChange = (e) => {
    const text = e.target.value;
    const digitsOnly = text.replace(/[^0-9]/g, '');
    setCustomMinutesInput(digitsOnly);
    const parsed = parseInt(digitsOnly, 10);
    if (parsed > 0) {
      setSelectedMinutes(parsed);
    }
  };

  const handleSelectSound = async (key) => {
    setSelectedSound(key);
    setShowSoundPicker(false);
    if (isRunning) {
      await playFocusSound(key);
    }
  };

  const handleStart = async () => {
    const total = selectedMinutes * 60;
    totalSecondsRef.current = total;
    setRemainingSeconds(total);
    setIsRunning(true);
    setIsCompleted(false);
    await playFocusSound(selectedSound);

    if (intervalRef.current) clearInterval(intervalRef.current);

    intervalRef.current = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(intervalRef.current);
          handleSessionComplete();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleSessionComplete = async () => {
    await stopFocusSound();
    const jp = calculateFocusSessionJP(selectedMinutes);
    if (jp > 0) {
      addWalletTransaction('me', jp, 'FOCUS_SESSION');
    }
    recordFocusSession({
      durationMinutes: selectedMinutes,
      soundKey: selectedSound,
      jpEarned: jp,
    });
    setCompletedJp(jp);
    setIsCompleted(true);
  };

  const confirmStop = async () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    await stopFocusSound();
    setIsRunning(false);
    setIsCompleted(false);
    setShowStopConfirm(false);
  };

  const handleFinishCompletion = () => {
    setIsCompleted(false);
    setIsRunning(false);
  };

  const activeSoundObj = SOUND_OPTIONS.find((s) => s.key === selectedSound) || SOUND_OPTIONS[0];
  const ActiveSoundIcon = activeSoundObj.Icon;

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
            <strong>{selectedMinutes} dakikalık</strong> odaklanma seansını başarıyla tamamladın.
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
    const progress = Math.min(
      100,
      Math.max(0, Math.round((1 - remainingSeconds / totalSecondsRef.current) * 100))
    );

    return (
      <div className="focus-page focus-page--running">
        <div className="focus-page__running-content">
          <span className="focus-page__running-label">Odaklanma Modu</span>
          <div className="focus-page__timer">{formatTime(remainingSeconds)}</div>

          <div className="focus-page__progress-track">
            <div className="focus-page__progress-fill" style={{ width: `${progress}%` }} />
          </div>

          <button
            type="button"
            className="focus-page__sound-badge"
            onClick={() => setShowSoundPicker(true)}
            title="Arka Plan Sesini Değiştir"
          >
            <ActiveSoundIcon size={18} />
            <span>Ses: {activeSoundObj.label}</span>
          </button>
        </div>

        <div className="focus-page__running-footer">
          <AppButton
            title="Seansı Bitir"
            variant="danger"
            onClick={() => setShowStopConfirm(true)}
            style={{ width: '100%' }}
          />
        </div>

        {/* Ses Seçici Modal (Çalışırken) */}
        {showSoundPicker && (
          <AppModal
            open={showSoundPicker}
            onClose={() => setShowSoundPicker(false)}
            title="Arka Plan Sesi Seçin"
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
            title="Seansı Erken Bitir"
          >
            <div className="focus-page__confirm-body">
              <AlertTriangle size={40} color="var(--color-danger, #ef4444)" />
              <p>
                Odaklanma seansını erken bitirmek istediğinize emin misiniz? Erken bitirirseniz JP kazanamayacaksınız.
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

  // Ana Odaklanma Ayar Ekranı
  const jpToEarn = calculateFocusSessionJP(selectedMinutes);

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

      <div className="focus-page__section">
        <label className="focus-page__section-title">Süre Seç</label>
        <div className="focus-page__duration-grid">
          {DURATION_OPTIONS.map((opt) => {
            const isSelected = selectedMinutes === opt.minutes && !customMinutesInput;
            return (
              <button
                key={opt.minutes}
                type="button"
                className={`focus-page__duration-chip ${isSelected ? 'focus-page__duration-chip--selected' : ''}`}
                onClick={() => handleSelectDuration(opt.minutes)}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        <div className="focus-page__or-label">ya da kendi süreni gir</div>
        <div className="focus-page__custom-row">
          <input
            type="text"
            className="focus-page__custom-input"
            placeholder="ör. 37"
            value={customMinutesInput}
            onChange={handleCustomMinutesChange}
            maxLength={3}
          />
          <span className="focus-page__custom-suffix">dakika</span>
        </div>

        <div className="focus-page__jp-card">
          <Coins size={18} color="var(--color-accent-dark)" />
          <span>
            {jpToEarn > 0
              ? `Bu seansı tamamlarsan +${jpToEarn} JP kazanırsın`
              : '30 dakikadan kısa seanslarda JP kazanılmaz'}
          </span>
        </div>
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
          title="Odaklanmaya Başla"
          onClick={handleStart}
          style={{ width: '100%' }}
        />
      </div>

      {/* Ses Seçici Modal (Ayar ekranı) */}
      {showSoundPicker && (
        <AppModal
          open={showSoundPicker}
          onClose={() => setShowSoundPicker(false)}
          title="Arka Plan Sesi Seçin"
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
