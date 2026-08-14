export type TeamRole = 'administracion' | 'operador' | 'bodega';
export type Role = 'dueno' | TeamRole;
export type Status = 'todo' | 'in_progress' | 'done';
export type Priority = 'baja' | 'media' | 'alta';

export const TEAM_ROLES: TeamRole[] = ['administracion', 'operador', 'bodega'];

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  created_at?: string;
}

export interface Task {
  id: number;
  title: string;
  description: string;
  notes: string;
  role: TeamRole;
  status: Status;
  priority: Priority;
  due_date: string | null;
  created_by: number;
  created_by_name: string;
  assigned_to: number | null;
  assigned_to_name: string | null;
  created_at: string;
  updated_at: string;
  attachment_count: number;
  message_count: number;
}

export interface AssignableUser {
  id: number;
  name: string;
  role: TeamRole;
}

export interface Attachment {
  id: number;
  task_id: number;
  original_name: string;
  stored_name: string;
  mime_type: string;
  size: number;
  uploaded_by: number;
  uploaded_by_name: string;
  created_at: string;
}

export interface HistoryEntry {
  id: number;
  task_id: number;
  task_title: string;
  user_id: number | null;
  user_name: string;
  role: TeamRole;
  action: 'created' | 'updated' | 'moved' | 'deleted';
  from_status: Status | null;
  to_status: Status | null;
  note: string;
  created_at: string;
}

export interface TaskMessage {
  id: number;
  task_id: number;
  user_id: number;
  user_name: string;
  message: string;
  created_at: string;
}

export interface Notification {
  id: number;
  user_id: number;
  type: 'assigned' | 'completed' | 'message';
  task_id: number;
  task_title: string;
  message: string;
  read: boolean | number;
  created_at: string;
}

export interface Kpis {
  range: { from: string; to: string };
  totals: { todo: number; in_progress: number; done: number; total: number; overdue: number };
  completionRate: number;
  byPriority: { baja: number; media: number; alta: number };
  daily: Array<{ date: string; created: number; completed: number }>;
}

export const ROLE_LABELS: Record<Role, string> = {
  dueno: 'Dueño',
  administracion: 'Administración',
  operador: 'Operador',
  bodega: 'Bodega',
};

export const STATUS_LABELS: Record<Status, string> = {
  todo: 'Por hacer',
  in_progress: 'En progreso',
  done: 'Hecho',
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  baja: 'Baja',
  media: 'Media',
  alta: 'Alta',
};

export const ACTION_LABELS: Record<HistoryEntry['action'], string> = {
  created: 'Creó',
  updated: 'Editó',
  moved: 'Movió',
  deleted: 'Eliminó',
};
