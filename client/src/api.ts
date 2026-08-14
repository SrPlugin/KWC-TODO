import type { AssignableUser, Attachment, HistoryEntry, Kpis, Notification, Task, TaskMessage, User } from './types';

const BASE = '/api';

async function request<T>(path: string, options: RequestInit = {}, userId?: number): Promise<T> {
  const isFormData = options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers as Record<string, string> | undefined),
  };
  if (userId) headers['x-user-id'] = String(userId);

  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (res.status === 204) return undefined as T;

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    if (!res.ok) throw new Error('Error de red');
    return undefined as T;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error de red');
  return data as T;
}

function qs(params: Record<string, string | undefined>) {
  const entries = Object.entries(params).filter(([, v]) => v);
  if (!entries.length) return '';
  return '?' + new URLSearchParams(entries as [string, string][]).toString();
}

// --- Auth ---
export function login(email: string, password: string) {
  return request<{ user: User }>('/login', { method: 'POST', body: JSON.stringify({ email, password }) });
}

// --- Tasks ---
export function fetchTasks(userId: number, filters: { role?: string; from?: string; to?: string } = {}) {
  return request<{ tasks: Task[] }>(`/tasks${qs(filters)}`, {}, userId);
}

export function createTask(
  userId: number,
  payload: {
    title: string;
    description?: string;
    notes?: string;
    priority?: string;
    role?: string;
    due_date?: string | null;
    assigned_to?: number | null;
  }
) {
  return request<{ task: Task }>('/tasks', { method: 'POST', body: JSON.stringify(payload) }, userId);
}

export function updateTask(
  userId: number,
  taskId: number,
  payload: Partial<{
    title: string;
    description: string;
    notes: string;
    status: string;
    priority: string;
    role: string;
    due_date: string | null;
    assigned_to: number | null;
  }>
) {
  return request<{ task: Task }>(`/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify(payload) }, userId);
}

export function fetchAssignableUsers(userId: number) {
  return request<{ users: AssignableUser[] }>('/users/lite', {}, userId);
}

export function deleteTask(userId: number, taskId: number) {
  return request<void>(`/tasks/${taskId}`, { method: 'DELETE' }, userId);
}

// --- Attachments ---
export function fetchAttachments(userId: number, taskId: number) {
  return request<{ attachments: Attachment[] }>(`/tasks/${taskId}/attachments`, {}, userId);
}

export function uploadAttachments(userId: number, taskId: number, files: File[]) {
  const form = new FormData();
  files.forEach((f) => form.append('files', f));
  return request<{ attachments: Attachment[] }>(
    `/tasks/${taskId}/attachments`,
    { method: 'POST', body: form },
    userId
  );
}

export function deleteAttachment(userId: number, attachmentId: number) {
  return request<void>(`/attachments/${attachmentId}`, { method: 'DELETE' }, userId);
}

export function attachmentDownloadUrl(attachmentId: number, userId: number) {
  return `${BASE}/attachments/${attachmentId}/download?userId=${userId}`;
}

// --- History ---
export function fetchHistory(userId: number, filters: { role?: string; from?: string; to?: string } = {}) {
  return request<{ history: HistoryEntry[] }>(`/history${qs(filters)}`, {}, userId);
}

// --- KPIs ---
export function fetchKpis(userId: number, filters: { role?: string; from?: string; to?: string } = {}) {
  return request<Kpis>(`/kpis${qs(filters)}`, {}, userId);
}

// --- Users (RBAC) ---
export function fetchUsers(userId: number) {
  return request<{ users: User[] }>('/users', {}, userId);
}

export function createUser(userId: number, payload: { name: string; email: string; password: string; role: string }) {
  return request<{ user: User }>('/users', { method: 'POST', body: JSON.stringify(payload) }, userId);
}

export function updateUser(
  userId: number,
  targetId: number,
  payload: Partial<{ name: string; role: string; active: boolean; password: string }>
) {
  return request<{ user: User }>(`/users/${targetId}`, { method: 'PATCH', body: JSON.stringify(payload) }, userId);
}

export function deleteUser(userId: number, targetId: number) {
  return request<void>(`/users/${targetId}`, { method: 'DELETE' }, userId);
}

// --- Task chat ---
export function fetchMessages(userId: number, taskId: number) {
  return request<{ messages: TaskMessage[] }>(`/tasks/${taskId}/messages`, {}, userId);
}

export function sendMessage(userId: number, taskId: number, message: string) {
  return request<{ message: TaskMessage }>(
    `/tasks/${taskId}/messages`,
    { method: 'POST', body: JSON.stringify({ message }) },
    userId
  );
}

// --- Notifications ---
export function fetchNotifications(userId: number) {
  return request<{ notifications: Notification[]; unreadCount: number }>('/notifications', {}, userId);
}

export function markNotificationRead(userId: number, notificationId: number) {
  return request<void>(`/notifications/${notificationId}/read`, { method: 'PATCH' }, userId);
}

export function markAllNotificationsRead(userId: number) {
  return request<void>('/notifications/read-all', { method: 'POST' }, userId);
}
