import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft,
  Bell,
  Trash2,
  BellOff,
  Clock,
  AlertTriangle,
} from 'lucide-react';
import {
  WEEKDAYS,
  getSchedules,
  addSchedule,
  removeSchedule,
  requestNotificationPermission,
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
  const [deleteScheduleTarget, setDeleteScheduleTarget] = useState(null);

  const loadSchedules = async () => {
    const data = await getSchedules();
    setSchedules(data);
  };

  useEffect(() => {
    loadSchedules();
  }, []);

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

      <h1>Bildirim Ayarları</h1>

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
              <button
                type="button"
                className="notification-settings-page__delete-button"
                onClick={() => setDeleteScheduleTarget(item)}
                title="Zamanlamayı Sil"
              >
                <Trash2 size={18} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="notification-settings-page__add-wrap">
        <AppButton
          title="Yeni Zamanlama Ekle"
          variant="secondary"
          onClick={() => setShowAddForm(true)}
          style={{ width: '100%' }}
        />
      </div>

      {/* Zamanlama Ekle Modalı */}
      {showAddForm && (
        <AddScheduleModal
          open={showAddForm}
          onClose={() => setShowAddForm(false)}
          onSaved={() => {
            setShowAddForm(false);
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

function AddScheduleModal({ open, onClose, onSaved }) {
  const [selectedDays, setSelectedDays] = useState([]);
  const [timeString, setTimeString] = useState('09:00');
  const [label, setLabel] = useState('');
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
      await addSchedule({
        weekdays: selectedDays,
        hour: parseInt(hourStr, 10) || 9,
        minute: parseInt(minuteStr, 10) || 0,
        label: label.trim(),
      });
      onSaved();
    } catch (e) {
      setErrorMessage('Zamanlama kaydedilirken bir sorun oluştu.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppModal open={open} onClose={onClose} title="Yeni Bildirim Zamanlaması">
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

        <label className="notification-settings-page__form-label">Not (opsiyonel)</label>
        <input
          type="text"
          className="notification-settings-page__input"
          placeholder="ör. Akşam ilaç hatırlatması"
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
            title="Kaydet"
            onClick={handleSave}
            loading={saving}
          />
        </div>
      </div>
    </AppModal>
  );
}
