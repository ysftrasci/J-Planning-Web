import { useState, useEffect } from 'react';
import { Download, Share, PlusSquare, X, Smartphone } from 'lucide-react';
import AppModal from './AppModal.jsx';
import './PWAInstallPrompt.css';

export default function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showBanner, setShowBanner] = useState(false);
  const [showIOSModal, setShowIOSModal] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    // Uygulama zaten standalone/PWA olarak çalışıyorsa gösterme
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    if (isStandalone) return;

    // iOS Safari tespiti
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIosDevice = /iphone|ipad|ipod/.test(userAgent);
    setIsIOS(isIosDevice);

    if (isIosDevice) {
      // iOS Safari için daha önce kapatılmadıysa göster
      const dismissed = localStorage.getItem('jplanning:pwa_dismissed');
      if (!dismissed) {
        setShowBanner(true);
      }
    }

    // Android / Chrome / Desktop için install prompt olayı
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);

      const dismissed = localStorage.getItem('jplanning:pwa_dismissed');
      if (!dismissed) {
        setShowBanner(true);
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (isIOS) {
      setShowIOSModal(true);
      return;
    }

    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setShowBanner(false);
    }
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setShowBanner(false);
    localStorage.setItem('jplanning:pwa_dismissed', 'true');
  };

  if (!showBanner) return null;

  return (
    <>
      <div className="pwa-install-banner">
        <div className="pwa-install-banner__icon">
          <Smartphone size={22} color="var(--color-accent-dark)" />
        </div>
        <div className="pwa-install-banner__text">
          <strong>J-Planning'i Ana Ekrana Ekle 📱</strong>
          <span>Uygulamayı tıpkı bir mobil uygulama gibi kullanın.</span>
        </div>
        <button
          type="button"
          className="pwa-install-banner__install-button"
          onClick={handleInstallClick}
        >
          <Download size={16} />
          {isIOS ? 'Nasıl Eklenir?' : 'Yükle'}
        </button>
        <button
          type="button"
          className="pwa-install-banner__close-button"
          onClick={handleDismiss}
          title="Kapat"
        >
          <X size={18} />
        </button>
      </div>

      {/* iPhone Safari Kurulum Rehberi Modalı */}
      {showIOSModal && (
        <AppModal
          open={showIOSModal}
          onClose={() => setShowIOSModal(false)}
          title="iPhone Safari'de Ana Ekrana Ekle"
        >
          <div className="pwa-install-modal">
            <ol className="pwa-install-modal__steps">
              <li>
                <div className="pwa-install-modal__step-icon">
                  <Share size={20} color="var(--color-accent)" />
                </div>
                <span>
                  Safari tarayıcısının altındaki <strong>Paylaş (Share)</strong> simgesine dokunun.
                </span>
              </li>
              <li>
                <div className="pwa-install-modal__step-icon">
                  <PlusSquare size={20} color="var(--color-accent)" />
                </div>
                <span>
                  Açılan menüde aşağı kaydırıp <strong>"Ana Ekrana Ekle" (Add to Home Screen)</strong> seçeneğine basın.
                </span>
              </li>
              <li>
                <div className="pwa-install-modal__step-icon">
                  <Download size={20} color="var(--color-accent)" />
                </div>
                <span>Sağ üstteki <strong>"Ekle"</strong> butonuna dokunun. İkonunuz ana ekrana eklenecektir!</span>
              </li>
            </ol>

            <button
              type="button"
              className="pwa-install-modal__ok-button"
              onClick={() => setShowIOSModal(false)}
            >
              Anlaşıldı
            </button>
          </div>
        </AppModal>
      )}
    </>
  );
}
