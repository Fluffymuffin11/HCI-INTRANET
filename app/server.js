const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const multer = require("multer");
const fs = require("fs");
const nodemailer = require("nodemailer");
const rateLimit = require("express-rate-limit");

// ── Email transport ───────────────────────────────────────────────────────────
// TODO: Fill in SMTP credentials when Exchange server info is available.
// Uncomment and update the block below, then remove the stub transporter.
//
// const mailer = nodemailer.createTransport({
//   host: "mail.<company-domain>",   // Exchange SMTP hostname
//   port: 587,                         // 587 (STARTTLS) or 465 (SSL)
//   secure: false,                     // true for port 465
//   auth: { user: "no-reply@<company-domain>", pass: "PASSWORD" },
// });
//
// For open relay from the VM IP (no auth), use:
// const mailer = nodemailer.createTransport({
//   host: "mail.<company-domain>",
//   port: 25,
//   secure: false,
// });

const mailer = nodemailer.createTransport({ jsonTransport: true }); // stub — logs only

async function sendMail(opts) {
  try {
    const info = await mailer.sendMail(opts);
    console.log("[email stub]", opts.subject, "→", opts.to);
    return { ok: true };
  } catch (err) {
    console.error("[email error]", err.message);
    return { ok: false, error: err.message };
  }
}

const app = express();
const db = new Database("/data/intranet.db");

// Trust the nginx reverse proxy so req.ip and secure cookies work correctly
app.set("trust proxy", 1);

app.use(express.json());

app.use("/files", express.static("/uploads"));

const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  console.error("FATAL: SESSION_SECRET environment variable is not set. Refusing to start.");
  process.exit(1);
}

app.use(
  session({
    store: new SQLiteStore({
      db: "sessions.db",
      dir: "/data"
    }),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 1000 * 60 * 60 * 8
    }
  })
);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { error: "Too many login attempts. Please wait 15 minutes and try again." },
  standardHeaders: true,
  legacyHeaders: false,
});

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'employee',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  photo_filename TEXT,
  author_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by INTEGER,
  reviewed_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  uploaded_by INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  department TEXT NOT NULL,
  week_of TEXT,
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  uploaded_by INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS spotlight (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  photo_filename TEXT,
  updated_by INTEGER,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS directory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  title TEXT,
  department TEXT,
  phone TEXT,
  email TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  username TEXT,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS signup_sheets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  event_type TEXT NOT NULL DEFAULT 'single',
  event_date TEXT,
  end_date TEXT,
  recurrence_pattern TEXT,
  recurrence_days TEXT,
  recurrence_end_date TEXT,
  deadline TEXT,
  location TEXT,
  max_slots INTEGER NOT NULL DEFAULT 0,
  allow_waitlist INTEGER NOT NULL DEFAULT 0,
  is_open INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_by_name TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS signup_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sheet_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  department TEXT,
  notes TEXT,
  is_waitlist INTEGER NOT NULL DEFAULT 0,
  signed_up_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sheet_id) REFERENCES signup_sheets(id) ON DELETE CASCADE
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS it_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_type TEXT NOT NULL,
  name TEXT NOT NULL,
  department TEXT,
  phone TEXT,
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  equipment_type TEXT,
  equipment_detail TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  assigned_to TEXT,
  resolution TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS spotlight_nominations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nominee_name TEXT NOT NULL,
  nominee_title TEXT,
  nominee_department TEXT,
  reason TEXT NOT NULL,
  submitted_by TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

// Migrate existing signup_sheets table if columns are missing
["event_type TEXT NOT NULL DEFAULT 'single'", "end_date TEXT", "recurrence_pattern TEXT", "recurrence_days TEXT", "recurrence_end_date TEXT"].forEach(col => {
  try { db.prepare(`ALTER TABLE signup_sheets ADD COLUMN ${col}`).run(); } catch (_) {}
});

// Add department to users if missing (manager scoping)
try { db.prepare("ALTER TABLE users ADD COLUMN department TEXT").run(); } catch (_) {}

// Add video_url to posts and resources
try { db.prepare("ALTER TABLE posts ADD COLUMN video_url TEXT").run(); } catch (_) {}
try { db.prepare("ALTER TABLE resources ADD COLUMN video_url TEXT").run(); } catch (_) {}

const adminExists = db
  .prepare("SELECT id FROM users WHERE username = ?")
  .get("admin");

if (!adminExists) {

  const seedPassword = process.env.INITIAL_ADMIN_PASSWORD;
  if (!seedPassword) {
    console.error("FATAL: INITIAL_ADMIN_PASSWORD not set — cannot seed admin user. Set it once in .env, then remove after first boot.");
    process.exit(1);
  }
  const hash = bcrypt.hashSync(seedPassword, 10);

  db.prepare(`
    INSERT INTO users (
      username,
      password_hash,
      role
    ) VALUES (?, ?, ?)
  `).run(
    "admin",
    hash,
    "superadmin"
  );

  console.log("Created default admin account");
}

