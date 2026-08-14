import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { AssignableUser, Attachment, Priority, Task, TaskMessage, TeamRole } from '../types';
import { useAuth } from '../AuthContext';
import { socket } from '../socket';
import {
  attachmentDownloadUrl,
  deleteAttachment,
  fetchAssignableUsers,
  fetchAttachments,
  fetchMessages,
  sendMessage,
  uploadAttachments,
} from '../api';
import { ROLE_LABELS } from '../types';

interface Props {
  task: Task | null; // null = creando nueva
  assignableRoles: TeamRole[];
  onClose: () => void;
  onSave: (payload: {
    title: string;
    description: string;
    notes: string;
    priority: Priority;
    due_date: string | null;
    assigned_to: number | null;
    role?: TeamRole;
  }) => Promise<Task | null | undefined>;
  onDelete?: () => Promise<void>;
}

type AssignMode = 'team' | 'user';

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function TaskModal({ task, assignableRoles, onClose, onSave, onDelete }: Props) {
  const { user } = useAuth();
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [notes, setNotes] = useState(task?.notes ?? '');
  const [priority, setPriority] = useState<Priority>(task?.priority ?? 'media');
  const [dueDate, setDueDate] = useState(task?.due_date ?? '');
  const canChooseRole = assignableRoles.length > 1;
  const [role, setRole] = useState<TeamRole>(task?.role ?? assignableRoles[0] ?? 'administracion');
  const [assignMode, setAssignMode] = useState<AssignMode>(task?.assigned_to ? 'user' : 'team');
  const [assignedUserId, setAssignedUserId] = useState<number | null>(task?.assigned_to ?? null);
  const [assignableUsers, setAssignableUsers] = useState<AssignableUser[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [activeTaskId, setActiveTaskId] = useState<number | null>(task?.id ?? null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);

  const [messages, setMessages] = useState<TaskMessage[]>([]);
  const [messageText, setMessageText] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);

  useEffect(() => {
    if (!activeTaskId || !user) return;
    fetchAttachments(user.id, activeTaskId)
      .then((r) => setAttachments(r.attachments))
      .catch(() => {});
  }, [activeTaskId, user]);

  useEffect(() => {
    if (!activeTaskId || !user) return;
    fetchMessages(user.id, activeTaskId)
      .then((r) => setMessages(r.messages))
      .catch(() => {});
  }, [activeTaskId, user]);

  useEffect(() => {
    if (!activeTaskId || !user) return;
    const onTaskMessage = (payload: { taskId: number }) => {
      if (payload.taskId !== activeTaskId) return;
      fetchMessages(user.id, activeTaskId)
        .then((r) => setMessages(r.messages))
        .catch(() => {});
    };
    socket.on('task-message', onTaskMessage);
    return () => {
      socket.off('task-message', onTaskMessage);
    };
  }, [activeTaskId, user]);

  useEffect(() => {
    if (!user) return;
    fetchAssignableUsers(user.id)
      .then((r) => setAssignableUsers(r.users))
      .catch(() => {});
  }, [user]);

  const usersForAssignment = useMemo(() => {
    if (canChooseRole) return assignableUsers.filter((u) => u.role === role);
    return assignableUsers.filter((u) => u.role === user?.role);
  }, [assignableUsers, canChooseRole, role, user]);

  useEffect(() => {
    if (assignMode === 'user' && assignedUserId && !usersForAssignment.some((u) => u.id === assignedUserId)) {
      setAssignedUserId(null);
    }
  }, [usersForAssignment, assignMode, assignedUserId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError('El título es obligatorio');
      return;
    }
    if (assignMode === 'user' && !assignedUserId) {
      setError('Selecciona a quién se asigna la tarea');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const saved = await onSave({
        title: title.trim(),
        description,
        notes,
        priority,
        due_date: dueDate || null,
        assigned_to: assignMode === 'user' ? assignedUserId : null,
        ...(canChooseRole ? { role } : {}),
      });
      if (saved && !activeTaskId) {
        setActiveTaskId(saved.id);
      } else {
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }

  async function handleUpload(files: FileList | null) {
    if (!files || !files.length || !activeTaskId || !user) return;
    setUploading(true);
    try {
      const { attachments: created } = await uploadAttachments(user.id, activeTaskId, Array.from(files));
      setAttachments((prev) => [...created, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo subir el archivo');
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteAttachment(id: number) {
    if (!user) return;
    await deleteAttachment(user.id, id);
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  async function handleSendMessage() {
    if (!messageText.trim() || !activeTaskId || !user) return;
    setSendingMessage(true);
    try {
      const { message: created } = await sendMessage(user.id, activeTaskId, messageText.trim());
      setMessages((prev) => [...prev, created]);
      setMessageText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo enviar el mensaje');
    } finally {
      setSendingMessage(false);
    }
  }

  function handleMessageKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  }

  function formatMessageTime(iso: string) {
    return iso.replace('T', ' ').slice(5, 16);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal-card" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2>{task ? 'Editar tarea' : activeTaskId ? 'Adjuntar documentos' : 'Nueva tarea'}</h2>

        {!activeTaskId || task ? (
          <>
            <label className="field">
              <span>Título</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required />
            </label>

            <label className="field">
              <span>Descripción</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Detalles opcionales…"
              />
            </label>

            <label className="field">
              <span>Nota</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Nota interna, seguimiento, avances…"
              />
            </label>

            <div className="field-row">
              <label className="field">
                <span>Prioridad</span>
                <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
                  <option value="baja">Baja</option>
                  <option value="media">Media</option>
                  <option value="alta">Alta</option>
                </select>
              </label>

              <label className="field">
                <span>Fecha límite</span>
                <input type="date" value={dueDate ?? ''} onChange={(e) => setDueDate(e.target.value)} />
              </label>
            </div>

            <div className="field">
              <span>Asignar a</span>
              <div className="assign-mode-row">
                <button
                  type="button"
                  className={`chip ${assignMode === 'team' ? 'chip-active' : ''}`}
                  onClick={() => setAssignMode('team')}
                >
                  {canChooseRole ? 'Todo el equipo' : 'Todo mi equipo'}
                </button>
                <button
                  type="button"
                  className={`chip ${assignMode === 'user' ? 'chip-active' : ''}`}
                  onClick={() => setAssignMode('user')}
                >
                  Persona específica
                </button>
              </div>

              <div className="field-row assign-selects">
                {canChooseRole && assignMode === 'team' && (
                  <label className="field">
                    <span>Rol destino</span>
                    <select value={role} onChange={(e) => setRole(e.target.value as TeamRole)}>
                      {assignableRoles.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {assignMode === 'user' && (
                  <>
                    {canChooseRole && (
                      <label className="field">
                        <span>Rol</span>
                        <select value={role} onChange={(e) => setRole(e.target.value as TeamRole)}>
                          {assignableRoles.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label className="field">
                      <span>Persona</span>
                      <select
                        value={assignedUserId ?? ''}
                        onChange={(e) => setAssignedUserId(e.target.value ? Number(e.target.value) : null)}
                      >
                        <option value="">— Selecciona —</option>
                        {usersForAssignment.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                      </select>
                      {usersForAssignment.length === 0 && (
                        <span className="hint-text">
                          No hay usuarios activos en {ROLE_LABELS[canChooseRole ? role : user?.role ?? 'operador']}
                        </span>
                      )}
                    </label>
                  </>
                )}
              </div>
            </div>
          </>
        ) : null}

        <div className="field">
          <span>Documentos adjuntos</span>
          {activeTaskId ? (
            <>
              <input type="file" multiple onChange={(e) => handleUpload(e.target.files)} disabled={uploading} />
              {uploading && <p className="hint-text">Subiendo…</p>}
              <ul className="attachment-list">
                {attachments.map((a) => (
                  <li key={a.id}>
                    <a href={user ? attachmentDownloadUrl(a.id, user.id) : '#'} target="_blank" rel="noreferrer">
                      📎 {a.original_name}
                    </a>
                    <span className="attachment-size">{formatSize(a.size)}</span>
                    <button type="button" className="attachment-remove" onClick={() => handleDeleteAttachment(a.id)}>
                      ✕
                    </button>
                  </li>
                ))}
                {attachments.length === 0 && <li className="hint-text">Sin documentos aún</li>}
              </ul>
            </>
          ) : (
            <p className="hint-text">Guarda la tarea primero para poder adjuntar documentos.</p>
          )}
        </div>

        <div className="field">
          <span>Chat de la tarea</span>
          {activeTaskId ? (
            <div className="chat-box">
              <div className="chat-messages">
                {messages.map((m) => (
                  <div key={m.id} className={`chat-bubble ${m.user_id === user?.id ? 'chat-bubble-mine' : ''}`}>
                    <div className="chat-bubble-meta">
                      <strong>{m.user_name}</strong>
                      <span>{formatMessageTime(m.created_at)}</span>
                    </div>
                    <p>{m.message}</p>
                  </div>
                ))}
                {messages.length === 0 && <p className="hint-text">Sin mensajes todavía</p>}
              </div>
              <div className="chat-input-row">
                <textarea
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  onKeyDown={handleMessageKeyDown}
                  rows={2}
                  placeholder="Escribe un mensaje… (Enter para enviar)"
                />
                <button
                  type="button"
                  className="btn-primary btn-small"
                  onClick={handleSendMessage}
                  disabled={sendingMessage || !messageText.trim()}
                >
                  Enviar
                </button>
              </div>
            </div>
          ) : (
            <p className="hint-text">Guarda la tarea primero para poder chatear sobre ella.</p>
          )}
        </div>

        {error && <p className="login-error">{error}</p>}

        <div className="modal-actions">
          {task && onDelete && (
            <button type="button" className="btn-ghost-danger" onClick={onDelete}>
              Eliminar
            </button>
          )}
          <div className="modal-actions-right">
            <button type="button" className="btn-ghost" onClick={onClose}>
              {activeTaskId && !task ? 'Listo' : 'Cancelar'}
            </button>
            {(!activeTaskId || task) && (
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
