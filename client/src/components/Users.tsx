import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../AuthContext';
import { createUser, deleteUser, fetchUsers, updateUser } from '../api';
import type { Role, User } from '../types';
import { ROLE_LABELS } from '../types';
import PasswordInput from './PasswordInput';

const emptyForm = { name: '', email: '', password: '', role: 'operador' as Role };

export default function Users() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<{ name: string; role: Role; password: string }>({
    name: '',
    role: 'operador',
    password: '',
  });

  const load = useCallback(async () => {
    if (!me) return;
    try {
      const { users } = await fetchUsers(me.id);
      setUsers(users);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar los usuarios');
    } finally {
      setLoading(false);
    }
  }, [me]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!me) return;
    setCreating(true);
    setError('');
    try {
      await createUser(me.id, form);
      setForm(emptyForm);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el usuario');
    } finally {
      setCreating(false);
    }
  }

  function startEdit(u: User) {
    setEditingId(u.id);
    setEditForm({ name: u.name, role: u.role, password: '' });
  }

  async function saveEdit(id: number) {
    if (!me) return;
    setError('');
    try {
      const payload: Partial<{ name: string; role: string; password: string }> = {
        name: editForm.name,
        role: editForm.role,
      };
      if (editForm.password) payload.password = editForm.password;
      await updateUser(me.id, id, payload);
      setEditingId(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar');
    }
  }

  async function toggleActive(u: User) {
    if (!me) return;
    try {
      await updateUser(me.id, u.id, { active: !u.active });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar');
    }
  }

  async function handleDelete(u: User) {
    if (!me) return;
    if (!confirm(`¿Eliminar a ${u.name}? Esta acción no se puede deshacer.`)) return;
    try {
      await deleteUser(me.id, u.id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar');
    }
  }

  if (!me) return null;

  return (
    <div className="page-content">
      <div className="users-layout">
        <form className="users-create-card" onSubmit={handleCreate}>
          <h2>Nuevo usuario</h2>
          <label className="field">
            <span>Nombre</span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </label>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
            />
          </label>
          <label className="field">
            <span>Contraseña</span>
            <PasswordInput
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              minLength={6}
              required
            />
          </label>
          <label className="field">
            <span>Rol</span>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              <option value="operador">Operador</option>
              <option value="administracion">Administración</option>
              <option value="bodega">Bodega</option>
              <option value="dueno">Gerencia</option>
            </select>
          </label>
          {error && <p className="login-error">{error}</p>}
          <button type="submit" className="btn-primary" disabled={creating}>
            {creating ? 'Creando…' : 'Crear usuario'}
          </button>
        </form>

        <div className="users-table-card">
          <h2>Usuarios ({users.length})</h2>
          {loading ? (
            <p className="board-loading">Cargando…</p>
          ) : (
            <table className="users-table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Email</th>
                  <th>Rol</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const isSelf = u.id === me.id;
                  const isEditing = editingId === u.id;
                  return (
                    <tr key={u.id} className={!u.active ? 'row-inactive' : ''}>
                      <td>
                        {isEditing ? (
                          <input
                            value={editForm.name}
                            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                          />
                        ) : (
                          u.name
                        )}
                      </td>
                      <td>{u.email}</td>
                      <td>
                        {isEditing ? (
                          <select
                            value={editForm.role}
                            onChange={(e) => setEditForm({ ...editForm, role: e.target.value as Role })}
                          >
                            <option value="operador">Operador</option>
                            <option value="administracion">Administración</option>
                            <option value="bodega">Bodega</option>
                            <option value="dueno">Gerencia</option>
                          </select>
                        ) : (
                          ROLE_LABELS[u.role]
                        )}
                      </td>
                      <td>
                        <span className={`status-pill ${u.active ? 'status-pill-active' : 'status-pill-inactive'}`}>
                          {u.active ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                      <td className="users-actions">
                        {isEditing ? (
                          <>
                            <PasswordInput
                              placeholder="Nueva contraseña (opcional)"
                              className="users-password-input"
                              value={editForm.password}
                              onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                            />
                            <button type="button" className="btn-primary btn-small" onClick={() => saveEdit(u.id)}>
                              Guardar
                            </button>
                            <button type="button" className="btn-ghost btn-small" onClick={() => setEditingId(null)}>
                              Cancelar
                            </button>
                          </>
                        ) : (
                          <>
                            <button type="button" className="btn-ghost btn-small" onClick={() => startEdit(u)} disabled={isSelf}>
                              Editar
                            </button>
                            <button
                              type="button"
                              className="btn-ghost btn-small"
                              onClick={() => toggleActive(u)}
                              disabled={isSelf}
                            >
                              {u.active ? 'Desactivar' : 'Activar'}
                            </button>
                            <button
                              type="button"
                              className="btn-ghost-danger btn-small"
                              onClick={() => handleDelete(u)}
                              disabled={isSelf}
                            >
                              Eliminar
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