function requireLogin(req, res, next) {

  if (!req.session.user) {
    return res.status(401).json({
      error: "Not logged in"
    });
  }

  next();
}

function requireAdmin(req, res, next) {
  if (
    !req.session.user ||
    !["manager", "admin", "superadmin"].includes(req.session.user.role)
  ) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

function requireSuperAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== "superadmin") {
    return res.status(403).json({ error: "Superadmin access required" });
  }
  next();
}

function requireApprover(req, res, next) {
  if (
    !req.session.user ||
    !["admin", "superadmin"].includes(req.session.user.role)
  ) {
    return res.status(403).json({ error: "Approver access required" });
  }
  next();
}

function audit(req, action, detail) {
  try {
    const u = req.session?.user;
    db.prepare(
      "INSERT INTO audit_log (user_id, username, action, detail) VALUES (?, ?, ?, ?)"
    ).run(u?.id || null, u?.username || "system", action, detail || null);
  } catch (_) {}
}

try {
  db.prepare("ALTER TABLE posts ADD COLUMN photo_filename TEXT").run();
} catch (_) {}

const defaultSettings = {
  site_name:       "Heart Center",
  site_subtitle:   "Home Page",
  hero_title:      "Welcome to the Heart Center Staff Portal",
  hero_subtitle:   "Access company announcements, weekly schedules, policies, staff resources, HR documents, and internal support tools from one central location.",
  active_theme:    "default",
  banner_enabled:  "0",
  banner_text:     "",
  banner_color:    "info",
};
const setSetting = db.prepare(
  "INSERT OR IGNORE INTO site_settings (key, value) VALUES (?, ?)"
);
Object.entries(defaultSettings).forEach(([k, v]) => setSetting.run(k, v));

const dirEmpty = db.prepare("SELECT COUNT(*) as n FROM directory").get();
if (dirEmpty.n === 0) {
  const insertContact = db.prepare(`
    INSERT INTO directory (name, title, department, phone, email)
    VALUES (?, ?, ?, ?, ?)
  `);
  const seedContacts = db.transaction(() => {
    [
      ["John Test",        "Cardiovascular Technician",       "Cath Lab",              "Ext. 1001", "john.test@heartcenter.local"],
      ["Jane Smith",       "Patient Services Coordinator",    "Administration",        "Ext. 1002", "jane.smith@heartcenter.local"],
      ["Mike Johnson",     "IT Systems Administrator",        "Information Technology","Ext. 1200", "mike.johnson@heartcenter.local"],
      ["Sarah Williams",   "Registered Nurse",                "Cardiology",            "Ext. 1101", "sarah.williams@heartcenter.local"],
      ["David Brown",      "Clinical Manager",                "Cardiology",            "Ext. 1100", "david.brown@heartcenter.local"],
      ["Lisa Garcia",      "HR Generalist",                   "Human Resources",       "Ext. 1300", "lisa.garcia@heartcenter.local"],
      ["Robert Martinez",  "Biomedical Equipment Tech",       "Biomed",                "Ext. 1400", "robert.martinez@heartcenter.local"],
      ["Karen Davis",      "Medical Receptionist",            "Front Desk",            "Ext. 1000", "karen.davis@heartcenter.local"],
      ["James Wilson",     "Cardiovascular Sonographer",      "Echo Lab",              "Ext. 1050", "james.wilson@heartcenter.local"],
      ["Emily Taylor",     "Scheduling Coordinator",          "Administration",        "Ext. 1003", "emily.taylor@heartcenter.local"],
      ["Tom Anderson",     "Network Administrator",           "Information Technology","Ext. 1201", "tom.anderson@heartcenter.local"],
      ["Nancy Thomas",     "Benefits Coordinator",            "Human Resources",       "Ext. 1301", "nancy.thomas@heartcenter.local"],
    ].forEach(row => insertContact.run(...row));
  });
  seedContacts();
  console.log("Seeded directory with test contacts");
}

fs.mkdirSync("/uploads/posts",     { recursive: true });
fs.mkdirSync("/uploads/resources", { recursive: true });
fs.mkdirSync("/uploads/schedules", { recursive: true });
fs.mkdirSync("/uploads/spotlight", { recursive: true });

const storage = multer.diskStorage({

destination: function(req, file, cb) {

  if (req.path.includes("schedule")) {
    cb(null, "/uploads/schedules");
  } else if (req.path.includes("spotlight")) {
    cb(null, "/uploads/spotlight");
  } else if (req.path.includes("post") || req.path === "/posts") {
    cb(null, "/uploads/posts");
  } else {
    cb(null, "/uploads/resources");
  }
},

  filename: function(req, file, cb) {

    const safeName =
      Date.now() +
      "-" +
      file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");

    cb(null, safeName);
  }
});

