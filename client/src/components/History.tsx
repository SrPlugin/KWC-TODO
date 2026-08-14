import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../AuthContext';
import { fetchHistory } from '../api';
import type { HistoryEntry, TeamRole } from '../types';
import { ACTION_LABELS, ROLE_LABELS, STATUS_LABELS, assignableRolesFor } from '../types';
import DateRangeFilter from './DateRangeFilter';

type RoleFilter = 'todos' | TeamRole;

function formatDateTime(iso: string) {
  return iso.replace('T', ' ').slice(0, 16);
}

function dayKey(iso: string) {
  return iso.slice(0, 10);
}

function formatDayLabel(day: string) {
  const [y, m, d] = day.split('-');
  return `${d}/${m}/${y}`;
}

export default function History() {
  const { user } = useAuth();
  const assignableRoles = assignableRolesFor(user?.role);
  const canManageAllRoles = assignableRoles.length > 1;
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('todos');
  const [dateRange, setDateRange] = useState({ from: '', to: '' });
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const { history } = await fetchHistory(user.id, {
        role: roleFilter === 'todos' ? undefined : roleFilter,
        from: dateRange.from,
        to: dateRange.to,
      });
      setEntries(history);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el historial');
    } finally {
      setLoading(false);
    }
  }, [user, roleFilter, dateRange]);

  useEffect(() => {
    load();
  }, [load]);

  if (!user) return null;

  const groups: Array<[string, HistoryEntry[]]> = [];
  for (const entry of entries) {
    const key = dayKey(entry.created_at);
    const last = groups[groups.length - 1];
    if (last && last[0] === key) last[1].push(entry);
    else groups.push([key, [entry]]);
  }

  return (
    <div className="page-content">
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
      </div>

      <div className="board-toolbar board-toolbar-secondary">
        <DateRangeFilter from={dateRange.from} to={dateRange.to} onChange={setDateRange} />
      </div>

      {error && <p className="board-error">{error}</p>}

      {loading ? (
        <p className="board-loading">Cargando historial…</p>
      ) : groups.length === 0 ? (
        <p className="board-loading">Sin actividad en este rango de fechas.</p>
      ) : (
        <div className="history-timeline">
          {groups.map(([day, dayEntries]) => (
            <div key={day} className="history-day">
              <h3 className="history-day-label">{formatDayLabel(day)}</h3>
              <ul>
                {dayEntries.map((entry) => (
                  <li key={entry.id} className={`history-entry history-entry-${entry.action}`}>
                    <span className="history-time">{formatDateTime(entry.created_at).slice(11)}</span>
                    <span className="history-text">
                      <strong>{entry.user_name}</strong> {ACTION_LABELS[entry.action].toLowerCase()}{' '}
                      <em>{entry.task_title}</em>
                      {entry.action === 'moved' && entry.from_status && entry.to_status && (
                        <>
                          {' '}
                          de <strong>{STATUS_LABELS[entry.from_status]}</strong> a{' '}
                          <strong>{STATUS_LABELS[entry.to_status]}</strong>
                        </>
                      )}
                      <span className="role-badge history-role-badge">{ROLE_LABELS[entry.role]}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
