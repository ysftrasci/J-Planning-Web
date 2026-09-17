import { UserPlus, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import './GuestBanner.css';

export default function GuestBanner() {
  const { isGuest } = useAuth();
  const navigate = useNavigate();

  if (!isGuest) return null;

  return (
    <div className="guest-banner">
      <div className="guest-banner__text">
        <span className="guest-banner__badge">Misafir Modu</span>
        <span>Verilerini kaybetmemek ve arkadaşlarını eklemek için hesabını kaydet.</span>
      </div>
      <button
        type="button"
        className="guest-banner__button"
        onClick={() => navigate('/login?mode=register')}
      >
        <Sparkles size={13} />
        <span>Hesap Oluştur</span>
      </button>
    </div>
  );
}
