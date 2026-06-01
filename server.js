const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const SESSION_SECRET = process.env.SESSION_SECRET || require('crypto').randomBytes(32).toString('hex');

// ── Database setup ──────────────────────────────────────────────────────────
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'kims.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS khidmatguzars (
    id        TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    role      TEXT DEFAULT '',
    its_number TEXT DEFAULT '',
    phone     TEXT DEFAULT '',
    email     TEXT DEFAULT '',
    is_admin  INTEGER DEFAULT 0,
    photo     TEXT DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS roles (
    id    TEXT PRIMARY KEY,
    name  TEXT NOT NULL UNIQUE,
    color TEXT DEFAULT 'b-gray',
    desc  TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS availability (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    date_index INTEGER NOT NULL,
    meal       TEXT NOT NULL CHECK(meal IN ('breakfast','lunch','dinner')),
    khidmat_id TEXT NOT NULL,
    name       TEXT NOT NULL,
    role       TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    priority   TEXT DEFAULT 'med',
    date_index TEXT DEFAULT '',
    meal       TEXT DEFAULT '',
    notes      TEXT DEFAULT '',
    done       INTEGER DEFAULT 0,
    assigned   TEXT DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS issues (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    description TEXT DEFAULT '',
    reporter   TEXT DEFAULT '',
    category   TEXT DEFAULT 'other',
    severity   TEXT DEFAULT 'med',
    status     TEXT DEFAULT 'open',
    photos     TEXT DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS app_config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Seed admin password
const existing = db.prepare("SELECT value FROM app_config WHERE key='admin_pw_hash'").get();
if (!existing) {
  const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  db.prepare("INSERT INTO app_config (key,value) VALUES ('admin_pw_hash',?)").run(hash);
  console.log(`[KIMS] Admin password initialised. Default: ${ADMIN_PASSWORD}`);
}

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 12 * 60 * 60 * 1000, sameSite: 'lax' }
}));
app.use(express.static(path.join(__dirname, 'public')));

function requireAdmin(req, res, next) {
  if (req.session?.isAdmin) return next();
  res.status(401).json({ error: 'Admin access required' });
}

function requireSession(req, res, next) {
  if (req.session?.userId) return next();
  res.status(401).json({ error: 'Not authenticated' });
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ── AUTH ─────────────────────────────────────────────────────────────────────

// Login with ITS number (or admin password)
app.post('/api/auth/login', (req, res) => {
  const { its_number } = req.body;
  if (!its_number) return res.status(400).json({ error: 'ITS number required' });

  // Check admin password bypass
  const pwRow = db.prepare("SELECT value FROM app_config WHERE key='admin_pw_hash'").get();
  if (pwRow && bcrypt.compareSync(its_number, pwRow.value)) {
    req.session.userId = '__admin__';
    req.session.isAdmin = true;
    return res.json({ success: true, user: { id: '__admin__', name: 'Admin', role: 'Administrator', is_admin: true, isAdminLogin: true } });
  }

  // Find khidmatguzar by ITS number
  const k = db.prepare('SELECT * FROM khidmatguzars WHERE its_number = ?').get(its_number.trim());
  if (!k) {
    const total = db.prepare('SELECT COUNT(*) as n FROM khidmatguzars').get().n;
    const msg = total === 0
      ? 'No khidmatguzars have been registered yet. Please contact admin.'
      : 'Login failed. Your ITS number was not found. Please contact admin.';
    return res.status(401).json({ error: msg });
  }

  req.session.userId = k.id;
  req.session.isAdmin = k.is_admin === 1;
  res.json({ success: true, user: { ...k, is_admin: k.is_admin === 1 } });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session?.userId) return res.json({ user: null });
  if (req.session.userId === '__admin__') {
    return res.json({ user: { id: '__admin__', name: 'Admin', role: 'Administrator', is_admin: true, isAdminLogin: true } });
  }
  const k = db.prepare('SELECT * FROM khidmatguzars WHERE id = ?').get(req.session.userId);
  if (!k) return res.json({ user: null });
  res.json({ user: { ...k, is_admin: k.is_admin === 1 } });
});

