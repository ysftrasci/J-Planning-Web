import { useRef, useState } from 'react';
import AppModal from './AppModal.jsx';
import './BudgieEasterEgg.css';

const TAP_THRESHOLD = 5;
const TAP_RESET_MS = 3000;

const BUDGIE_MESSAGES = [
  'Cik cik! Bugün de harika görevler tamamladın! 🦜',
  'Muhabbet kuşu buraya kadar geldi çünkü seninle gurur duyuyor! 🦜✨',
  "Bir kuş fısıldadı: 'JP'lerini biriktirmeye devam et!' 🦜💛",
  'Cikcikcik! Gizli muhabbet kuşunu buldun! 🦜🎉',
];

export function useEasterEggTrigger() {
  const tapCount = useRef(0);
  const resetTimer = useRef(null);
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState('');

  const handleTap = () => {
    tapCount.current += 1;

    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => {
      tapCount.current = 0;
    }, TAP_RESET_MS);

    if (tapCount.current >= TAP_THRESHOLD) {
      tapCount.current = 0;
      setMessage(BUDGIE_MESSAGES[Math.floor(Math.random() * BUDGIE_MESSAGES.length)]);
      setVisible(true);
    }
  };

  return { handleTap, visible, message, close: () => setVisible(false) };
}

export function BudgieEasterEggModal({ open, message, onClose }) {
  return (
    <AppModal open={open} onClose={onClose} title="Sürpriz! 🦜">
      <div className="budgie-easter-egg">
        <span className="budgie-easter-egg__emoji">🦜</span>
        <p className="budgie-easter-egg__message">{message}</p>
        <span className="budgie-easter-egg__hint">(Kapatmak için dokun)</span>
      </div>
    </AppModal>
  );
}
