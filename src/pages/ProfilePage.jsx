import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  User,
  Pencil,
  Share2,
  Tag,
  Bell,
  UserCheck,
  Lock,
  ChevronRight,
  LogOut,
  Check,
  Mail,
  Moon,
  Sun,
  Database,
  Download,
  Upload,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { sendResetPasswordEmail } from '../services/emailAuth.js';
import { getStoredTheme, setStoredTheme } from '../utils/theme.js';
import { exportAllUserData, importUserData } from '../services/dataBackupService.js';
import { useEasterEggTrigger, BudgieEasterEggModal } from '../components/BudgieEasterEgg.jsx';
import AppButton from '../components/AppButton.jsx';
import AppModal from '../components/AppModal.jsx';
import './ProfilePage.css';

export default function ProfilePage() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const userCode = user?.profile?.userCode || '—';
  const displayName = user?.profile?.displayName || user?.displayName || 'Kullanıcı';
  const photoURL = user?.profile?.photoURL || user?.photoURL;
  const userEmail = user?.email;

  const [theme, setTheme] = useState(getStoredTheme());
  const easterEgg = useEasterEggTrigger();
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [showResetPasswordConfirm, setShowResetPasswordConfirm] = useState(false);
  const [showBackupInfoModal, setShowBackupInfoModal] = useState(false);
  const [showBackupActionModal, setShowBackupActionModal] = useState(false);
  const [copiedSuccess, setCopiedSuccess] = useState(false);
  const [alertMessage, setAlertMessage] = useState(null);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    setStoredTheme(next);
  };

  const handleShare = async () => {
    const text = `J-Planning'de bana arkadaş ekle! Kullanıcı ID'm: ${userCode}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'J-Planning ID', text });
        return;
      } catch (e) {
        // Fallback to clipboard
      }
    }
    await navigator.clipboard.writeText(text);
    setCopiedSuccess(true);
    setTimeout(() => setCopiedSuccess(false), 3000);
  };

  const handleConfirmResetPassword = async () => {
    setShowResetPasswordConfirm(false);
    if (!userEmail) return;
    try {
      await sendResetPasswordEmail(userEmail);
      setAlertMessage({
        title: 'Gönderildi 📧',
        body: `${userEmail} adresine bir şifre sıfırlama linki gönderdik. Gelen kutunu (ve spam klasörünü) kontrol et.`,
      });
    } catch (e) {
      setAlertMessage({
        title: 'Hata',
        body: e.message || 'Şifre sıfırlama e-postası gönderilemedi.',
      });
    }
  };

  const handleExport = () => {
    try {
      exportAllUserData();
      setAlertMessage({
        title: 'Başarılı 📦',
        body: 'Verileriniz .json yedek dosyası olarak indirildi.',
      });
    } catch (e) {
      setAlertMessage({ title: 'Hata', body: 'Veri dışa aktarılamadı.' });
    }
  };

  const handleFileImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        await importUserData(evt.target.result);
        setShowBackupActionModal(false);
        setAlertMessage({
          title: 'Yedek Yüklendi 🎉',
          body: 'Tüm verileriniz başarıyla içe aktarıldı. Görevleriniz ve geçmişiniz güncellendi.',
        });
      } catch (err) {
        setAlertMessage({
          title: 'Yükleme Hatası',
          body: err.message || 'Yedek dosyası içe aktarılamadı.',
        });
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="profile-page">
      <div className="profile-page__header">
        <h1>Profil</h1>
      </div>

      <div className="profile-page__user-card card">
        <button
          type="button"
          className="profile-page__avatar-wrap"
          onClick={() => navigate('/profile/edit')}
          title="Profili Düzenle"
        >
          {photoURL ? (
            <img src={photoURL} alt={displayName} className="profile-page__avatar-img" />
          ) : (
            <div className="profile-page__avatar-placeholder">
              <User size={36} color="var(--color-accent-dark)" />
            </div>
          )}
          <div className="profile-page__edit-badge">
            <Pencil size={12} color="#FFF" />
          </div>
        </button>

        <h2 className="profile-page__name">{displayName}</h2>
        {userEmail && <span className="profile-page__email">{userEmail}</span>}

        <div className="profile-page__id-box">
          <span className="profile-page__id-label">Kullanıcı ID'n</span>
          <button
            type="button"
            className="profile-page__id-value-button"
            onClick={easterEgg.handleTap}
            title="Sürpriz için tıklayın"
          >
            {userCode}
          </button>
          <span className="profile-page__id-hint">
            Arkadaşların seni bu ID ile ekleyebilir
          </span>

          <button
            type="button"
            className="profile-page__share-button"
            onClick={handleShare}
          >
            {copiedSuccess ? <Check size={16} /> : <Share2 size={16} />}
            <span>{copiedSuccess ? 'Kopyalandı!' : "ID'mi Paylaş"}</span>
          </button>
        </div>
      </div>

      <div className="profile-page__menu card">
        <MenuRow
          Icon={Tag}
          label="Kategorileri Yönet"
          onClick={() => navigate('/categories')}
        />
        <MenuRow
          Icon={Bell}
          label="Bildirim Ayarları"
          onClick={() => navigate('/profile/notifications')}
        />
        <MenuRow
          Icon={UserCheck}
          label="Profili Düzenle"
          onClick={() => navigate('/profile/edit')}
        />
        <MenuRow
          Icon={Database}
          label="Veri Yedekleme ve Transfer"
          onClick={() => setShowBackupInfoModal(true)}
        />
        <MenuRow
          Icon={Lock}
          label="Şifre Değiştir"
          onClick={() => setShowResetPasswordConfirm(true)}
        />
        <MenuRow
          Icon={theme === 'dark' ? Sun : Moon}
          label={theme === 'dark' ? 'Açık Temaya Geç ☀️' : 'Koyu Temaya Geç 🌙'}
          onClick={toggleTheme}
        />
      </div>

      <div className="profile-page__signout-wrap">
        <AppButton
          title="Çıkış Yap"
          variant="danger"
          onClick={() => setShowSignOutConfirm(true)}
          style={{ width: '100%' }}
        />
      </div>

      {/* Easter Egg Modal */}
      <BudgieEasterEggModal
        open={easterEgg.visible}
        message={easterEgg.message}
        onClose={easterEgg.close}
      />

      {/* Veri Yedekleme Bilgilendirme Modalı */}
      {showBackupInfoModal && (
        <AppModal
          open={showBackupInfoModal}
          onClose={() => setShowBackupInfoModal(false)}
          title="Veri Yedekleme Hakkında 💾"
        >
          <div className="profile-page__modal-body">
            <Database size={40} color="var(--color-accent)" />
            <p style={{ textAlign: 'left', fontSize: 'var(--font-caption-size)', lineHeight: 1.5 }}>
              <strong>Bu özellik ne işe yarar?</strong><br />
              Bu buton ile cihazınızda saklanan tüm görevlerinizi, alışkanlık geçmişinizi, kazandığınız puanları, odaklanma istatistiklerinizi ve bildirim ayarlarınızı <strong>.json</strong> formatında tek bir yedek dosyası olarak indirebilirsiniz.<br /><br />
              <strong>Alınan veriler nasıl kullanılır?</strong><br />
              İndirdiğiniz bu dosyayı verilerinizi başka bir cihaza/tarayıcıya aktarmak ya da verilerinizin çevrimdışı yedeğini saklamak için kullanabilirsiniz. Dilediğiniz zaman bu yedek dosyasını uygulamaya yükleyerek verilerinizi geri getirebilirsiniz.
            </p>
            <div className="profile-page__modal-actions">
              <AppButton
                title="Vazgeç"
                variant="secondary"
                onClick={() => setShowBackupInfoModal(false)}
              />
              <AppButton
                title="Devam Et"
                variant="primary"
                onClick={() => {
                  setShowBackupInfoModal(false);
                  setShowBackupActionModal(true);
                }}
              />
            </div>
          </div>
        </AppModal>
      )}

      {/* Veri Yedekleme ve Yükleme İşlem Modalı */}
      {showBackupActionModal && (
        <AppModal
          open={showBackupActionModal}
          onClose={() => setShowBackupActionModal(false)}
          title="Yedekleme ve Geri Yükleme"
        >
          <div className="profile-page__modal-body" style={{ gap: 'var(--space-md)' }}>
            <p className="caption">Lütfen yapmak istediğiniz işlemi seçin:</p>
            
            <AppButton
              title="Yedek İndir (.json)"
              variant="primary"
              onClick={handleExport}
              style={{ width: '100%' }}
            />

            <label className="profile-page__upload-label">
              <Upload size={18} />
              Yedek Yükle (.json)
              <input
                type="file"
                accept=".json"
                onChange={handleFileImport}
                style={{ display: 'none' }}
              />
            </label>

            <AppButton
              title="Kapat"
              variant="ghost"
              onClick={() => setShowBackupActionModal(false)}
              style={{ width: '100%', marginTop: 'var(--space-sm)' }}
            />
          </div>
        </AppModal>
      )}

      {/* Şifre Sıfırlama Onay Modalı */}
      {showResetPasswordConfirm && (
        <AppModal
          open={showResetPasswordConfirm}
          onClose={() => setShowResetPasswordConfirm(false)}
          title="Şifre Değiştir"
        >
          <div className="profile-page__modal-body">
            <Mail size={36} color="var(--color-accent)" />
            <p>
              <strong>{userEmail}</strong> adresine bir şifre sıfırlama linki gönderilecek. E-postandaki linke tıklayarak yeni şifreni belirleyebilirsin. Devam edilsin mi?
            </p>
            <div className="profile-page__modal-actions">
              <AppButton
                title="Vazgeç"
                variant="secondary"
                onClick={() => setShowResetPasswordConfirm(false)}
              />
              <AppButton
                title="Gönder"
                variant="primary"
                onClick={handleConfirmResetPassword}
              />
            </div>
          </div>
        </AppModal>
      )}

      {/* Çıkış Yap Onay Modalı */}
      {showSignOutConfirm && (
        <AppModal
          open={showSignOutConfirm}
          onClose={() => setShowSignOutConfirm(false)}
          title="Çıkış Yap"
        >
          <div className="profile-page__modal-body">
            <LogOut size={36} color="var(--color-danger)" />
            <p>Hesabından çıkış yapmak istediğine emin misin?</p>
            <div className="profile-page__modal-actions">
              <AppButton
                title="Vazgeç"
                variant="secondary"
                onClick={() => setShowSignOutConfirm(false)}
              />
              <AppButton
                title="Çıkış Yap"
                variant="danger"
                onClick={signOut}
              />
            </div>
          </div>
        </AppModal>
      )}

      {/* Genel Bilgilendirme Modalı */}
      {alertMessage && (
        <AppModal
          open={!!alertMessage}
          onClose={() => setAlertMessage(null)}
          title={alertMessage.title}
        >
          <div className="profile-page__modal-body">
            <p>{alertMessage.body}</p>
            <AppButton
              title="Tamam"
              onClick={() => setAlertMessage(null)}
              style={{ width: '100%', marginTop: 'var(--space-md)' }}
            />
          </div>
        </AppModal>
      )}
    </div>
  );
}

function MenuRow({ Icon, label, onClick, danger }) {
  return (
    <button
      type="button"
      className={`profile-page__menu-row ${danger ? 'profile-page__menu-row--danger' : ''}`}
      onClick={onClick}
    >
      <Icon size={20} className="profile-page__menu-icon" />
      <span className="profile-page__menu-label">{label}</span>
      <ChevronRight size={18} className="profile-page__menu-chevron" />
    </button>
  );
}