// Change admin password
app.post('/api/auth/change-password', requireAdmin, (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Min. 6 characters' });
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare("UPDATE app_config SET value=? WHERE key='admin_pw_hash'").run(hash);
  res.json({ success: true });
});

// ── KHIDMATGUZARS ────────────────────────────────────────────────────────────

app.get('/api/khidmatguzars', requireSession, (req, res) => {
  const rows = db.prepare('SELECT * FROM khidmatguzars ORDER BY name ASC').all();
  res.json(rows.map(k => ({ ...k, is_admin: k.is_admin === 1 })));
});

app.post('/api/khidmatguzars', requireAdmin, (req, res) => {
  const { id, name, role, its_number, phone, email, is_admin, photo } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  const newId = id || uid();
  db.prepare('INSERT OR REPLACE INTO khidmatguzars (id,name,role,its_number,phone,email,is_admin,photo) VALUES (?,?,?,?,?,?,?,?)')
    .run(newId, name.trim(), role||'', its_number||'', phone||'', email||'', is_admin?1:0, photo||null);
  res.json({ success: true, id: newId });
});

app.put('/api/khidmatguzars/:id', requireAdmin, (req, res) => {
  const { name, role, its_number, phone, email, is_admin, photo } = req.body;
  db.prepare('UPDATE khidmatguzars SET name=?,role=?,its_number=?,phone=?,email=?,is_admin=?,photo=? WHERE id=?')
    .run(name||'', role||'', its_number||'', phone||'', email||'', is_admin?1:0, photo||null, req.params.id);
  res.json({ success: true });
});

