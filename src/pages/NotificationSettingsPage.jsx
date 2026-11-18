import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft,
  Bell,
  Trash2,
  BellOff,
  Clock,
  AlertTriangle,
  Pencil,
} from 'lucide-react';
import {
  WEEKDAYS,
  getSchedules,
  addSchedule,
  updateSchedule,
  removeSchedule,
  requestNotificationPermission,
  getNotificationPermissionStatus,
  sendWebNotification,
  weekdayLabel,
  formatTime,
  registerFCMPushToken,
  getUserReminderSettings,
  updateUserReminderSettings,
  triggerReminderTest,
  getDeviceTimeZone,
  SCHEDULE_MINUTE_STEP,
} from '../services/notificationService.js';
import { useAuth } from '../context/AuthContext.jsx';
import AppButton from '../components/AppButton.jsx';
import AppModal from '../components/AppModal.jsx';
import EmptyState from '../components/EmptyState.jsx';
import './NotificationSettingsPage.css';

export default function NotificationSettingsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [schedules, setSchedules] = useState([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState(null);
  const [deleteScheduleTarget, setDeleteScheduleTarget] = useState(null);
  const [permStatus, setPermStatus] = useState('default');
  const [toastMessage, setToastMessage] = useState('');
  const [schedulesLoading, setSchedulesLoading] = useState(true);
  const [schedulesError, setSchedulesError] = useState('');
  const deviceTimeZone = getDeviceTimeZone();

  // Otomatik Hatırlatıcı (Cron) State'leri
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [reminderHour, setReminderHour] = useState(20);
  const [reminderSaving, setReminderSaving] = useState(false);
  const [testingReminder, setTestingReminder] = useState(false);

  const loadSchedules = async () => {
    setSchedulesError('');
    try {
      const data = await getSchedules();
      setSchedules(data);
    } catch (e) {
      console.warn('Bildirim zamanlamaları yüklenemedi:', e);
      setSchedulesError('Zamanlamalar yüklenemedi. Bağlantını kontrol edip sayfayı yenile.');
    } finally {
      setSchedulesLoading(false);
    }
    const status = await getNotificationPermissionStatus();
    setPermStatus(status);
    if (status === 'granted' && user?.uid) {
      registerFCMPushToken(user.uid);
    }
  };

  const loadReminderSettings = async () => {
    try {
      const settings = await getUserReminderSettings();
      setReminderEnabled(Boolean(settings.reminderEnabled));
      setReminderHour(typeof settings.reminderHour === 'number' ? settings.reminderHour : 20);
    } catch (e) {
      console.warn('Hatırlatıcı ayarları yüklenemedi:', e);
    }
  };

  useEffect(() => {
    loadSchedules();
    loadReminderSettings();
  }, [user]);

  const handleToggleReminder = async (newVal) => {
    const prev = reminderEnabled;
    setReminderEnabled(newVal);
    setReminderSaving(true);
    try {
      await updateUserReminderSettings({ reminderEnabled: newVal, reminderHour });
      setToastMessage(newVal ? 'Günlük hatırlatıcı bildirimleri açıldı.' : 'Günlük hatırlatıcı bildirimleri kapatıldı.');
    } catch (err) {
      setReminderEnabled(prev);
      setToastMessage(`Ayar kaydedilemedi: ${err.message}`);
    } finally {
      setReminderSaving(false);
      setTimeout(() => setToastMessage(''), 4000);
    }
  };

  const handleChangeReminderHour = async (newHour) => {
    const prev = reminderHour;
    setReminderHour(newHour);
    setReminderSaving(true);
    try {
      await updateUserReminderSettings({ reminderEnabled, reminderHour: newHour });
      setToastMessage(`Hatırlatma saati ${String(newHour).padStart(2, '0')}:00 olarak güncellendi.`);
    } catch (err) {
      setReminderHour(prev);
      setToastMessage(`Saat güncellenemedi: ${err.message}`);
    } finally {
      setReminderSaving(false);
      setTimeout(() => setToastMessage(''), 4000);
    }
  };

  const handleTriggerReminderTest = async () => {
    setTestingReminder(true);
    try {
      const status = await getNotificationPermissionStatus();
      if (status !== 'granted') {
        const granted = await requestNotificationPermission();
        setPermStatus(granted ? 'granted' : 'denied');
        if (!granted) {
          setToastMessage('Bildirim gönderebilmemiz için tarayıcı bildirim iznini açman gerekiyor.');
          return;
        }
      }

      // Test öncesi bu cihazın token'ını Firestore'a kesin olarak yaz
      if (user?.uid) {
        await registerFCMPushToken(user.uid, { force: true });
      }

      const res = await triggerReminderTest();
      const r = res?.result;

      if (!r || r.success === false) {
        setToastMessage(`❌ Hata: ${r?.message || r?.error || 'Test sırasında bir sorun oluştu.'}`);
      } else if (r.status === 'SENT') {
        setToastMessage(`✅ Test bildirimi gönderildi! (${r.uncompletedTasks} görev, ${r.deviceCount || 1} cihaza iletildi)`);
      } else if (r.status === 'ALL_COMPLETED') {
        setToastMessage('ℹ️ Bildirim gönderilmedi: Bugün için tamamlanması gereken tüm görevlerin zaten tamamlanmış.');
      } else if (r.status === 'NO_TASKS') {
        setToastMessage('ℹ️ Aktif bir görevin bulunmuyor. Test için önce bir görev oluşturmalısın.');
      } else if (r.status === 'NO_TOKENS') {
        setToastMessage('⚠️ Cihazında kayıtlı push bildirim anahtarı bulunamadı. Lütfen yukarıdaki "İzin Ver" butonuna tıkla.');
      } else if (r.status === 'FCM_SEND_FAILED') {
        setToastMessage('❌ Bildirim cihazlara iletilemedi (FCM reddetti).');
      } else {
        setToastMessage(r.message || 'Hatırlatıcı kontrolü tamamlandı.');
      }
    } catch (err) {
      setToastMessage(`❌ Test başarısız: ${err.message}`);
    } finally {
      setTestingReminder(false);
      setTimeout(() => setToastMessage(''), 6000);
    }
  };

  const handleRequestPerm = async () => {
    const granted = await requestNotificationPermission();
    const status = await getNotificationPermissionStatus();
    setPermStatus(status);
    if (granted) {
      if (user?.uid) {
        await registerFCMPushToken(user.uid, { force: true });
      }
      setToastMessage('Bildirim ve Arka Plan Push izni başarıyla verildi! 🎉');
    } else {
      setToastMessage('Bildirim izni reddedildi veya engellendi.');
    }
    setTimeout(() => setToastMessage(''), 4000);
  };

  const handleSendTestNotification = async () => {
    const status = await getNotificationPermissionStatus();
    if (status !== 'granted') {
      const granted = await requestNotificationPermission();
      setPermStatus(granted ? 'granted' : 'denied');
      if (!granted) {
        alert('Bildirim gönderebilmemiz için tarayıcı bildirim iznini açman gerekiyor.');
        return;
      }
    }

    const success = await sendWebNotification(
      'J-Planning Test Bildirimi 🔔',
      'Tebrikler! Tarayıcı bildirim sistemi sorunsuz çalışıyor.'
    );

    if (success) {
      setToastMessage('Test bildirimi gönderildi! Ekranının sağ alt/üst köşesini kontrol et.');
    } else {
      setToastMessage('Bildirim gönderilemedi. Lütfen tarayıcı ayarlarından bildirimlere izin verildiğinden emin ol.');
    }
    setTimeout(() => setToastMessage(''), 5000);
  };

  const confirmDelete = async () => {
    if (deleteScheduleTarget) {
      try {
        await removeSchedule(deleteScheduleTarget.id);
      } catch (e) {
        setToastMessage(`Zamanlama silinemedi: ${e.message}`);
        setTimeout(() => setToastMessage(''), 4000);
      }
      setDeleteScheduleTarget(null);
      await loadSchedules();
    }
  };

  return (
    <div className="notification-settings-page">
      <button
        type="button"
        className="notification-settings-page__back"
        onClick={() => navigate('/profile')}
      >
        <ChevronLeft size={18} />
        Profil
      </button>

      <div className="notification-settings-page__header">
        <h1>Bildirim Ayarları</h1>
      </div>

      {toastMessage && (
        <div className="notification-settings-page__toast">{toastMessage}</div>
      )}

      {permStatus !== 'granted' && (
        <div className="notification-settings-page__perm-banner">
          <AlertTriangle size={20} color="var(--color-accent-dark)" />
          <div className="notification-settings-page__perm-text">
            <strong>Bildirim İzni Gerekli</strong>
            <p>Hatırlatmaları alabilmen için tarayıcı iznine ihtiyaç var.</p>
          </div>
          <button
            type="button"
            className="notification-settings-page__perm-button"
            onClick={handleRequestPerm}
          >
            İzin Ver
          </button>
        </div>
      )}

      {/* Günlük Görev Hatırlatıcısı (Cloudflare Cron) Kartı */}
      <div className="notification-settings-page__section-header">
        <h2 className="notification-settings-page__section-title">Günlük Görev Hatırlatıcısı</h2>
      </div>

      <div className="notification-settings-page__reminder-card">
        <div className="notification-settings-page__reminder-top">
          <div className="notification-settings-page__reminder-title-area">
            <Clock size={22} color="var(--color-accent-dark)" />
            <div>
              <div className="notification-settings-page__reminder-title">Akıllı Push Hatırlatıcısı</div>
              <p className="notification-settings-page__reminder-desc">
                Her gün seçtiğin saatte, tamamlanmamış görevlerin varsa sana bir hatırlatma bildirimi gönderilir.
              </p>
            </div>
          </div>
          <label className="notification-switch">
            <input
              type="checkbox"
              checked={reminderEnabled}
              disabled={reminderSaving}
              onChange={(e) => handleToggleReminder(e.target.checked)}
            />
            <span className="notification-switch__slider"></span>
          </label>
        </div>

        {reminderEnabled && (
          <div className="notification-settings-page__reminder-settings">
            <div className="notification-settings-page__hour-group">
              <label htmlFor="reminder-hour-select" className="notification-settings-page__hour-label">
                Hatırlatma Saati:
              </label>
              <select
                id="reminder-hour-select"
                className="notification-settings-page__hour-select"
                value={reminderHour}
                disabled={reminderSaving}
                onChange={(e) => handleChangeReminderHour(parseInt(e.target.value, 10))}
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>
                    {String(i).padStart(2, '0')}:00
                  </option>
                ))}
              </select>
            </div>

            <div className="notification-settings-page__reminder-actions">
              <AppButton
                title={testingReminder ? 'Test Ediliyor...' : 'Hatırlatıcıyı Test Et ⏰'}
                variant="ghost"
                onClick={handleTriggerReminderTest}
                disabled={testingReminder}
                style={{ padding: '6px 12px', fontSize: '12px' }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="notification-settings-page__divider"></div>

      <div className="notification-settings-page__section-header">
        <h2 className="notification-settings-page__section-title">Özel Bildirim Zamanlamaları</h2>
      </div>

      <p className="notification-settings-page__intro">
        Haftanın istediğin günlerinde, istediğin saatlerde ek bildirimler al. Bildirimler uygulama kapalıyken de
        tüm cihazlarına gelir; en fazla 5 dakika gecikebilir. Saatler bu cihazın saat dilimine ({deviceTimeZone}) göredir.
      </p>

      {schedulesError && <p className="notification-settings-page__error">{schedulesError}</p>}

      {schedulesLoading ? null : schedules.length === 0 ? (
        <EmptyState
          icon={BellOff}
          title="Henüz bildirim zamanlaman yok"
          subtitle="Aşağıdaki butonla yeni bir zamanlama ekle"
        />
      ) : (
        <div className="notification-settings-page__list">
          {schedules.map((item) => (
            <div key={item.id} className="notification-settings-page__card card">
              <div className="notification-settings-page__icon-wrap">
                <Bell size={18} color="var(--color-accent-dark)" />
              </div>
              <div className="notification-settings-page__info">
                {item.label && (
                  <span className="notification-settings-page__label-text">{item.label}</span>
                )}
                <span className="notification-settings-page__time">
                  {formatTime(item.hour, item.minute)}
                </span>
                <span className="notification-settings-page__days">
                  {item.weekdays.map((w) => weekdayLabel(w)).join(', ')}
                </span>
                {item.nextFireAt && (
                  <span className="notification-settings-page__days">
                    Sıradaki: {new Date(item.nextFireAt).toLocaleString('tr-TR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
              <div className="notification-settings-page__card-actions">
                <button
                  type="button"
                  className="notification-settings-page__action-button"
                  onClick={() => setEditingSchedule(item)}
                  title="Zamanlamayı Düzenle"
                >
                  <Pencil size={18} />
                </button>
                <button
                  type="button"
                  className="notification-settings-page__action-button notification-settings-page__action-button--danger"
                  onClick={() => setDeleteScheduleTarget(item)}
                  title="Zamanlamayı Sil"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="notification-settings-page__actions">
        <AppButton
          title="Yeni Zamanlama Ekle"
          variant="secondary"
          onClick={() => setShowAddForm(true)}
          disabled={schedules.length >= 20 || Boolean(schedulesError)}
          style={{ flex: 1 }}
        />
        <AppButton
          title="Test Bildirimi Gönder 🔔"
          variant="ghost"
          onClick={handleSendTestNotification}
          style={{ flex: 1 }}
        />
      </div>

      {/* Zamanlama Ekle / Düzenle Modalı */}
      {(showAddForm || editingSchedule) && (
        <ScheduleFormModal
          open={showAddForm || !!editingSchedule}
          editingSchedule={editingSchedule}
          onClose={() => {
            setShowAddForm(false);
            setEditingSchedule(null);
          }}
          onSaved={() => {
            setShowAddForm(false);
            setEditingSchedule(null);
            loadSchedules();
          }}
        />
      )}

      {/* Silme Onay Modalı */}
      {deleteScheduleTarget && (
        <AppModal
          open={!!deleteScheduleTarget}
          onClose={() => setDeleteScheduleTarget(null)}
          title="Zamanlamayı Sil"
        >
          <div className="notification-settings-page__modal-body">
            <AlertTriangle size={36} color="var(--color-danger)" />
            <p>Bu bildirim zamanlamasını silmek istediğine emin misin?</p>
            <div className="notification-settings-page__modal-actions">
              <AppButton
                title="Vazgeç"
                variant="secondary"
                onClick={() => setDeleteScheduleTarget(null)}
              />
              <AppButton
                title="Sil"
                variant="danger"
                onClick={confirmDelete}
              />
            </div>
          </div>
        </AppModal>
      )}
    </div>
  );
}

const MINUTE_OPTIONS = Array.from({ length: 60 / SCHEDULE_MINUTE_STEP }, (_, i) => i * SCHEDULE_MINUTE_STEP);

function ScheduleFormModal({ open, editingSchedule, onClose, onSaved }) {
  const [selectedDays, setSelectedDays] = useState(editingSchedule?.weekdays || []);
  const [hour, setHour] = useState(editingSchedule ? Number(editingSchedule.hour) : 9);
  // Eski zamanlamalarda dakika 5'in katı olmayabilir: en yakın alt adıma yuvarlanır.
  const [minute, setMinute] = useState(
    editingSchedule
      ? Math.floor(Number(editingSchedule.minute) / SCHEDULE_MINUTE_STEP) * SCHEDULE_MINUTE_STEP
      : 0
  );
  const [label, setLabel] = useState(editingSchedule?.label || '');
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const toggleDay = (value) => {
    setSelectedDays((prev) =>
      prev.includes(value) ? prev.filter((d) => d !== value) : [...prev, value]
    );
  };

  const handleSave = async () => {
    if (selectedDays.length === 0) {
      setErrorMessage('Lütfen en az bir gün seç.');
      return;
    }

    setSaving(true);
    setErrorMessage('');
    try {
      const granted = await requestNotificationPermission();
      if (!granted && 'Notification' in window) {
        setErrorMessage('Bildirim gönderebilmemiz için bildirim iznini açman gerekiyor.');
      }

      // DİKKAT: 0 geçerli bir saattir (gece 00:xx).
      const payload = {
        weekdays: selectedDays,
        hour: Math.min(23, Math.max(0, Number(hour) || 0)),
        minute: Math.min(59, Math.max(0, Number(minute) || 0)),
        label: label.trim(),
      };

      if (editingSchedule) {
        await updateSchedule(editingSchedule.id, payload);
      } else {
        await addSchedule(payload);
      }
      onSaved();
    } catch (e) {
      setErrorMessage(e?.message || 'Zamanlama kaydedilirken bir sorun oluştu.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppModal
      open={open}
      onClose={onClose}
      title={editingSchedule ? 'Bildirim Zamanlamasını Düzenle' : 'Yeni Bildirim Zamanlaması'}
    >
      <div className="notification-settings-page__form">
        {errorMessage && (
          <p className="notification-settings-page__error">{errorMessage}</p>
        )}

        <label className="notification-settings-page__form-label">Hangi günler?</label>
        <div className="notification-settings-page__day-row">
          {WEEKDAYS.map((day) => {
            const isSelected = selectedDays.includes(day.value);
            return (
              <button
                key={day.value}
                type="button"
                className={`notification-settings-page__day-chip ${isSelected ? 'notification-settings-page__day-chip--selected' : ''}`}
                onClick={() => toggleDay(day.value)}
              >
                {day.short}
              </button>
            );
          })}
        </div>

        <label className="notification-settings-page__form-label">Saat</label>
        <div className="notification-settings-page__time-row">
          <Clock size={18} color="var(--color-text-secondary)" />
          <select
            className="notification-settings-page__time-input"
            aria-label="Saat"
            value={hour}
            onChange={(e) => setHour(parseInt(e.target.value, 10))}
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>{String(h).padStart(2, '0')}</option>
            ))}
          </select>
          <span>:</span>
          <select
            className="notification-settings-page__time-input"
            aria-label="Dakika"
            value={minute}
            onChange={(e) => setMinute(parseInt(e.target.value, 10))}
          >
            {MINUTE_OPTIONS.map((m) => (
              <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
            ))}
          </select>
        </div>

        <label className="notification-settings-page__form-label">Bildirim Mesajı / Hatırlatma Metni</label>
        <input
          type="text"
          className="notification-settings-page__input"
          placeholder="ör. Spor yapmayı ve ödevini tamamlamayı unutma!"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />

        <div className="notification-settings-page__modal-actions">
          <AppButton
            title="Vazgeç"
            variant="secondary"
            onClick={onClose}
          />
          <AppButton
            title={editingSchedule ? 'Güncelle' : 'Kaydet'}
            onClick={handleSave}
            loading={saving}
          />
        </div>
      </div>
    </AppModal>
  );
}
