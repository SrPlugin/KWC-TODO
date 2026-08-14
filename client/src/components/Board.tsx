import { useEffect, useMemo, useState, useCallback } from 'react';
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { useAuth } from '../AuthContext';
import { socket } from '../socket';
import { createTask, deleteTask, fetchTasks, updateTask } from '../api';
import type { Priority, Status, Task, TeamRole } from '../types';
import { ROLE_LABELS, assignableRolesFor } from '../types';
import Column from './Column';
import TaskModal from './TaskModal';
import DateRangeFilter from './DateRangeFilter';

const STATUSES: Status[] = ['todo', 'in_progress', 'done'];

type RoleFilter = 'todos' | TeamRole;

export default function Board() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('todos');
  const [dateRange, setDateRange] = useState({ from: '', to: '' });
  const [modalTask, setModalTask] = useState<Task | 'new' | null>(null);

  const assignableRoles = assignableRolesFor(user?.role);
  const canManageAllRoles = assignableRoles.length > 1;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const { tasks } = await fetchTasks(user.id, { from: dateRange.from, to: dateRange.to });
      setTasks(tasks);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las tareas');
    } finally {
      setLoading(false);
    }
  }, [user, dateRange]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onChanged = () => load();
    socket.on('tasks:changed', onChanged);
    return () => {
      socket.off('tasks:changed', onChanged);
    };
  }, [load]);

  const visibleTasks = useMemo(() => {
    if (!canManageAllRoles || roleFilter === 'todos') return tasks;
    return tasks.filter((t) => t.role === roleFilter);
  }, [tasks, canManageAllRoles, roleFilter]);

  const columns = useMemo(() => {
    const map: Record<Status, Task[]> = { todo: [], in_progress: [], done: [] };
    for (const t of visibleTasks) map[t.status].push(t);
    return map;
  }, [visibleTasks]);

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || !user) return;
    const taskId = Number(active.id);
    const newStatus = over.id as Status;
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status === newStatus) return;

    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t)));
    try {
      await updateTask(user.id, taskId, { status: newStatus });
    } catch {
      load(); // revertir en caso de error
    }
  }

  async function handleSave(payload: {
    title: string;
    description: string;
    notes: string;
    priority: Priority;
    due_date: string | null;
    assigned_to: number | null;
    role?: TeamRole;
  }) {
    if (!user) return;
    if (modalTask === 'new') {
      const { task } = await createTask(user.id, payload);
      return task;
    } else if (modalTask) {
      await updateTask(user.id, modalTask.id, payload);
    }
    load();
    return null;
  }

  async function handleDelete() {
    if (!user || modalTask === 'new' || !modalTask) return;
    await deleteTask(user.id, modalTask.id);
    setModalTask(null);
    load();
  }

  if (!user) return null;

  return (
    <>
      <div className="board-toolbar">
        {canManageAllRoles && (
          <div className="role-tabs">
            {(['todos', ...assignableRoles] as RoleFilter[]).map((r) => (
              <button
                key={r}
                className={`role-tab ${roleFilter === r ? 'role-tab-active' : ''}`}
                onClick={() => setRoleFilter(r)}
              >
                {r === 'todos' ? 'Todos' : ROLE_LABELS[r]}
              </button>
            ))}
          </div>
        )}
        <button className="btn-primary" onClick={() => setModalTask('new')}>
          + Nueva tarea
        </button>
      </div>

      <div className="board-toolbar board-toolbar-secondary">
        <DateRangeFilter from={dateRange.from} to={dateRange.to} onChange={setDateRange} />
      </div>

      {error && <p className="board-error">{error}</p>}

      {loading ? (
        <p className="board-loading">Cargando tareas…</p>
      ) : (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div className="board-columns">
            {STATUSES.map((status) => (
              <Column
                key={status}
                status={status}
                tasks={columns[status]}
                showRoleBadge={canManageAllRoles}
                onTaskClick={setModalTask}
              />
            ))}
          </div>
        </DndContext>
      )}

      {modalTask && (
        <TaskModal
          task={modalTask === 'new' ? null : modalTask}
          assignableRoles={assignableRoles}
          onClose={() => {
            setModalTask(null);
            load();
          }}
          onSave={handleSave}
          onDelete={modalTask !== 'new' ? handleDelete : undefined}
        />
      )}
    </>
  );
}
