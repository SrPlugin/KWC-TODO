import { useCallback, useEffect, useState } from 'react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { useAuth } from '../AuthContext';
import { fetchKpis } from '../api';
import type { Kpis, TeamRole } from '../types';
import { ROLE_LABELS, TEAM_ROLES } from '../types';
import DateRangeFilter from './DateRangeFilter';

type RoleFilter = 'todos' | TeamRole;

const STATUS_COLORS = { todo: '#f3b8b8', in_progress: '#d92d2d', done: '#7a1414' };
const PRIORITY_COLORS = { baja: '#f3b8b8', media: '#d92d2d', alta: '#7a1414' };

function formatDay(iso: string) {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

export default function Dashboard() {
  const { user } = useAuth();
  const canManageAllRoles = user?.role === 'dueno' || user?.role === 'administracion' || user?.role === 'operador';
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('todos');
  const [dateRange, setDateRange] = useState({ from: '', to: '' });
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const data = await fetchKpis(user.id, {
        role: roleFilter === 'todos' ? undefined : roleFilter,
        from: dateRange.from,
        to: dateRange.to,
      });
      setKpis(data);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el dashboard');
    } finally {
      setLoading(false);
    }
  }, [user, roleFilter, dateRange]);

  useEffect(() => {
    load();
  }, [load]);

  if (!user) return null;

  const statusData = kpis
    ? [
        { name: 'Por hacer', value: kpis.totals.todo, key: 'todo' },
        { name: 'En progreso', value: kpis.totals.in_progress, key: 'in_progress' },
        { name: 'Hecho', value: kpis.totals.done, key: 'done' },
      ]
    : [];

  const priorityData = kpis
    ? [
        { name: 'Baja', value: kpis.byPriority.baja, key: 'baja' },
        { name: 'Media', value: kpis.byPriority.media, key: 'media' },
        { name: 'Alta', value: kpis.byPriority.alta, key: 'alta' },
      ]
    : [];

  return (
    <div className="page-content">
      <div className="board-toolbar">
        {canManageAllRoles && (
          <div className="role-tabs">
            {(['todos', ...TEAM_ROLES] as RoleFilter[]).map((r) => (
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

      {loading || !kpis ? (
        <p className="board-loading">Cargando dashboard…</p>
      ) : (
        <>
          <div className="kpi-cards">
            <div className="kpi-card">
              <span className="kpi-value">{kpis.totals.total}</span>
              <span className="kpi-label">Tareas totales</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-value">{kpis.totals.done}</span>
              <span className="kpi-label">Completadas</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-value">{kpis.completionRate}%</span>
              <span className="kpi-label">Tasa de avance</span>
            </div>
            <div className="kpi-card kpi-card-danger">
              <span className="kpi-value">{kpis.totals.overdue}</span>
              <span className="kpi-label">Vencidas</span>
            </div>
          </div>

          <div className="charts-grid">
            <div className="chart-card chart-card-wide">
              <h3>Progreso diario ({kpis.range.from} – {kpis.range.to})</h3>
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={kpis.daily}>
                  <defs>
                    <linearGradient id="createdGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f3b8b8" stopOpacity={0.7} />
                      <stop offset="95%" stopColor="#f3b8b8" stopOpacity={0.05} />
                    </linearGradient>
                    <linearGradient id="completedGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#d92d2d" stopOpacity={0.7} />
                      <stop offset="95%" stopColor="#d92d2d" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eadede" />
                  <XAxis dataKey="date" tickFormatter={formatDay} fontSize={12} stroke="#6b6b6b" />
                  <YAxis allowDecimals={false} fontSize={12} stroke="#6b6b6b" />
                  <Tooltip labelFormatter={(label) => formatDay(String(label))} />
                  <Legend />
                  <Area type="monotone" dataKey="created" name="Creadas" stroke="#c98a8a" fill="url(#createdGrad)" />
                  <Area
                    type="monotone"
                    dataKey="completed"
                    name="Completadas"
                    stroke="#d92d2d"
                    fill="url(#completedGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="chart-card">
              <h3>Estado de tareas</h3>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={2}>
                    {statusData.map((entry) => (
                      <Cell key={entry.key} fill={STATUS_COLORS[entry.key as keyof typeof STATUS_COLORS]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="chart-card">
              <h3>Tareas por prioridad</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={priorityData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eadede" />
                  <XAxis dataKey="name" fontSize={12} stroke="#6b6b6b" />
                  <YAxis allowDecimals={false} fontSize={12} stroke="#6b6b6b" />
                  <Tooltip />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                    {priorityData.map((entry) => (
                      <Cell key={entry.key} fill={PRIORITY_COLORS[entry.key as keyof typeof PRIORITY_COLORS]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
