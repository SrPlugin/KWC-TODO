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
import SearchBar from './SearchBar';

const STATUSES: Status[] = ['todo', 'in_progress', 'done'];

type RoleFilter = 'todos' | TeamRole;

// Normaliza para buscar sin distinguir mayúsculas ni acentos.
function normalize(text: string) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export default function Board() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('todos');
  const [dateRange, setDateRange] = useState({ from: '', to: '' });
  const [search, setSearch] = useState('');
  // Al buscar se ignora el rango de fechas: se usa la lista completa que el
  // usuario tiene permitido ver (el backend ya aplica el filtro por permisos).
  const [searchPool, setSearchPool] = useState<Task[] | null>(null);
  const [modalTask, setModalTask] = useState<Task | 'new' | null>(null);

  const term = normalize(search.trim());
  const searching = term.length > 0;

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

  // Lista sin filtro de fechas, solo para la búsqueda.
  const loadSearchPool = useCallback(async () => {
    if (!user) return;
    try {
      const { tasks } = await fetchTasks(user.id, {});
      setSearchPool(tasks);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las tareas');
    }
  }, [user]);

  // Refresca ambas listas (tablero y pool de búsqueda) tras cualquier cambio.
  const refresh = useCallback(() => {
    load();
    if (searching) loadSearchPool();
  }, [load, loadSearchPool, searching]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (searching) loadSearchPool();
  }, [searching, loadSearchPool]);

  useEffect(() => {
    socket.on('tasks:changed', refresh);
    return () => {
      socket.off('tasks:changed', refresh);
    };
  }, [refresh]);

  const visibleTasks = useMemo(() => {
    let result = searching ? (searchPool ?? tasks) : tasks;
    if (canManageAllRoles && roleFilter !== 'todos') {
      result = result.filter((t) => t.role === roleFilter);
    }
    if (searching) {
      result = result.filter((t) =>
        normalize(
          [t.title, t.description, t.notes, t.assigned_to_name ?? '', t.created_by_name].join(' '),
        ).includes(term),
      );
    }
    return result;
  }, [tasks, searchPool, canManageAllRoles, roleFilter, searching, term]);

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
    const task = visibleTasks.find((t) => t.id === taskId);
    if (!task || task.status === newStatus) return;

    const apply = (list: Task[]) => list.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t));
    setTasks(apply);
    setSearchPool((prev) => (prev ? apply(prev) : prev));
    try {
      await updateTask(user.id, taskId, { status: newStatus });
    } catch {
      refresh(); // revertir en caso de error
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
    refresh();
    return null;
  }

  async function handleDelete() {
    if (!user || modalTask === 'new' || !modalTask) return;
    await deleteTask(user.id, modalTask.id);
    setModalTask(null);
    refresh();
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
        <SearchBar value={search} onChange={setSearch} />
      </div>

      {error && <p className="board-error">{error}</p>}

      {!loading && searching && (
        <p className="board-search-summary">
          {visibleTasks.length === 0
            ? `Sin resultados para “${search.trim()}”`
            : `${visibleTasks.length} ${visibleTasks.length === 1 ? 'tarea' : 'tareas'} para “${search.trim()}”`}
          <span className="board-search-hint"> · busca en todas tus tareas, sin filtro de fechas</span>
        </p>
      )}

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
            refresh();
          }}
          onSave={handleSave}
          onDelete={modalTask !== 'new' ? handleDelete : undefined}
        />
      )}
    </>
  );
}
