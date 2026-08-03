// J-Planning — Arkadaştan Gelen Görev Ataması Modalı (Web)
// Mobildeki src/components/AssignedTaskModal.js dosyasının web karşılığı.
// Kullanıcı düşünmeden karar vermeye zorlanmasın diye detaylı bir modal
// (basit bir confirm() yerine) kullanılır.
import { Calendar, Flag, List, X } from 'lucide-react';
import { periodLabel } from '../utils/period';
import AppButton from './AppButton.jsx';
import './AssignedTaskModal.css';

const PRIORITY_LABEL = { HIGH: 'Yüksek', MEDIUM: 'Orta', LOW: 'Düşük', EASY: 'Kolay', HARD: 'Zor', ZERO: '0 JP' };
const PRIORITY_JP = { HIGH: 5, MEDIUM: 3, LOW: 1, EASY: 1, HARD: 3, ZERO: 0 };

export default function AssignedTaskModal({ open, task, onClose, onAccept, onReject }) {
  if (!open || !task) return null;
  const subtaskCount = task.subtaskCount || 1;

  return (
    <div className="assigned-task-modal__overlay" onClick={onClose}>
      <div className="assigned-task-modal__card" onClick={(e) => e.stopPropagation()}>
        <div className="assigned-task-modal__header-row">
          <h2 className="assigned-task-modal__header-title">Yeni Görev Ataması</h2>
          <button type="button" onClick={onClose} aria-label="Kapat" className="assigned-task-modal__close">
            <X size={24} />
          </button>
        </div>

        <p className="assigned-task-modal__sender-text">{task.assignedByName || 'Bir arkadaşın'} sana bir görev atadı:</p>
        <h3 className="assigned-task-modal__task-title">{task.title}</h3>
        {task.description && (
          <p style={{ margin: '4px 0 12px 0', fontSize: '14px', color: 'var(--color-text-secondary)', lineHeight: '1.4' }}>
            📝 {task.description}
          </p>
        )}

        <div className="assigned-task-modal__detail-grid">
          <DetailRow icon={Calendar} label="Periyot" value={periodLabel(task.period)} />
          <DetailRow icon={Flag} label="Öncelik" value={`${PRIORITY_LABEL[task.priority]} (${PRIORITY_JP[task.priority]} JP)`} />
          {subtaskCount > 1 && (
            <DetailRow icon={List} label="Sıklık" value={`Periyotta ${subtaskCount} kez yapılmalı`} />
          )}
        </div>

        <div className="assigned-task-modal__actions">
          <AppButton title="Reddet" variant="danger" onClick={onReject} />
          <AppButton title="Kabul Et" onClick={onAccept} />
        </div>
      </div>
    </div>
  );
}

function DetailRow({ icon: Icon, label, value }) {
  return (
    <div className="assigned-task-modal__detail-row">
      <Icon size={16} className="assigned-task-modal__detail-icon" />
      <span className="assigned-task-modal__detail-label">{label}:</span>
      <span className="assigned-task-modal__detail-value">{value}</span>
    </div>
  );
}
