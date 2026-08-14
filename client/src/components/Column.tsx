import { useDroppable } from '@dnd-kit/core';
import type { Status, Task } from '../types';
import { STATUS_LABELS } from '../types';
import TaskCard from './TaskCard';

interface Props {
  status: Status;
  tasks: Task[];
  showRoleBadge: boolean;
  onTaskClick: (task: Task) => void;
}

export default function Column({ status, tasks, showRoleBadge, onTaskClick }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div className={`column ${isOver ? 'column-over' : ''}`} ref={setNodeRef}>
      <div className="column-header">
        <h2>{STATUS_LABELS[status]}</h2>
        <span className="column-count">{tasks.length}</span>
      </div>
      <div className="column-body">
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} showRoleBadge={showRoleBadge} onClick={() => onTaskClick(task)} />
        ))}
        {tasks.length === 0 && <p className="column-empty">Sin tareas</p>}
      </div>
    </div>
  );
}
