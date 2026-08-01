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
} from '../services/notificationService.js';
import AppButton from '../components/AppButton.jsx';
import AppModal from '../components/AppModal.jsx';
import EmptyState from '../components/EmptyState.jsx';
import './NotificationSettingsPage.css';

export default function NotificationSettingsPage() {
  const navigate = useNavigate();
  const [schedules, setSchedules] = useState([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState(null);
  const [deleteScheduleTarget, setDeleteScheduleTarget] = useState(null);
  const [permStatus, setPermStatus] = useState('default');
  const [toastMessage, setToastMessage] = useState('');

  const loadSchedules = async () => {
    const data = await getSchedules();
    setSchedules(data);
    const status = await getNotificationPermissionStatus();
    setPermStatus(status);
  };

  useEffect(() => {
    loadSchedules();
  }, []);

  const handleRequestPerm = async () => {
    const granted = await requestNotificationPermission();
    const status = await getNotificationPermissionStatus();
    setPermStatus(status);
    if (granted) {
      setToastMessage('Bildirim izni başarıyla verildi! 🎉');
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
        alert('Bildirim gönderebilmemiz için tarayıcı iznini açmanız gerekmektedir.');
        return;
      }
    }

    const success = await sendWebNotification(
      'J-Planning Test Bildirimi 🔔',
      'Tebrikler! Tarayıcı bildirim sistemi sorunsuz çalışıyor.'
    );

    if (success) {
      setToastMessage('Test bildirimi gönderildi! Ekranınızın sağ alt/üst köşesini kontrol edin.');
    } else {
      setToastMessage('Bildirim gönderilemedi. Lütfen tarayıcı ayarlarından bildirimlere izin verildiğinden emin olun.');
    }
    setTimeout(() => setToastMessage(''), 5000);
  };

  const confirmDelete = async () => {
    if (deleteScheduleTarget) {
      await removeSchedule(deleteScheduleTarget.id);
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
            <p>Hatırlatmaları alabilmeniz için tarayıcı iznine ihtiyaç var.</p>
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

      <p className="notification-settings-page__intro">
        Haftanın istediğin günlerinde, istediğin saatlerde hatırlatma bildirimi al. Dilediğin kadar zamanlama ekleyebilirsin.
      </p>

      {schedules.length === 0 ? (
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
            <p>Bu bildirim zamanlamasını kaldırmak istiyor musun?</p>
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

function ScheduleFormModal({ open, editingSchedule, onClose, onSaved }) {
  const [selectedDays, setSelectedDays] = useState(editingSchedule?.weekdays || []);
  const [timeString, setTimeString] = useState(
    editingSchedule ? formatTime(editingSchedule.hour, editingSchedule.minute) : '09:00'
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
      setErrorMessage('Lütfen en az bir gün seçin.');
      return;
    }

    setSaving(true);
    setErrorMessage('');
    try {
      const granted = await requestNotificationPermission();
      if (!granted && 'Notification' in window) {
        setErrorMessage('Bildirim gönderebilmemiz için bildirim iznini açman gerekiyor.');
      }

      const [hourStr, minuteStr] = timeString.split(':');
      const payload = {
        weekdays: selectedDays,
        hour: parseInt(hourStr, 10) || 9,
        minute: parseInt(minuteStr, 10) || 0,
        label: label.trim(),
      };

      if (editingSchedule) {
        await updateSchedule(editingSchedule.id, payload);
      } else {
        await addSchedule(payload);
      }
      onSaved();
    } catch (e) {
      setErrorMessage('Zamanlama kaydedilirken bir sorun oluştu.');
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
          <input
            type="time"
            className="notification-settings-page__time-input"
            value={timeString}
            onChange={(e) => setTimeString(e.target.value)}
          />
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
