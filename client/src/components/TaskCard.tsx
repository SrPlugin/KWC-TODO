import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { Task } from '../types';
import { PRIORITY_LABELS, ROLE_LABELS } from '../types';

interface Props {
  task: Task;
  showRoleBadge: boolean;
  onClick: () => void;
}

function formatDate(iso: string) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export default function TaskCard({ task, showRoleBadge, onClick }: Props) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.4 : 1,
  };

  const isOverdue = task.due_date && task.due_date < new Date().toISOString().slice(0, 10) && task.status !== 'done';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`task-card priority-${task.priority}`}
      onClick={onClick}
      {...listeners}
      {...attributes}
    >
      <div className="task-card-top">
        <span className={`priority-dot priority-dot-${task.priority}`} title={PRIORITY_LABELS[task.priority]} />
        {showRoleBadge && <span className="role-badge">{ROLE_LABELS[task.role]}</span>}
      </div>
      <h3>{task.title}</h3>
      {task.description && <p className="task-card-desc">{task.description}</p>}
      <div className="task-card-meta">
        {task.due_date && (
          <span className={`due-badge ${isOverdue ? 'due-badge-late' : ''}`}>
            {isOverdue ? 'Vencida ' : ''}
            {formatDate(task.due_date)}
          </span>
        )}
        {task.attachment_count > 0 && <span className="attach-badge">📎 {task.attachment_count}</span>}
        {task.message_count > 0 && <span className="attach-badge">💬 {task.message_count}</span>}
      </div>
      <div className="task-card-footer">
        <span>{task.created_by_name}</span>
        <span className="assignee-badge">{task.assigned_to_name ? `→ ${task.assigned_to_name}` : 'Equipo'}</span>
      </div>
    </div>
  );
}
