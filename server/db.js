import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR || __dirname;
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'data.db'));

db.pragma('journal_mode = WAL');
// Las relaciones se limpian a mano en el código (ver borrado de tareas/usuarios);
// se desactiva para poder recrear tablas en migraciones sin romper referencias.
db.pragma('foreign_keys = OFF');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('dueno', 'administracion', 'operador', 'bodega')),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    role TEXT NOT NULL CHECK (role IN ('administracion', 'operador', 'bodega')),
    status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done')),
    priority TEXT NOT NULL DEFAULT 'media' CHECK (priority IN ('baja', 'media', 'alta')),
    due_date TEXT,
    created_by INTEGER NOT NULL REFERENCES users(id),
    assigned_to INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS task_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    user_id INTEGER REFERENCES users(id),
    role TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('created', 'updated', 'moved', 'deleted')),
    from_status TEXT,
    to_status TEXT,
    note TEXT DEFAULT '',
    task_title TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    mime_type TEXT,
    size INTEGER,
    uploaded_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS task_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id),
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    type TEXT NOT NULL CHECK (type IN ('assigned', 'completed', 'message')),
    task_id INTEGER NOT NULL,
    task_title TEXT NOT NULL,
    message TEXT NOT NULL,
    read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const taskColumns = db.prepare('PRAGMA table_info(tasks)').all().map((c) => c.name);
if (!taskColumns.includes('assigned_to')) {
  db.exec('ALTER TABLE tasks ADD COLUMN assigned_to INTEGER REFERENCES users(id)');
}

// Agrega el rol 'bodega' a las restricciones CHECK de tablas ya existentes
// (SQLite no soporta ALTER de un CHECK, así que se recrea la tabla preservando los datos).
function widenRoleCheck(tableName, createTableSql, columns) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName);
  if (row && !row.sql.includes("'bodega'")) {
    const cols = columns.join(', ');
    db.exec(`
      ALTER TABLE ${tableName} RENAME TO ${tableName}_old;
      ${createTableSql}
      INSERT INTO ${tableName} (${cols}) SELECT ${cols} FROM ${tableName}_old;
      DROP TABLE ${tableName}_old;
    `);
  }
}

widenRoleCheck(
  'users',
  `CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('dueno', 'administracion', 'operador', 'bodega')),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`,
  ['id', 'name', 'email', 'password_hash', 'role', 'active', 'created_at']
);

widenRoleCheck(
  'tasks',
  `CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    role TEXT NOT NULL CHECK (role IN ('administracion', 'operador', 'bodega')),
    status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done')),
    priority TEXT NOT NULL DEFAULT 'media' CHECK (priority IN ('baja', 'media', 'alta')),
    due_date TEXT,
    created_by INTEGER NOT NULL REFERENCES users(id),
    assigned_to INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`,
  [
    'id',
    'title',
    'description',
    'notes',
    'role',
    'status',
    'priority',
    'due_date',
    'created_by',
    'assigned_to',
    'created_at',
    'updated_at',
  ]
);

const notificationsTableSql = db
  .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'notifications'")
  .get();
if (notificationsTableSql && !notificationsTableSql.sql.includes("'message'")) {
  db.exec(`
    ALTER TABLE notifications RENAME TO notifications_old;
    CREATE TABLE notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      type TEXT NOT NULL CHECK (type IN ('assigned', 'completed', 'message')),
      task_id INTEGER NOT NULL,
      task_title TEXT NOT NULL,
      message TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO notifications (id, user_id, type, task_id, task_title, message, read, created_at)
      SELECT id, user_id, type, task_id, task_title, message, read, created_at FROM notifications_old;
    DROP TABLE notifications_old;
  `);
}

const seedUsers = [
  { name: 'Dueño', email: 'dueno@empresa.com', password: 'dueno123', role: 'dueno' },
  { name: 'Administración', email: 'admin@empresa.com', password: 'admin123', role: 'administracion' },
  { name: 'Operador', email: 'operador@empresa.com', password: 'operador123', role: 'operador' },
  { name: 'Bodega', email: 'bodega@empresa.com', password: 'bodega123', role: 'bodega' },
];

const insertUser = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)');
const countUsers = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;

if (countUsers === 0) {
  const { OWNER_EMAIL, OWNER_PASSWORD, OWNER_NAME } = process.env;
  if (OWNER_EMAIL && OWNER_PASSWORD) {
    insertUser.run(OWNER_NAME || 'Dueño', OWNER_EMAIL.toLowerCase().trim(), bcrypt.hashSync(OWNER_PASSWORD, 10), 'dueno');
    console.log(`Cuenta de dueño creada desde variables de entorno: ${OWNER_EMAIL}`);
  } else if (process.env.SEED_DEMO_USERS !== 'false') {
    for (const u of seedUsers) {
      insertUser.run(u.name, u.email, bcrypt.hashSync(u.password, 10), u.role);
    }
    console.warn(
      '\n[AVISO DE SEGURIDAD] Se crearon usuarios demo con contraseñas conocidas ' +
        '(dueno@empresa.com/dueno123, admin@empresa.com/admin123, operador@empresa.com/operador123, ' +
        'bodega@empresa.com/bodega123).\n' +
        'Cámbialas de inmediato desde "Usuarios", o define OWNER_EMAIL/OWNER_PASSWORD ' +
        'antes del primer arranque para crear directamente la cuenta real del dueño.\n'
    );
  } else {
    console.warn(
      '\n[AVISO] No hay usuarios en la base, SEED_DEMO_USERS=false y no se definió OWNER_EMAIL/OWNER_PASSWORD: ' +
        'nadie podrá iniciar sesión.\n'
    );
  }
}

export default db;