app.delete('/api/khidmatguzars/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM khidmatguzars WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// Bulk import
app.post('/api/khidmatguzars/import', requireAdmin, (req, res) => {
  const { khidmatguzars, replace } = req.body;
  if (!Array.isArray(khidmatguzars)) return res.status(400).json({ error: 'Invalid data' });
  const stmt = db.prepare('INSERT OR IGNORE INTO khidmatguzars (id,name,role,its_number,phone,email,is_admin,photo) VALUES (?,?,?,?,?,?,?,?)');
  const run = db.transaction(rows => {
    if (replace) db.prepare('DELETE FROM khidmatguzars').run();
    let added = 0;
    rows.forEach(k => {
      const name = (k.name||'').trim();
      if (!name) return;
      stmt.run(k.id||uid(), name, k.role||'', k.its_number||'', k.phone||'', k.email||'', k.is_admin?1:0, k.photo||null);
      added++;
    });
    return added;
  });
  const count = run(khidmatguzars);
  res.json({ success: true, count });
});

// ── ROLES ────────────────────────────────────────────────────────────────────

app.get('/api/roles', requireSession, (req, res) => {
  res.json(db.prepare('SELECT * FROM roles ORDER BY name ASC').all());
});

app.post('/api/roles', requireAdmin, (req, res) => {
  const { name, color, desc } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  try {
    const id = uid();
    db.prepare('INSERT INTO roles (id,name,color,desc) VALUES (?,?,?,?)').run(id, name.trim(), color||'b-gray', desc||'');
    res.json({ success: true, id });
  } catch(e) { res.status(400).json({ error: 'Role already exists' }); }
});

app.delete('/api/roles/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM roles WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ── AVAILABILITY ─────────────────────────────────────────────────────────────

app.get('/api/availability', requireSession, (req, res) => {
  const rows = db.prepare('SELECT * FROM availability ORDER BY date_index, meal, created_at').all();
  const grouped = {};
  rows.forEach(r => {
    const key = `${r.date_index}_${r.meal}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push({ id: r.id, khidmat_id: r.khidmat_id, name: r.name, role: r.role });
  });
  res.json(grouped);
});

app.post('/api/availability', requireSession, (req, res) => {
  const { khidmat_id, name, role, dateIndex, meals } = req.body;
  if (!name || dateIndex === undefined || !Array.isArray(meals) || !meals.length)
    return res.status(400).json({ error: 'Missing fields' });

  // Non-admins can only submit for themselves
  if (!req.session.isAdmin && req.session.userId !== '__admin__' && req.session.userId !== khidmat_id)
    return res.status(403).json({ error: 'You can only submit availability for yourself' });

  const validMeals = ['breakfast','lunch','dinner'];
  const stmt = db.prepare('INSERT INTO availability (date_index,meal,khidmat_id,name,role) VALUES (?,?,?,?,?)');
  const check = db.prepare('SELECT id FROM availability WHERE date_index=? AND meal=? AND khidmat_id=?');
  const added = [];
  meals.forEach(meal => {
    if (!validMeals.includes(meal)) return;
    if (!check.get(dateIndex, meal, khidmat_id||name)) {
      const info = stmt.run(dateIndex, meal, khidmat_id||uid(), name, role||'');
      added.push({ id: info.lastInsertRowid, meal });
    }
  });
  res.json({ success: true, added });
});

app.delete('/api/availability/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM availability WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ── TASKS ─────────────────────────────────────────────────────────────────────

app.get('/api/tasks', requireSession, (req, res) => {
  const rows = db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all();
  res.json(rows.map(t => ({ ...t, assigned: JSON.parse(t.assigned||'[]'), done: t.done===1 })));
});

app.post('/api/tasks', requireAdmin, (req, res) => {
  const { id, title, priority, date_index, meal, notes, assigned } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title required' });
  const newId = id || uid();
  db.prepare('INSERT INTO tasks (id,title,priority,date_index,meal,notes,assigned) VALUES (?,?,?,?,?,?,?)')
    .run(newId, title.trim(), priority||'med', date_index||'', meal||'', notes||'', JSON.stringify(assigned||[]));
  res.json({ success: true, id: newId });
});

app.put('/api/tasks/:id', requireSession, (req, res) => {
  const { done, title, priority, date_index, meal, notes, assigned } = req.body;
  const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE tasks SET done=?,title=?,priority=?,date_index=?,meal=?,notes=?,assigned=? WHERE id=?')
    .run(done?1:0, title||task.title, priority||task.priority, date_index??task.date_index, meal??task.meal, notes??task.notes, JSON.stringify(assigned||JSON.parse(task.assigned||'[]')), req.params.id);
  res.json({ success: true });
});

app.delete('/api/tasks/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM tasks WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ── ISSUES ────────────────────────────────────────────────────────────────────

app.get('/api/issues', requireSession, (req, res) => {
  const rows = db.prepare('SELECT * FROM issues ORDER BY created_at DESC').all();
  res.json(rows.map(i => ({ ...i, photos: JSON.parse(i.photos||'[]') })));
});

app.post('/api/issues', requireSession, (req, res) => {
  const { title, description, reporter, category, severity, photos } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title required' });
  const id = uid();
  db.prepare('INSERT INTO issues (id,title,description,reporter,category,severity,photos) VALUES (?,?,?,?,?,?,?)')
    .run(id, title.trim(), description||'', reporter||'', category||'other', severity||'med', JSON.stringify(photos||[]));
  res.json({ success: true, id });
});

app.put('/api/issues/:id/status', requireAdmin, (req, res) => {
  const { status } = req.body;
  db.prepare('UPDATE issues SET status=? WHERE id=?').run(status, req.params.id);
  res.json({ success: true });
});

app.delete('/api/issues/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM issues WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ── Catch-all → SPA ──────────────────────────────────────────────────────────
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`[KIMS] Running on http://localhost:${PORT}`));