const upload = multer({ storage });

app.get("/health", (req, res) => {

  res.json({
    status: "ok",
    message: "Backend running"
  });
});

app.post("/auth/login", loginLimiter, (req, res) => {

  const { username, password } = req.body;

  const user = db
    .prepare("SELECT * FROM users WHERE username = ?")
    .get(username);

  if (
    !user ||
    !bcrypt.compareSync(password, user.password_hash)
  ) {
    return res.status(401).json({
      error: "Invalid credentials"
    });
  }

  req.session.user = {
    id: user.id,
    username: user.username,
    role: user.role,
    department: user.department || null,
  };

  audit(req, "login", `${user.username} signed in`);

  res.json({
    message: "Logged in",
    user: req.session.user
  });
});

app.post("/auth/logout", (req, res) => {

  req.session.destroy(() => {

    res.json({
      message: "Logged out"
    });
  });
});

app.get("/auth/me", (req, res) => {

  res.json({
    user: req.session.user || null
  });
});

/* PUBLIC POSTS */

app.get("/posts", (req, res) => {

  const posts = db.prepare(`
    SELECT
      posts.id,
      posts.title,
      posts.content,
      posts.photo_filename,
      posts.video_url,
      posts.created_at,
      users.username AS author
    FROM posts
    LEFT JOIN users
      ON posts.author_id = users.id
    WHERE posts.status = 'approved'
    ORDER BY posts.created_at DESC
  `).all();

  res.json(posts.map(p => ({
    ...p,
    photo_url: p.photo_filename ? `/api/files/posts/${p.photo_filename}` : null,
  })));
});

/* CREATE POST */

