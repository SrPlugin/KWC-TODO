import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import db, { DATA_DIR } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const CLIENT_DIST = path.join(__dirname, '..', 'client', 'dist');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// En producción detrás de un reverse proxy (nginx/Caddy/Traefik) para que
// express-rate-limit y los logs usen la IP real del cliente, no la del proxy.
const app = express();
app.set('trust proxy', 1);

const ALLOWED_ORIGINS = (process.env.FRONTEND_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim());

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: ALLOWED_ORIGINS } });

app.use(
  helmet({
    // El SPA se sirve desde este mismo backend; una CSP estricta por defecto
    // requeriría afinar cada directiva (scripts/estilos de Vite, sockets, etc.).
    // Se deja desactivada para no romper el build y se documenta como pendiente.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(express.json({ limit: '1mb' }));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de inicio de sesión. Intenta de nuevo en unos minutos.' },
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', apiLimiter);

const TEAM_ROLES = ['administracion', 'operador', 'bodega'];
const ALL_ROLES = ['dueno', ...TEAM_ROLES];

const TASK_SELECT = `
  SELECT tasks.*, COALESCE(users.name, 'Usuario eliminado') AS created_by_name,
    assignee.name AS assigned_to_name,
    (SELECT COUNT(*) FROM attachments WHERE attachments.task_id = tasks.id) AS attachment_count,
    (SELECT COUNT(*) FROM task_messages WHERE task_messages.task_id = tasks.id) AS message_count
  FROM tasks
  LEFT JOIN users ON users.id = tasks.created_by
  LEFT JOIN users AS assignee ON assignee.id = tasks.assigned_to
`;

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, active: !!u.active, created_at: u.created_at };
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function logHistory({ taskId, taskTitle, userId, role, action, fromStatus = null, toStatus = null, note = '' }) {
  db.prepare(
    `INSERT INTO task_history (task_id, task_title, user_id, role, action, from_status, to_status, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(taskId, taskTitle, userId, role, action, fromStatus, toStatus, note);
}

const notifyInsert = db.prepare(
  `INSERT INTO notifications (user_id, type, task_id, task_title, message) VALUES (?, ?, ?, ?, ?)`
);

function notify(userId, type, taskId, taskTitle, message) {
  notifyInsert.run(userId, type, taskId, taskTitle, message);
}

function notifyTaskCreated({ task, actorId }) {
  if (task.assigned_to) {
    if (task.assigned_to !== actorId) {
      notify(task.assigned_to, 'assigned', task.id, task.title, `Se te asignó la tarea "${task.title}"`);
    }
    return;
  }
  const teammates = db
    .prepare('SELECT id FROM users WHERE active = 1 AND role = ? AND id != ?')
    .all(task.role, actorId);
  for (const t of teammates) {
    notify(t.id, 'assigned', task.id, task.title, `Nueva tarea para el equipo: "${task.title}"`);
  }
}

function notifyTaskCompleted({ task, actorId, actorName }) {
  const owners = db.prepare("SELECT id FROM users WHERE active = 1 AND role = 'dueno' AND id != ?").all(actorId);
  for (const o of owners) {
    notify(o.id, 'completed', task.id, task.title, `${actorName} completó la tarea "${task.title}"`);
  }
}

function taskParticipantIds(task) {
  const ids = new Set([task.created_by]);
  if (task.assigned_to) {
    ids.add(task.assigned_to);
  } else {
    const teammates = db.prepare('SELECT id FROM users WHERE active = 1 AND role = ?').all(task.role);
    for (const t of teammates) ids.add(t.id);
  }
  return ids;
}

function notifyNewMessage({ task, actorId, actorName, messageText }) {
  const preview = messageText.length > 80 ? `${messageText.slice(0, 80)}…` : messageText;
  const recipients = taskParticipantIds(task);
  recipients.delete(actorId);
  for (const userId of recipients) {
    notify(userId, 'message', task.id, task.title, `${actorName} comentó en "${task.title}": ${preview}`);
  }
}

// --- Middleware ---
function requireUser(req, res, next) {
  const userId = Number(req.header('x-user-id') || req.query.userId);
  if (!userId) return res.status(401).json({ error: 'No autenticado' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user || !user.active) return res.status(401).json({ error: 'Sesión inválida' });
  req.user = user;
  next();
}

function requireOwner(req, res, next) {
  if (req.user.role !== 'dueno') return res.status(403).json({ error: 'Solo el dueño puede hacer esto' });
  next();
}

// Roles que un usuario supervisa por completo, sin importar quién creó/asignó la tarea
// ni a quién se asignó específicamente. Gerencia supervisa las 3 áreas. Bodega es la
// única excepción entre el resto: TODOS (Administración, Operador y el propio Bodega)
// supervisan Bodega por completo, la vea quien la vea. Entre Administración y Operador
// no hay supervisión: cada uno solo ve lo propio, lo que se comparte con todo su rol, o
// lo que se le asigna a él en concreto (ver canAccessTask).
function supervisedRoles(user) {
  if (user.role === 'dueno') return TEAM_ROLES;
  return ['bodega'];
}

// A qué roles puede crear/asignar tareas un usuario. Gerencia a cualquiera de las 3.
// Administración y Operador pueden asignarse tareas entre sí y a Bodega.
// Bodega solo puede crear/asignar dentro de su propia área.
function assignableRoles(user) {
  if (user.role === 'dueno') return TEAM_ROLES;
  if (user.role === 'administracion') return ['administracion', 'operador', 'bodega'];
  if (user.role === 'operador') return ['operador', 'administracion', 'bodega'];
  return [user.role];
}

// Un usuario puede ver/editar una tarea si es Gerencia, si supervisa el área de la tarea
// (solo Bodega se supervisa a sí misma), si la tarea se compartió con todo su rol (sin
// asignar a una persona concreta, mismo rol que la tarea), o si la tarea es propia (la
// creó él o se le asignó a él en concreto). No hay visibilidad automática entre
// Administración, Operador y Bodega más allá de esos dos mecanismos de compartir.
function canAccessTask(user, task) {
  if (user.role === 'dueno') return true;
  if (supervisedRoles(user).includes(task.role)) return true;
  if (task.assigned_to === null && task.role === user.role) return true;
  return task.created_by === user.id || task.assigned_to === user.id;
}

// Construye el WHERE de /api/tasks y /api/kpis según lo que el usuario puede ver:
// Gerencia ve todo (opcionalmente filtrado por rol). Cualquier otro ve Bodega completa si
// es de Bodega (rol supervisado), las propias (creadas o asignadas a él) y las que se
// comparten con todo su rol (sin asignar a nadie en concreto), opcionalmente acotado por
// el tab de rol.
function roleScope(user, roleParam) {
  if (user.role === 'dueno') {
    if (roleParam && TEAM_ROLES.includes(roleParam)) {
      return { clause: 'tasks.role = ?', params: [roleParam] };
    }
    return { clause: '1=1', params: [] };
  }

  const supervised = supervisedRoles(user);
  const parts = [];
  const params = [];
  if (supervised.length) {
    parts.push(`tasks.role IN (${supervised.map(() => '?').join(',')})`);
    params.push(...supervised);
  }
  parts.push('tasks.created_by = ?');
  params.push(user.id);
  parts.push('tasks.assigned_to = ?');
  params.push(user.id);
  // Tarea compartida con todo el rol (sin asignar a nadie en concreto): la ven todos los del rol.
  parts.push('(tasks.assigned_to IS NULL AND tasks.role = ?)');
  params.push(user.role);

  let clause = `(${parts.join(' OR ')})`;
  if (roleParam && TEAM_ROLES.includes(roleParam)) {
    clause += ' AND tasks.role = ?';
    params.push(roleParam);
  }
  return { clause, params };
}

// --- Auth ---
app.post('/api/login', loginLimiter, (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email y password requeridos' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase().trim());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }
  if (!user.active) return res.status(403).json({ error: 'Usuario inactivo, contacta al dueño' });
  res.json({ user: publicUser(user) });
});

// --- Lista liviana de usuarios activos, para asignar tareas (cualquier usuario autenticado) ---
app.get('/api/users/lite', requireUser, (req, res) => {
  const rows = db
    .prepare("SELECT id, name, role FROM users WHERE active = 1 AND role != 'dueno' ORDER BY name ASC")
    .all();
  res.json({ users: rows });
});

// --- Users (RBAC, solo dueño) ---
app.get('/api/users', requireUser, requireOwner, (req, res) => {
  const users = db.prepare('SELECT * FROM users ORDER BY created_at ASC').all();
  res.json({ users: users.map(publicUser) });
});

app.post('/api/users', requireUser, requireOwner, (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!name || !email || !password || !role) return res.status(400).json({ error: 'Todos los campos son requeridos' });
  if (!ALL_ROLES.includes(role)) return res.status(400).json({ error: 'Rol inválido' });
  if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });

  const normalizedEmail = String(email).toLowerCase().trim();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) return res.status(409).json({ error: 'Ya existe un usuario con ese email' });

  const info = db
    .prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(name.trim(), normalizedEmail, bcrypt.hashSync(password, 10), role);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ user: publicUser(user) });
});

app.patch('/api/users/:id', requireUser, requireOwner, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });

  const { name, role, active, password } = req.body || {};
  const isSelf = target.id === req.user.id;

  if (isSelf && (role !== undefined || active !== undefined)) {
    return res.status(400).json({ error: 'No puedes cambiar tu propio rol o estado' });
  }
  if (role !== undefined && !ALL_ROLES.includes(role)) {
    return res.status(400).json({ error: 'Rol inválido' });
  }
  if (password !== undefined && password.length > 0 && password.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  }

  const newName = name !== undefined ? String(name).trim() : target.name;
  const newRole = role !== undefined ? role : target.role;
  const newActive = active !== undefined ? (active ? 1 : 0) : target.active;
  const newHash = password ? bcrypt.hashSync(password, 10) : target.password_hash;

  db.prepare('UPDATE users SET name = ?, role = ?, active = ?, password_hash = ? WHERE id = ?').run(
    newName,
    newRole,
    newActive,
    newHash,
    target.id
  );

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(target.id);
  res.json({ user: publicUser(updated) });
});

app.delete('/api/users/:id', requireUser, requireOwner, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });

  db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
  res.status(204).end();
});

// --- Tasks ---
app.get('/api/tasks', requireUser, (req, res) => {
  const { role: roleParam, from, to } = req.query;
  const scope = roleScope(req.user, roleParam);
  let sql = `${TASK_SELECT} WHERE ${scope.clause}`;
  const params = [...scope.params];

  if (from) {
    sql += ` AND COALESCE(tasks.due_date, date(tasks.created_at)) >= ?`;
    params.push(from);
  }
  if (to) {
    sql += ` AND COALESCE(tasks.due_date, date(tasks.created_at)) <= ?`;
    params.push(to);
  }
  sql += ' ORDER BY tasks.created_at DESC';

  const tasks = db.prepare(sql).all(...params);
  res.json({ tasks });
});

app.post('/api/tasks', requireUser, (req, res) => {
  const user = req.user;
  const { title, description = '', notes = '', priority = 'media', due_date = null, assigned_to = null } =
    req.body || {};
  let role;

  if (!title || !String(title).trim()) return res.status(400).json({ error: 'El título es requerido' });

  if (assigned_to) {
    const assignee = db.prepare('SELECT * FROM users WHERE id = ?').get(assigned_to);
    if (!assignee || !assignee.active || !TEAM_ROLES.includes(assignee.role)) {
      return res.status(400).json({ error: 'Usuario asignado inválido' });
    }
    if (!assignableRoles(user).includes(assignee.role)) {
      return res.status(403).json({ error: 'No puedes asignar tareas a ese rol' });
    }
    role = assignee.role;
  } else {
    role = req.body.role || user.role;
    if (!assignableRoles(user).includes(role)) {
      return res.status(400).json({ error: 'Rol destino inválido' });
    }
  }

  const info = db
    .prepare(
      `INSERT INTO tasks (title, description, notes, role, priority, due_date, created_by, assigned_to)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(String(title).trim(), description, notes, role, priority, due_date || null, user.id, assigned_to || null);

  logHistory({
    taskId: info.lastInsertRowid,
    taskTitle: String(title).trim(),
    userId: user.id,
    role,
    action: 'created',
    toStatus: 'todo',
    note: 'Tarea creada',
  });

  const task = db.prepare(`${TASK_SELECT} WHERE tasks.id = ?`).get(info.lastInsertRowid);
  notifyTaskCreated({ task, actorId: user.id });

  io.emit('tasks:changed');
  io.emit('notifications:changed');
  res.status(201).json({ task });
});

app.patch('/api/tasks/:id', requireUser, (req, res) => {
  const user = req.user;
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Tarea no encontrada' });
  if (!canAccessTask(user, task)) return res.status(403).json({ error: 'Sin permiso sobre esta tarea' });

  const { title, description, notes, status, priority, role, due_date, assigned_to } = req.body || {};

  const newTitle = title !== undefined ? String(title).trim() : task.title;
  const newDescription = description !== undefined ? description : task.description;
  const newNotes = notes !== undefined ? notes : task.notes;
  const newStatus = status !== undefined ? status : task.status;
  const newPriority = priority !== undefined ? priority : task.priority;
  const newDueDate = due_date !== undefined ? due_date || null : task.due_date;
  let newRole = task.role;
  let newAssignedTo = task.assigned_to;

  if (assigned_to !== undefined) {
    if (assigned_to === null) {
      newAssignedTo = null;
      if (role !== undefined) {
        if (!assignableRoles(user).includes(role)) return res.status(403).json({ error: 'Rol destino inválido' });
        newRole = role;
      }
    } else {
      const assignee = db.prepare('SELECT * FROM users WHERE id = ?').get(assigned_to);
      if (!assignee || !assignee.active || !TEAM_ROLES.includes(assignee.role)) {
        return res.status(400).json({ error: 'Usuario asignado inválido' });
      }
      if (!assignableRoles(user).includes(assignee.role)) {
        return res.status(403).json({ error: 'No puedes asignar tareas a ese rol' });
      }
      newAssignedTo = assignee.id;
      newRole = assignee.role;
    }
  } else if (role !== undefined) {
    if (!assignableRoles(user).includes(role)) return res.status(403).json({ error: 'Rol destino inválido' });
    newRole = role;
    if (newAssignedTo) {
      const currentAssignee = db.prepare('SELECT role FROM users WHERE id = ?').get(newAssignedTo);
      if (!currentAssignee || currentAssignee.role !== newRole) newAssignedTo = null;
    }
  }

  if (newStatus !== undefined && !['todo', 'in_progress', 'done'].includes(newStatus)) {
    return res.status(400).json({ error: 'Estado inválido' });
  }

  db.prepare(
    `UPDATE tasks SET title = ?, description = ?, notes = ?, status = ?, priority = ?, role = ?, due_date = ?,
     assigned_to = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(newTitle, newDescription, newNotes, newStatus, newPriority, newRole, newDueDate, newAssignedTo, task.id);

  if (newStatus !== task.status) {
    logHistory({
      taskId: task.id,
      taskTitle: newTitle,
      userId: user.id,
      role: newRole,
      action: 'moved',
      fromStatus: task.status,
      toStatus: newStatus,
      note: `Movida de "${task.status}" a "${newStatus}"`,
    });
  } else {
    logHistory({
      taskId: task.id,
      taskTitle: newTitle,
      userId: user.id,
      role: newRole,
      action: 'updated',
      fromStatus: task.status,
      toStatus: newStatus,
      note: 'Detalles editados',
    });
  }

  const updated = db.prepare(`${TASK_SELECT} WHERE tasks.id = ?`).get(task.id);

  let notified = false;
  if (newStatus === 'done' && task.status !== 'done') {
    notifyTaskCompleted({ task: updated, actorId: user.id, actorName: user.name });
    notified = true;
  }

  io.emit('tasks:changed');
  if (notified) io.emit('notifications:changed');
  res.json({ task: updated });
});

app.delete('/api/tasks/:id', requireUser, (req, res) => {
  const user = req.user;
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Tarea no encontrada' });
  if (!canAccessTask(user, task)) return res.status(403).json({ error: 'Sin permiso sobre esta tarea' });

  const files = db.prepare('SELECT * FROM attachments WHERE task_id = ?').all(task.id);
  for (const f of files) {
    fs.rm(path.join(UPLOADS_DIR, f.stored_name), { force: true }, () => {});
  }
  db.prepare('DELETE FROM attachments WHERE task_id = ?').run(task.id);
  db.prepare('DELETE FROM task_messages WHERE task_id = ?').run(task.id);

  logHistory({
    taskId: task.id,
    taskTitle: task.title,
    userId: user.id,
    role: task.role,
    action: 'deleted',
    fromStatus: task.status,
    note: 'Tarea eliminada',
  });

  db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
  io.emit('tasks:changed');
  res.status(204).end();
});

// --- Attachments ---
// Extensiones permitidas para adjuntos: documentos, hojas de cálculo, imágenes y comprimidos.
// Se excluyen deliberadamente ejecutables/scripts (.exe, .sh, .js, .php, etc.).
const ALLOWED_EXTENSIONS = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.txt',
  '.csv',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.zip',
]);

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return cb(new Error(`Tipo de archivo no permitido: ${ext || 'sin extensión'}`));
    }
    cb(null, true);
  },
});

function loadTaskForAttachment(req, res, next) {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.taskId || req.params.id);
  if (!task) return res.status(404).json({ error: 'Tarea no encontrada' });
  if (!canAccessTask(req.user, task)) return res.status(403).json({ error: 'Sin permiso sobre esta tarea' });
  req.task = task;
  next();
}

app.get('/api/tasks/:taskId/attachments', requireUser, loadTaskForAttachment, (req, res) => {
  const rows = db
    .prepare(
      `SELECT attachments.*, COALESCE(users.name, 'Usuario eliminado') AS uploaded_by_name
       FROM attachments LEFT JOIN users ON users.id = attachments.uploaded_by
       WHERE task_id = ? ORDER BY created_at DESC`
    )
    .all(req.params.taskId);
  res.json({ attachments: rows });
});

app.post('/api/tasks/:taskId/attachments', requireUser, loadTaskForAttachment, upload.array('files', 5), (req, res) => {
  const inserted = [];
  const insert = db.prepare(
    `INSERT INTO attachments (task_id, original_name, stored_name, mime_type, size, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  for (const file of req.files || []) {
    const info = insert.run(req.task.id, file.originalname, file.filename, file.mimetype, file.size, req.user.id);
    inserted.push(db.prepare('SELECT * FROM attachments WHERE id = ?').get(info.lastInsertRowid));
  }
  io.emit('tasks:changed');
  res.status(201).json({ attachments: inserted });
});

app.get('/api/attachments/:id/download', requireUser, (req, res) => {
  const file = db.prepare('SELECT * FROM attachments WHERE id = ?').get(req.params.id);
  if (!file) return res.status(404).json({ error: 'Archivo no encontrado' });
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(file.task_id);
  if (!task || !canAccessTask(req.user, task)) return res.status(403).json({ error: 'Sin permiso' });

  const filePath = path.join(UPLOADS_DIR, file.stored_name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Archivo no encontrado en disco' });
  res.download(filePath, file.original_name);
});

app.delete('/api/attachments/:id', requireUser, (req, res) => {
  const file = db.prepare('SELECT * FROM attachments WHERE id = ?').get(req.params.id);
  if (!file) return res.status(404).json({ error: 'Archivo no encontrado' });
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(file.task_id);
  if (!task || !canAccessTask(req.user, task)) return res.status(403).json({ error: 'Sin permiso' });

  fs.rm(path.join(UPLOADS_DIR, file.stored_name), { force: true }, () => {});
  db.prepare('DELETE FROM attachments WHERE id = ?').run(file.id);
  io.emit('tasks:changed');
  res.status(204).end();
});

// --- Chat de tarea ---
app.get('/api/tasks/:taskId/messages', requireUser, loadTaskForAttachment, (req, res) => {
  const rows = db
    .prepare(
      `SELECT task_messages.*, COALESCE(users.name, 'Usuario eliminado') AS user_name
       FROM task_messages LEFT JOIN users ON users.id = task_messages.user_id
       WHERE task_id = ? ORDER BY created_at ASC`
    )
    .all(req.params.taskId);
  res.json({ messages: rows });
});

app.post('/api/tasks/:taskId/messages', requireUser, loadTaskForAttachment, (req, res) => {
  const { message } = req.body || {};
  if (!message || !String(message).trim()) return res.status(400).json({ error: 'El mensaje no puede estar vacío' });

  const text = String(message).trim().slice(0, 2000);
  const info = db
    .prepare('INSERT INTO task_messages (task_id, user_id, message) VALUES (?, ?, ?)')
    .run(req.task.id, req.user.id, text);

  const created = db
    .prepare(
      `SELECT task_messages.*, COALESCE(users.name, 'Usuario eliminado') AS user_name
       FROM task_messages LEFT JOIN users ON users.id = task_messages.user_id
       WHERE task_messages.id = ?`
    )
    .get(info.lastInsertRowid);

  notifyNewMessage({ task: req.task, actorId: req.user.id, actorName: req.user.name, messageText: text });

  io.emit('tasks:changed');
  io.emit('notifications:changed');
  io.emit('task-message', { taskId: req.task.id });
  res.status(201).json({ message: created });
});

// --- Historial diario ---
app.get('/api/history', requireUser, (req, res) => {
  const { role: roleParam, from, to } = req.query;
  const user = req.user;

  let scope;
  if (user.role === 'dueno') {
    scope =
      roleParam && TEAM_ROLES.includes(roleParam)
        ? { clause: 'task_history.role = ?', params: [roleParam] }
        : { clause: '1=1', params: [] };
  } else {
    const supervised = supervisedRoles(user);
    const parts = [];
    const params = [];
    if (supervised.length) {
      parts.push(`task_history.role IN (${supervised.map(() => '?').join(',')})`);
      params.push(...supervised);
    }
    parts.push('task_history.user_id = ?');
    params.push(user.id);
    parts.push('tasks.created_by = ?');
    params.push(user.id);
    parts.push('tasks.assigned_to = ?');
    params.push(user.id);
    parts.push('(tasks.assigned_to IS NULL AND tasks.role = ?)');
    params.push(user.role);

    let clause = `(${parts.join(' OR ')})`;
    if (roleParam && TEAM_ROLES.includes(roleParam)) {
      clause += ' AND task_history.role = ?';
      params.push(roleParam);
    }
    scope = { clause, params };
  }

  let sql = `
    SELECT task_history.*, COALESCE(users.name, 'Usuario eliminado') AS user_name
    FROM task_history
    LEFT JOIN users ON users.id = task_history.user_id
    LEFT JOIN tasks ON tasks.id = task_history.task_id
    WHERE ${scope.clause}
  `;
  const params = [...scope.params];

  if (from) {
    sql += ' AND date(task_history.created_at) >= ?';
    params.push(from);
  }
  if (to) {
    sql += ' AND date(task_history.created_at) <= ?';
    params.push(to);
  }
  sql += ' ORDER BY task_history.created_at DESC LIMIT 500';

  const rows = db.prepare(sql).all(...params);
  res.json({ history: rows });
});

// --- KPIs / dashboard ---
app.get('/api/kpis', requireUser, (req, res) => {
  const { role: roleParam, from, to } = req.query;
  const scope = roleScope(req.user, roleParam);

  const rangeTo = to || today();
  const rangeFrom = from || new Date(Date.now() - 13 * 86400000).toISOString().slice(0, 10);

  const statusRows = db
    .prepare(`SELECT status, COUNT(*) AS n FROM tasks WHERE ${scope.clause} GROUP BY status`)
    .all(...scope.params);
  const priorityRows = db
    .prepare(`SELECT priority, COUNT(*) AS n FROM tasks WHERE ${scope.clause} GROUP BY priority`)
    .all(...scope.params);
  const overdue = db
    .prepare(
      `SELECT COUNT(*) AS n FROM tasks WHERE ${scope.clause} AND due_date IS NOT NULL AND due_date < date('now') AND status != 'done'`
    )
    .get(...scope.params).n;

  const createdRows = db
    .prepare(
      `SELECT date(created_at) AS d, COUNT(*) AS n FROM tasks
       WHERE ${scope.clause} AND date(created_at) BETWEEN ? AND ? GROUP BY d`
    )
    .all(...scope.params, rangeFrom, rangeTo);
  const completedRows = db
    .prepare(
      `SELECT date(updated_at) AS d, COUNT(*) AS n FROM tasks
       WHERE ${scope.clause} AND status = 'done' AND date(updated_at) BETWEEN ? AND ? GROUP BY d`
    )
    .all(...scope.params, rangeFrom, rangeTo);

  const createdMap = Object.fromEntries(createdRows.map((r) => [r.d, r.n]));
  const completedMap = Object.fromEntries(completedRows.map((r) => [r.d, r.n]));

  const daily = [];
  let cursor = new Date(`${rangeFrom}T00:00:00`);
  const end = new Date(`${rangeTo}T00:00:00`);
  while (cursor <= end) {
    const d = cursor.toISOString().slice(0, 10);
    daily.push({ date: d, created: createdMap[d] || 0, completed: completedMap[d] || 0 });
    cursor.setDate(cursor.getDate() + 1);
  }

  const totals = { todo: 0, in_progress: 0, done: 0 };
  for (const r of statusRows) totals[r.status] = r.n;
  const total = totals.todo + totals.in_progress + totals.done;
  const completionRate = total > 0 ? Math.round((totals.done / total) * 100) : 0;

  const byPriority = { baja: 0, media: 0, alta: 0 };
  for (const r of priorityRows) byPriority[r.priority] = r.n;

  res.json({
    range: { from: rangeFrom, to: rangeTo },
    totals: { ...totals, total, overdue },
    completionRate,
    byPriority,
    daily,
  });
});

// --- Notificaciones ---
app.get('/api/notifications', requireUser, (req, res) => {
  const notifications = db
    .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100')
    .all(req.user.id);
  const unreadCount = db
    .prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0')
    .get(req.user.id).n;
  res.json({ notifications, unreadCount });
});

app.patch('/api/notifications/:id/read', requireUser, (req, res) => {
  const notif = db.prepare('SELECT * FROM notifications WHERE id = ?').get(req.params.id);
  if (!notif || notif.user_id !== req.user.id) return res.status(404).json({ error: 'Notificación no encontrada' });
  db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(notif.id);
  res.status(204).end();
});

app.post('/api/notifications/read-all', requireUser, (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0').run(req.user.id);
  res.status(204).end();
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

// --- Sirve el frontend (build de Vite) desde este mismo backend ---
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
}

// --- Manejo de errores (multer: tipo de archivo no permitido, tamaño excedido, etc.) ---
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || (err && err.message?.startsWith('Tipo de archivo no permitido'))) {
    return res.status(400).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

io.on('connection', () => {});

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
