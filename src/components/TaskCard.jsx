// J-Planning — Görev Kartı (Web)
// Mobildeki src/components/TaskCard.js dosyasının web karşılığı.
// Pressable/haptics yerine iki ayrı tıklanabilir alan: kart gövdesi (detaya
// gider) ve sağdaki daire buton (tamamla/geri al).
import { Flame, Check, X, Circle, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';
import { periodLabel } from '../utils/period';
import './TaskCard.css';

const PRIORITY_COLOR_VAR = {
  HIGH: '--color-priority-high',
  MEDIUM: '--color-priority-medium',
  LOW: '--color-priority-low',
  EASY: '--color-priority-low',
  HARD: '--color-priority-high',
};

const PRIORITY_LABEL = {
  HIGH: 'Yüksek',
  MEDIUM: 'Orta',
  LOW: 'Düşük',
  EASY: 'Kolay',
  HARD: 'Zor',
};

// task.assignmentDirection: null (kendi görevim) | 'RECEIVED' (bana atandı) | 'SENT' (ben attım)
export default function TaskCard({
  task,
  status,
  completedSubtasks,
  streak,
  onOpen,
  onClick,
  onComplete,
  onUncomplete,
}) {
  const priorityColorVar = PRIORITY_COLOR_VAR[task.priority] || '--color-priority-medium';
  const isDone = status === 'SUCCESSFUL';
  const isFailed = status === 'FAILED';
  const isSent = task.assignmentDirection === 'SENT';
  const isReceived = task.assignmentDirection === 'RECEIVED';
  const subtaskCount = task.subtaskCount || 1;
  const hasMultipleSubtasks = subtaskCount > 1;

  const accentVar = isSent ? '--color-friend-sent' : isReceived ? '--color-friend-received' : priorityColorVar;

  const handleBodyClick = (e) => {
    e.stopPropagation();
    if (onOpen) onOpen();
    else if (onClick) onClick();
  };

  const handleCheckClick = (e) => {
    e.stopPropagation(); // kart gövdesindeki detay tıklamasını tetiklemesin
    if (isSent) return;
    if (isDone) {
      onUncomplete?.();
    } else {
      onComplete?.();
    }
  };

  return (
    <div className="task-card" style={{ '--task-accent': `var(${accentVar})` }}>
      <button type="button" className="task-card__body" onClick={handleBodyClick}>
        <div className="task-card__bar" />
        <div className="task-card__content">
          <div className="task-card__header-row">
            <span className="task-card__title">{task.title}</span>
            {isReceived && (
              <span className="task-card__badge task-card__badge--received">
                <ArrowDownCircle size={11} />
                {task.assignedByName}'den
              </span>
            )}
            {isSent && (
              <span className="task-card__badge task-card__badge--sent">
                <ArrowUpCircle size={11} />
                {task.assignedToName}'e attım
              </span>
            )}
          </div>

          {task.description && (
            <p className="task-card__description">{task.description}</p>
          )}

          <div className="task-card__meta-row">
            <span>{periodLabel(task.period)}</span>
            <span className="task-card__meta-dot">•</span>
            <span style={{ color: `var(${priorityColorVar})` }}>{PRIORITY_LABEL[task.priority]}</span>
            {hasMultipleSubtasks && (
              <>
                <span className="task-card__meta-dot">•</span>
                <span>{completedSubtasks}/{subtaskCount}</span>
              </>
            )}
            {streak > 0 && (
              <>
                <span className="task-card__meta-dot">•</span>
                <span className="task-card__streak">
                  <Flame size={12} />
                  {streak}
                </span>
              </>
            )}
          </div>
        </div>
      </button>

      {!isSent && (
        <button
          type="button"
          onClick={handleCheckClick}
          aria-label={isDone ? 'Tamamlamayı geri al' : 'Tamamlandı olarak işaretle'}
          className={`task-card__check ${isDone ? 'task-card__check--done' : isFailed ? 'task-card__check--failed' : ''}`}
        >
          {isDone ? <Check size={20} /> : isFailed ? <X size={20} /> : <Circle size={20} />}
        </button>
      )}
    </div>
  );
}