app.post("/posts", requireAdmin, upload.single("photo"), (req, res) => {

  const { title, content, video_url } = req.body;

  if (!title || !content) {
    return res.status(400).json({ error: "Title and content are required" });
  }

  const photoFilename = req.file ? req.file.filename : null;

  const result = db.prepare(`
    INSERT INTO posts (
      title,
      content,
      photo_filename,
      video_url,
      author_id,
      status
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    title,
    content,
    photoFilename,
    video_url?.trim() || null,
    req.session.user.id,
    "pending"
  );

  res.json({
    message: "Post submitted for approval",
    id: result.lastInsertRowid
  });
});

/* PENDING POSTS */

app.get("/admin/posts/pending", requireAdmin, (req, res) => {

  const posts = db.prepare(`
    SELECT
      posts.id,
      posts.title,
      posts.content,
      posts.photo_filename,
      posts.video_url,
      posts.status,
      posts.created_at,
      users.username AS author
    FROM posts
    LEFT JOIN users
      ON posts.author_id = users.id
    WHERE posts.status = 'pending'
    ORDER BY posts.created_at DESC
  `).all();

  res.json(posts.map(p => ({
    ...p,
    photo_url: p.photo_filename ? `/api/files/posts/${p.photo_filename}` : null,
  })));
});

/* APPROVE POST */

app.post("/admin/posts/:id/approve", requireApprover, (req, res) => {
  const post = db.prepare("SELECT title FROM posts WHERE id = ?").get(req.params.id);
  db.prepare(`
    UPDATE posts SET status = 'approved', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(req.session.user.id, req.params.id);
  audit(req, "post_approved", post?.title);
  res.json({ message: "Post approved" });
});

/* REJECT POST */

app.post("/admin/posts/:id/reject", requireApprover, (req, res) => {
  const post = db.prepare("SELECT title FROM posts WHERE id = ?").get(req.params.id);
  db.prepare(`
    UPDATE posts SET status = 'rejected', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(req.session.user.id, req.params.id);
  audit(req, "post_rejected", post?.title);
  res.json({ message: "Post rejected" });
});
/* DELETE POST */

app.delete("/admin/posts/:id", requireApprover, (req, res) => {
  const post = db.prepare("SELECT title FROM posts WHERE id = ?").get(req.params.id);
  if (!post) return res.status(404).json({ error: "Post not found" });
  db.prepare("DELETE FROM posts WHERE id = ?").run(req.params.id);
  audit(req, "post_deleted", post.title);
  res.json({ message: "Post deleted" });
});

/* EMPLOYEE SPOTLIGHT */

app.get("/spotlight", (req, res) => {

  const spotlight = db.prepare(`
    SELECT
      id,
      name,
      title,
      message,
      photo_filename,
      updated_at
    FROM spotlight
    ORDER BY updated_at DESC
    LIMIT 1
  `).get();

  if (!spotlight) {
    return res.json({
      name: "Employee Spotlight",
      title: "Featured Staff Member",
      message: "No employee spotlight has been published yet.",
      photo_url: null,
      updated_at: null
    });
  }

  res.json({
    ...spotlight,
    photo_url: spotlight.photo_filename
      ? `/api/files/spotlight/${spotlight.photo_filename}`
      : null
  });
});

app.post(
  "/spotlight",
  requireAdmin,
  upload.single("photo"),
  (req, res) => {

    const { name, title, message } = req.body;

    if (!name || !title || !message) {
      return res.status(400).json({
        error: "Name, title, and message are required"
      });
    }

    const photoFilename = req.file ? req.file.filename : null;

    const result = db.prepare(`
      INSERT INTO spotlight (
        name,
        title,
        message,
        photo_filename,
        updated_by,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      name,
      title,
      message,
      photoFilename,
      req.session.user.id
    );

    res.json({
      message: "Employee spotlight updated",
      id: result.lastInsertRowid
    });
  }
);

/* RESOURCES */

app.get("/resources", (req, res) => {

  const resources = db.prepare(`
    SELECT
      id,
      title,
      category,
      filename,
      original_name,
      video_url,
      created_at
    FROM resources
    ORDER BY created_at DESC
  `).all();

  res.json(resources);
});

app.post(
  "/resources",
  requireAdmin,
  upload.single("file"),
  (req, res) => {

    const { title, category } = req.body;
    if (!title || !category) return res.status(400).json({ error: "Title and category are required" });
    if (!req.file && !req.body.video_url?.trim()) return res.status(400).json({ error: "A file or video URL is required" });

    const result = db.prepare(`
      INSERT INTO resources (
        title,
        category,
        filename,
        original_name,
        video_url,
        uploaded_by
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      title,
      category,
      req.file ? req.file.filename : null,
      req.file ? req.file.originalname : null,
      req.body.video_url?.trim() || null,
      req.session.user.id
    );

    res.json({
      message: "Resource uploaded",
      id: result.lastInsertRowid
    });
  }
);

/* SCHEDULES */

app.get("/schedules", (req, res) => {

  const schedules = db.prepare(`
    SELECT
      id,
      title,
      department,
      week_of,
      filename,
      original_name,
      created_at
    FROM schedules
    ORDER BY created_at DESC
  `).all();

  res.json(schedules);
});

app.post(
  "/schedules",
  requireAdmin,
  upload.single("file"),
  (req, res) => {

    const { title, department, week_of } = req.body;

    const result = db.prepare(`
      INSERT INTO schedules (
        title,
        department,
        week_of,
        filename,
        original_name,
        uploaded_by
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      title,
      department,
      week_of,
      req.file.filename,
      req.file.originalname,
      req.session.user.id
    );

    res.json({
      message: "Schedule uploaded",
      id: result.lastInsertRowid
    });
  }
);

/* SITE SETTINGS */

app.get("/settings", (req, res) => {
  const rows = db.prepare("SELECT key, value FROM site_settings").all();
  const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
  res.json(settings);
});

app.post("/admin/settings", requireSuperAdmin, (req, res) => {
  const allowed = [
    "site_name", "site_subtitle", "hero_title", "hero_subtitle", "hero_slides",
    "active_theme", "banner_enabled", "banner_text", "banner_color",
  ];
  const upsert = db.prepare(
    "INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  );
  const update = db.transaction(() => {
    for (const [k, v] of Object.entries(req.body)) {
      if (allowed.includes(k)) upsert.run(k, String(v));
    }
  });
  update();
  audit(req, "settings_updated", Object.keys(req.body).join(", "));
  const rows = db.prepare("SELECT key, value FROM site_settings").all();
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
});

/* STATS */

app.get("/admin/stats", requireAdmin, (req, res) => {
  const totalUsers     = db.prepare("SELECT COUNT(*) as n FROM users").get().n;
  const totalPosts     = db.prepare("SELECT COUNT(*) as n FROM posts WHERE status = 'approved'").get().n;
  const pendingPosts   = db.prepare("SELECT COUNT(*) as n FROM posts WHERE status = 'pending'").get().n;
  const totalContacts  = db.prepare("SELECT COUNT(*) as n FROM directory").get().n;
  const totalResources = db.prepare("SELECT COUNT(*) as n FROM resources").get().n;
  const totalSchedules = db.prepare("SELECT COUNT(*) as n FROM schedules").get().n;
  const recentPosts    = db.prepare(`
    SELECT posts.title, posts.status, posts.created_at, users.username AS author
    FROM posts LEFT JOIN users ON posts.author_id = users.id
    ORDER BY posts.created_at DESC LIMIT 5
  `).all();
  res.json({ totalUsers, totalPosts, pendingPosts, totalContacts, totalResources, totalSchedules, recentPosts });
});

/* AUDIT LOG */

app.get("/admin/audit", requireSuperAdmin, (req, res) => {
  const logs = db.prepare(`
    SELECT id, username, action, detail, created_at
    FROM audit_log ORDER BY created_at DESC LIMIT 100
  `).all();
  res.json(logs);
});

/* USER MANAGEMENT */

app.get("/admin/users", requireSuperAdmin, (req, res) => {
  const users = db.prepare(
    "SELECT id, username, role, department, created_at FROM users ORDER BY created_at DESC"
  ).all();
  res.json(users);
});

app.post("/admin/users", requireSuperAdmin, (req, res) => {
  const { username, password, role, department } = req.body;
  if (!username || !password || !role) {
    return res.status(400).json({ error: "Username, password, and role are required" });
  }
  const exists = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (exists) return res.status(409).json({ error: "Username already taken" });
  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare(
    "INSERT INTO users (username, password_hash, role, department) VALUES (?, ?, ?, ?)"
  ).run(username, hash, role, department?.trim() || null);
  audit(req, "user_created", `${username} (${role})`);
  res.json({ message: "User created", id: result.lastInsertRowid });
});

app.patch("/admin/users/:id", requireSuperAdmin, (req, res) => {
  const { role, password, department } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  if (role) {
    db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, req.params.id);
    audit(req, "role_changed", `${user.username} → ${role}`);
  }
  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, req.params.id);
    audit(req, "password_reset", user.username);
  }
  if (department !== undefined) {
    db.prepare("UPDATE users SET department = ? WHERE id = ?").run(department?.trim() || null, req.params.id);
  }
  res.json({ message: "User updated" });
});

app.delete("/admin/users/:id", requireSuperAdmin, (req, res) => {
  if (Number(req.params.id) === req.session.user.id) {
    return res.status(400).json({ error: "You cannot delete your own account" });
  }
  const user = db.prepare("SELECT username FROM users WHERE id = ?").get(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  db.prepare("DELETE FROM users WHERE id = ?").run(req.params.id);
  audit(req, "user_deleted", user.username);
  res.json({ message: "User deleted" });
});

/* MANAGER: MY POSTS */

app.get("/manager/my-posts", requireAdmin, (req, res) => {
  const posts = db.prepare(`
    SELECT id, title, content, status, created_at, reviewed_at
    FROM posts WHERE author_id = ? ORDER BY created_at DESC
  `).all(req.session.user.id);
  res.json(posts);
});

/* MANAGER: DEPARTMENT DIRECTORY */

// Managers can only see/edit contacts in their own department
app.get("/manager/directory", requireAdmin, (req, res) => {
  const dept = req.session.user.department;
  if (!dept) return res.json([]);
  const contacts = db.prepare(
    "SELECT * FROM directory WHERE department = ? ORDER BY name ASC"
  ).all(dept);
  res.json(contacts);
});

app.post("/manager/directory", requireAdmin, (req, res) => {
  const dept = req.session.user.department;
  if (!dept) return res.status(403).json({ error: "No department assigned to your account" });
  const { name, title, phone, email } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Name is required" });
  const result = db.prepare(
    "INSERT INTO directory (name, title, department, phone, email) VALUES (?, ?, ?, ?, ?)"
  ).run(name.trim(), title?.trim() || "", dept, phone?.trim() || "", email?.trim() || "");
  audit(req, "directory_add", `${name} (${dept}) by manager ${req.session.user.username}`);
  res.json({ success: true, id: result.lastInsertRowid });
});

app.patch("/manager/directory/:id", requireAdmin, (req, res) => {
  const dept = req.session.user.department;
  const contact = db.prepare("SELECT * FROM directory WHERE id = ?").get(req.params.id);
  if (!contact) return res.status(404).json({ error: "Not found" });
  if (contact.department !== dept) return res.status(403).json({ error: "Not in your department" });
  const { name, title, phone, email } = req.body;
  db.prepare(
    "UPDATE directory SET name = ?, title = ?, phone = ?, email = ? WHERE id = ?"
  ).run(
    name?.trim() ?? contact.name,
    title?.trim() ?? contact.title,
    phone?.trim() ?? contact.phone,
    email?.trim() ?? contact.email,
    req.params.id
  );
  audit(req, "directory_edit", `#${req.params.id} by manager ${req.session.user.username}`);
  res.json({ success: true });
});

app.delete("/manager/directory/:id", requireAdmin, (req, res) => {
  const dept = req.session.user.department;
  const contact = db.prepare("SELECT * FROM directory WHERE id = ?").get(req.params.id);
  if (!contact) return res.status(404).json({ error: "Not found" });
  if (contact.department !== dept) return res.status(403).json({ error: "Not in your department" });
  db.prepare("DELETE FROM directory WHERE id = ?").run(req.params.id);
  audit(req, "directory_delete", `${contact.name} by manager ${req.session.user.username}`);
  res.json({ success: true });
});

/* DIRECTORY */

app.get("/directory", (req, res) => {
  const q = `%${(req.query.q || "").trim()}%`;
  const contacts = db.prepare(`
    SELECT id, name, title, department, phone, email
    FROM directory
    WHERE name LIKE ? OR title LIKE ? OR department LIKE ? OR phone LIKE ? OR email LIKE ?
    ORDER BY name ASC
  `).all(q, q, q, q, q);
  res.json(contacts);
});

app.post("/directory", requireAdmin, (req, res) => {
  const { name, title, department, phone, email } = req.body;
  if (!name) return res.status(400).json({ error: "Name is required" });
  const result = db.prepare(`
    INSERT INTO directory (name, title, department, phone, email)
    VALUES (?, ?, ?, ?, ?)
  `).run(name, title || "", department || "", phone || "", email || "");
  res.json({ message: "Contact added", id: result.lastInsertRowid });
});

app.delete("/directory/:id", requireAdmin, (req, res) => {
  db.prepare("DELETE FROM directory WHERE id = ?").run(req.params.id);
  res.json({ message: "Contact removed" });
});

/* SEARCH */

app.get("/search", (req, res) => {
  const raw = (req.query.q || "").trim();
  if (!raw) return res.json({ posts: [], resources: [], schedules: [], directory: [] });
  const q = `%${raw}%`;

  const posts = db.prepare(`
    SELECT id, title, content, created_at
    FROM posts
    WHERE status = 'approved' AND (title LIKE ? OR content LIKE ?)
    ORDER BY created_at DESC LIMIT 10
  `).all(q, q);

  const resources = db.prepare(`
    SELECT id, title, category, filename, original_name
    FROM resources
    WHERE title LIKE ? OR category LIKE ?
    ORDER BY created_at DESC LIMIT 10
  `).all(q, q);

  const schedules = db.prepare(`
    SELECT id, title, department, week_of, filename, original_name
    FROM schedules
    WHERE title LIKE ? OR department LIKE ?
    ORDER BY created_at DESC LIMIT 10
  `).all(q, q);

  const directory = db.prepare(`
    SELECT id, name, title, department, phone, email
    FROM directory
    WHERE name LIKE ? OR title LIKE ? OR department LIKE ? OR phone LIKE ? OR email LIKE ?
    ORDER BY name ASC LIMIT 20
  `).all(q, q, q, q, q);

  res.json({ posts, resources, schedules, directory });
});

// ── IT Tickets ────────────────────────────────────────────────────────────────

// Public: submit a ticket
// Public: submit an IT request — emails InfoTech, stores to DB as backup log
app.post("/it-request", async (req, res) => {
  const { ticket_type, name, department, phone, subject, description, priority, equipment_type, equipment_detail } = req.body;
  if (!name?.trim())        return res.status(400).json({ error: "Your name is required" });
  if (!description?.trim()) return res.status(400).json({ error: "Description is required" });
  const validTypes = ["support", "equipment"];
  if (!validTypes.includes(ticket_type)) return res.status(400).json({ error: "Invalid request type" });

  // Log to DB so nothing is lost if email fails
  db.prepare(`
    INSERT INTO it_tickets (ticket_type, name, department, phone, subject, description, priority, equipment_type, equipment_detail)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    ticket_type, name.trim(),
    department?.trim() || null, phone?.trim() || null,
    (subject || (ticket_type === "equipment" ? `Equipment request: ${equipment_type}` : "Support request")).trim(),
    description.trim(),
    priority || "normal",
    equipment_type?.trim() || null, equipment_detail?.trim() || null
  );

  const typeLabel = ticket_type === "equipment" ? "Equipment Request" : "Technical Support Request";
  const priorityLabel = (priority || "normal").toUpperCase();

  let bodyLines = [
    `Type: ${typeLabel}`,
    `Priority: ${priorityLabel}`,
    ``,
    `From: ${name.trim()}`,
    department?.trim() ? `Department: ${department.trim()}` : null,
    phone?.trim()       ? `Phone/Ext: ${phone.trim()}`       : null,
    ``,
  ].filter(l => l !== null);

  if (ticket_type === "equipment" && equipment_type) {
    bodyLines.push(`Equipment Type: ${equipment_type}`);
    if (equipment_detail?.trim()) bodyLines.push(`Model / Details: ${equipment_detail.trim()}`);
    bodyLines.push(``);
  }

  if (subject?.trim() && ticket_type === "support") {
    bodyLines.push(`Subject: ${subject.trim()}`);
    bodyLines.push(``);
  }

  bodyLines.push(`Description:`);
  bodyLines.push(description.trim());
  bodyLines.push(``);
  bodyLines.push(`Submitted via The Heart Center Staff Intranet`);

  const emailSubject = ticket_type === "equipment"
    ? `[Equipment Request] ${equipment_type ? equipment_type.charAt(0).toUpperCase() + equipment_type.slice(1) : ""} — ${name.trim()}`
    : `[IT Support] ${subject?.trim() || "Support Request"} — ${name.trim()} (${priorityLabel})`;

  await sendMail({
    from: "no-reply@<company-domain>",
    to: "InfoTech@<company-domain>",
    subject: emailSubject,
    text: bodyLines.join("\n"),
  });

  res.json({ success: true });
});

// ── Spotlight Nominations ─────────────────────────────────────────────────────

// Public: submit a nomination
app.post("/spotlight/nominations", (req, res) => {
  const { nominee_name, nominee_title, nominee_department, reason, submitted_by } = req.body;
  if (!nominee_name?.trim()) return res.status(400).json({ error: "Nominee name is required" });
  if (!reason?.trim())       return res.status(400).json({ error: "Reason is required" });
  db.prepare(
    "INSERT INTO spotlight_nominations (nominee_name, nominee_title, nominee_department, reason, submitted_by) VALUES (?, ?, ?, ?, ?)"
  ).run(nominee_name.trim(), nominee_title?.trim() || null, nominee_department?.trim() || null, reason.trim(), submitted_by?.trim() || "Anonymous");
  res.json({ success: true });
});

// Admin+: get all nominations (not manager-only — requireApprover = admin & superadmin)
app.get("/admin/spotlight/nominations", requireApprover, (req, res) => {
  const nominations = db.prepare(
    "SELECT * FROM spotlight_nominations ORDER BY created_at DESC"
  ).all();
  res.json(nominations);
});

// Admin+: dismiss a nomination
app.delete("/admin/spotlight/nominations/:id", requireApprover, (req, res) => {
  db.prepare("DELETE FROM spotlight_nominations WHERE id = ?").run(req.params.id);
  audit(req, "nomination_dismissed", `Nomination #${req.params.id}`);
  res.json({ success: true });
});

// Admin+: promote nomination to spotlight (pre-fills spotlight update form)
app.get("/admin/spotlight/nominations/:id", requireApprover, (req, res) => {
  const nom = db.prepare("SELECT * FROM spotlight_nominations WHERE id = ?").get(req.params.id);
  if (!nom) return res.status(404).json({ error: "Not found" });
  res.json(nom);
});

// ── Sign-up Sheets ────────────────────────────────────────────────────────────

// Public: list all open sheets with slot counts
app.get("/signup-sheets", (req, res) => {
  const sheets = db.prepare(`
    SELECT s.*,
      (SELECT COUNT(*) FROM signup_entries e WHERE e.sheet_id = s.id AND e.is_waitlist = 0) AS filled_slots,
      (SELECT COUNT(*) FROM signup_entries e WHERE e.sheet_id = s.id AND e.is_waitlist = 1) AS waitlist_count
    FROM signup_sheets s
    ORDER BY s.event_date ASC, s.created_at DESC
  `).all();
  res.json(sheets);
});

// Public: get single sheet with its entries
app.get("/signup-sheets/:id", (req, res) => {
  const sheet = db.prepare(`
    SELECT s.*,
      (SELECT COUNT(*) FROM signup_entries e WHERE e.sheet_id = s.id AND e.is_waitlist = 0) AS filled_slots,
      (SELECT COUNT(*) FROM signup_entries e WHERE e.sheet_id = s.id AND e.is_waitlist = 1) AS waitlist_count
    FROM signup_sheets s WHERE s.id = ?
  `).get(req.params.id);
  if (!sheet) return res.status(404).json({ error: "Not found" });
  const entries = db.prepare(
    "SELECT * FROM signup_entries WHERE sheet_id = ? ORDER BY is_waitlist ASC, signed_up_at ASC"
  ).all(req.params.id);
  res.json({ ...sheet, entries });
});

// Public: sign up for a sheet
app.post("/signup-sheets/:id/signup", (req, res) => {
  const sheet = db.prepare(`
    SELECT s.*,
      (SELECT COUNT(*) FROM signup_entries e WHERE e.sheet_id = s.id AND e.is_waitlist = 0) AS filled_slots
    FROM signup_sheets s WHERE s.id = ?
  `).get(req.params.id);
  if (!sheet) return res.status(404).json({ error: "Sheet not found" });
  if (!sheet.is_open) return res.status(400).json({ error: "This sign-up sheet is closed" });

  const now = new Date().toISOString();
  if (sheet.deadline && now > sheet.deadline) {
    return res.status(400).json({ error: "The sign-up deadline has passed" });
  }

  const { name, department, notes } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Name is required" });

  const isFull = sheet.max_slots > 0 && sheet.filled_slots >= sheet.max_slots;
  if (isFull && !sheet.allow_waitlist) {
    return res.status(400).json({ error: "This event is full" });
  }

  const is_waitlist = isFull ? 1 : 0;
  db.prepare(
    "INSERT INTO signup_entries (sheet_id, name, department, notes, is_waitlist) VALUES (?, ?, ?, ?, ?)"
  ).run(req.params.id, name.trim(), department?.trim() || null, notes?.trim() || null, is_waitlist);

  res.json({ success: true, waitlisted: is_waitlist === 1 });
});

// Manager+: create a sheet
app.post("/signup-sheets", requireAdmin, (req, res) => {
  const { title, description, event_type, event_date, end_date, recurrence_pattern, recurrence_days, recurrence_end_date, deadline, location, max_slots, allow_waitlist } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: "Title is required" });
  const u = req.session.user;
  const result = db.prepare(`
    INSERT INTO signup_sheets (title, description, event_type, event_date, end_date, recurrence_pattern, recurrence_days, recurrence_end_date, deadline, location, max_slots, allow_waitlist, created_by, created_by_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    title.trim(),
    description?.trim() || null,
    event_type || "single",
    event_date || null,
    end_date || null,
    recurrence_pattern || null,
    recurrence_days || null,
    recurrence_end_date || null,
    deadline || null,
    location?.trim() || null,
    parseInt(max_slots) || 0,
    allow_waitlist ? 1 : 0,
    u.id, u.username
  );
  audit(req, "sheet_created", title.trim());
  res.json({ id: result.lastInsertRowid });
});

// Manager+: update a sheet (open/close, edit details)
app.patch("/signup-sheets/:id", requireAdmin, (req, res) => {
  const sheet = db.prepare("SELECT * FROM signup_sheets WHERE id = ?").get(req.params.id);
  if (!sheet) return res.status(404).json({ error: "Not found" });
  const { title, description, event_type, event_date, end_date, recurrence_pattern, recurrence_days, recurrence_end_date, deadline, location, max_slots, allow_waitlist, is_open } = req.body;
  db.prepare(`
    UPDATE signup_sheets SET
      title = ?, description = ?, event_type = ?, event_date = ?, end_date = ?,
      recurrence_pattern = ?, recurrence_days = ?, recurrence_end_date = ?,
      deadline = ?, location = ?, max_slots = ?, allow_waitlist = ?, is_open = ?
    WHERE id = ?
  `).run(
    title ?? sheet.title,
    description ?? sheet.description,
    event_type ?? sheet.event_type,
    event_date ?? sheet.event_date,
    end_date ?? sheet.end_date,
    recurrence_pattern ?? sheet.recurrence_pattern,
    recurrence_days ?? sheet.recurrence_days,
    recurrence_end_date ?? sheet.recurrence_end_date,
    deadline ?? sheet.deadline,
    location ?? sheet.location,
    max_slots !== undefined ? parseInt(max_slots) : sheet.max_slots,
    allow_waitlist !== undefined ? (allow_waitlist ? 1 : 0) : sheet.allow_waitlist,
    is_open !== undefined ? (is_open ? 1 : 0) : sheet.is_open,
    req.params.id
  );
  audit(req, "sheet_updated", sheet.title);
  res.json({ success: true });
});

// Admin+: delete a sheet and all its entries
app.delete("/signup-sheets/:id", requireApprover, (req, res) => {
  const sheet = db.prepare("SELECT title FROM signup_sheets WHERE id = ?").get(req.params.id);
  if (!sheet) return res.status(404).json({ error: "Not found" });
  db.prepare("DELETE FROM signup_sheets WHERE id = ?").run(req.params.id);
  audit(req, "sheet_deleted", sheet.title);
  res.json({ success: true });
});

// Admin+: remove a single entry from a sheet
app.delete("/signup-sheets/:id/entries/:entryId", requireApprover, (req, res) => {
  db.prepare("DELETE FROM signup_entries WHERE id = ? AND sheet_id = ?").run(req.params.entryId, req.params.id);
  res.json({ success: true });
});

// Admin+: export entries as CSV
app.get("/signup-sheets/:id/export", requireAdmin, (req, res) => {
  const sheet = db.prepare("SELECT * FROM signup_sheets WHERE id = ?").get(req.params.id);
  if (!sheet) return res.status(404).json({ error: "Not found" });
  const entries = db.prepare(
    "SELECT name, department, notes, is_waitlist, signed_up_at FROM signup_entries WHERE sheet_id = ? ORDER BY is_waitlist ASC, signed_up_at ASC"
  ).all(req.params.id);

  const escape = v => `"${(v || "").toString().replace(/"/g, '""')}"`;
  const rows = [
    ["Name", "Department", "Notes", "Status", "Signed Up At"].map(escape).join(","),
    ...entries.map(e => [
      e.name, e.department, e.notes,
      e.is_waitlist ? "Waitlist" : "Confirmed",
      e.signed_up_at
    ].map(escape).join(","))
  ];

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="signups-${sheet.id}.csv"`);
  res.send(rows.join("\n"));
});

app.listen(3000, () => {

  console.log("Backend running on port 3000");
});
