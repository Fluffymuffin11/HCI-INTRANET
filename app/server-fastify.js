'use strict'

const path             = require('path')
const fs               = require('fs')
const { pipeline }     = require('stream/promises')
const bcrypt           = require('bcryptjs')
const nodemailer       = require('nodemailer')
const { PrismaClient } = require('@prisma/client')

// ── Guards ────────────────────────────────────────────────────────────────────
const SESSION_SECRET = process.env.SESSION_SECRET
if (!SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET is not set. Refusing to start.')
  process.exit(1)
}
if (!process.env.DATABASE_URL) {
  console.error('FATAL: DATABASE_URL is not set. Refusing to start.')
  process.exit(1)
}

const prisma = new PrismaClient()

// ── Email stub ────────────────────────────────────────────────────────────────
// TODO: Replace jsonTransport with real SMTP when Exchange details are known.
const mailer = nodemailer.createTransport({ jsonTransport: true })

async function sendMail(opts) {
  try {
    await mailer.sendMail(opts)
    console.log('[email stub]', opts.subject, '→', opts.to)
    return { ok: true }
  } catch (err) {
    console.error('[email error]', err.message)
    return { ok: false, error: err.message }
  }
}

// ── Session store (Prisma-backed) ─────────────────────────────────────────────
const SESSION_TTL_MS = 8 * 60 * 60 * 1000 // 8 hours

class PrismaSessionStore {
  get(sid, cb) {
    prisma.session.findUnique({ where: { sid } })
      .then(r => {
        if (!r || r.expiresAt < new Date()) return cb(null, null)
        try { cb(null, JSON.parse(r.data)) } catch { cb(null, null) }
      })
      .catch(cb)
  }

  set(sid, session, cb) {
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
    prisma.session.upsert({
      where:  { sid },
      update: { data: JSON.stringify(session), expiresAt },
      create: { sid, data: JSON.stringify(session), expiresAt },
    })
      .then(() => cb(null))
      .catch(cb)
  }

  destroy(sid, cb) {
    prisma.session.delete({ where: { sid } })
      .then(() => cb(null))
      .catch(err => (err.code === 'P2025' ? cb(null) : cb(err)))
  }
}

// ── Fastify instance ──────────────────────────────────────────────────────────
const fastify = require('fastify')({
  logger:     { level: 'info' },
  trustProxy: true,
})

// ── Plugin registrations ──────────────────────────────────────────────────────
fastify.register(require('@fastify/cookie'))

fastify.register(require('@fastify/session'), {
  secret:            SESSION_SECRET,
  store:             new PrismaSessionStore(),
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    // Set to true in production once nginx terminates TLS (Step 5)
    secure:   false,
    maxAge:   SESSION_TTL_MS,
  },
})

fastify.register(require('@fastify/rate-limit'), { global: false })

fastify.register(require('@fastify/multipart'), {
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
})

fastify.register(require('@fastify/static'), {
  root:   '/uploads',
  prefix: '/files/',
})

// ── Error handler ─────────────────────────────────────────────────────────────
fastify.setErrorHandler((err, request, reply) => {
  fastify.log.error(err)
  reply.code(err.statusCode || 500).send({ error: err.message || 'Internal server error' })
})

fastify.setNotFoundHandler((request, reply) => {
  reply.code(404).send({ error: 'Not found' })
})

// ── Auth preHandlers ──────────────────────────────────────────────────────────
function requireLogin(req, reply, done) {
  if (!req.session.user) return reply.code(401).send({ error: 'Not logged in' })
  done()
}

function requireAdmin(req, reply, done) {
  if (!req.session.user || !['manager', 'admin', 'superadmin'].includes(req.session.user.role))
    return reply.code(403).send({ error: 'Admin access required' })
  done()
}

function requireApprover(req, reply, done) {
  if (!req.session.user || !['admin', 'superadmin'].includes(req.session.user.role))
    return reply.code(403).send({ error: 'Approver access required' })
  done()
}

function requireSuperAdmin(req, reply, done) {
  if (!req.session.user || req.session.user.role !== 'superadmin')
    return reply.code(403).send({ error: 'Superadmin access required' })
  done()
}

async function audit(req, action, detail) {
  try {
    const u = req.session?.user
    await prisma.auditLog.create({
      data: { userId: u?.id || null, username: u?.username || 'system', action, detail: detail || null },
    })
  } catch (_) {}
}

// ── Multipart upload helper ───────────────────────────────────────────────────
// Parses a multipart/form-data request, saves the file to destDir, returns
// { fields: {key: value}, file: { filename, originalname } | null }.
async function handleMultipart(req, destDir) {
  const fields = {}
  let file = null

  for await (const part of req.parts()) {
    if (part.type === 'file') {
      if (part.filename) {
        const safeName = `${Date.now()}-${part.filename.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`
        await pipeline(part.file, fs.createWriteStream(path.join(destDir, safeName)))
        file = { filename: safeName, originalname: part.filename }
      } else {
        // Empty file field — drain the stream to avoid hanging
        for await (const _ of part.file) {} // eslint-disable-line no-unused-vars
      }
    } else {
      fields[part.fieldname] = part.value
    }
  }

  return { fields, file }
}

// ── Response shape helpers ────────────────────────────────────────────────────
// All helpers map Prisma's camelCase fields back to the snake_case shapes
// the existing frontend expects.

function fmtPost(p) {
  return {
    id: p.id, title: p.title, content: p.content,
    photo_filename: p.photoFilename,
    photo_url:      p.photoFilename ? `/api/files/posts/${p.photoFilename}` : null,
    video_url:      p.videoUrl,
    status:         p.status,
    created_at:     p.createdAt,
    author:         p.author?.username ?? null,
  }
}

function fmtResource(r) {
  return {
    id: r.id, title: r.title, category: r.category,
    filename:      r.filename,
    original_name: r.originalName,
    video_url:     r.videoUrl,
    created_at:    r.createdAt,
  }
}

function fmtSchedule(s) {
  return {
    id: s.id, title: s.title, department: s.department,
    week_of:       s.weekOf,
    filename:      s.filename,
    original_name: s.originalName,
    created_at:    s.createdAt,
  }
}

function fmtSheet(s) {
  return {
    id: s.id, title: s.title, description: s.description,
    event_type:          s.eventType,
    event_date:          s.eventDate,
    end_date:            s.endDate,
    recurrence_pattern:  s.recurrencePattern,
    recurrence_days:     s.recurrenceDays,
    recurrence_end_date: s.recurrenceEndDate,
    deadline:            s.deadline,
    location:            s.location,
    max_slots:           s.maxSlots,
    allow_waitlist:      s.allowWaitlist,
    is_open:             s.isOpen,
    created_by:          s.createdBy,
    created_by_name:     s.createdByName,
    created_at:          s.createdAt,
  }
}

function fmtEntry(e) {
  return {
    id: e.id, sheet_id: e.sheetId, name: e.name,
    department:   e.department,
    notes:        e.notes,
    is_waitlist:  e.isWaitlist,
    signed_up_at: e.signedUpAt,
  }
}

function fmtNomination(n) {
  return {
    id: n.id,
    nominee_name:       n.nomineeName,
    nominee_title:      n.nomineeTitle,
    nominee_department: n.nomineeDepartment,
    reason:             n.reason,
    submitted_by:       n.submittedBy,
    status:             n.status,
    created_at:         n.createdAt,
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Health
fastify.get('/health', async () => ({ status: 'ok', message: 'Backend running' }))

// ── Auth ──────────────────────────────────────────────────────────────────────

fastify.post('/auth/login', {
  config: {
    rateLimit: {
      max:         20,
      timeWindow:  '15 minutes',
      errorResponseBuilder: () => ({ error: 'Too many login attempts. Please wait 15 minutes and try again.' }),
    },
  },
}, async (req, reply) => {
  const { username, password } = req.body || {}
  const user = await prisma.user.findUnique({ where: { username: username || '' } })
  if (!user || !bcrypt.compareSync(password, user.passwordHash))
    return reply.code(401).send({ error: 'Invalid credentials' })
  req.session.user = { id: user.id, username: user.username, role: user.role, department: user.department || null }
  await audit(req, 'login', `${user.username} signed in`)
  return { message: 'Logged in', user: req.session.user }
})

fastify.post('/auth/logout', async (req) => {
  await req.session.destroy()
  return { message: 'Logged out' }
})

fastify.get('/auth/me', async (req) => ({ user: req.session.user || null }))

// ── Posts ─────────────────────────────────────────────────────────────────────

fastify.get('/posts', async () => {
  const posts = await prisma.post.findMany({
    where:   { status: 'approved' },
    orderBy: { createdAt: 'desc' },
    include: { author: { select: { username: true } } },
  })
  return posts.map(fmtPost)
})

fastify.post('/posts', { preHandler: requireAdmin }, async (req, reply) => {
  const { fields, file } = await handleMultipart(req, '/uploads/posts')
  const { title, content, video_url } = fields
  if (!title || !content) return reply.code(400).send({ error: 'Title and content are required' })
  const post = await prisma.post.create({
    data: {
      title, content,
      photoFilename: file?.filename || null,
      videoUrl:      video_url?.trim() || null,
      authorId:      req.session.user.id,
      status:        'pending',
    },
  })
  return { message: 'Post submitted for approval', id: post.id }
})

fastify.get('/admin/posts/pending', { preHandler: requireAdmin }, async () => {
  const posts = await prisma.post.findMany({
    where:   { status: 'pending' },
    orderBy: { createdAt: 'desc' },
    include: { author: { select: { username: true } } },
  })
  return posts.map(fmtPost)
})

fastify.post('/admin/posts/:id/approve', { preHandler: requireApprover }, async (req, reply) => {
  const id   = parseInt(req.params.id)
  const post = await prisma.post.findUnique({ where: { id } })
  if (!post) return reply.code(404).send({ error: 'Not found' })
  await prisma.post.update({ where: { id }, data: { status: 'approved', reviewedBy: req.session.user.id, reviewedAt: new Date() } })
  await audit(req, 'post_approved', post.title)
  return { message: 'Post approved' }
})

fastify.post('/admin/posts/:id/reject', { preHandler: requireApprover }, async (req, reply) => {
  const id   = parseInt(req.params.id)
  const post = await prisma.post.findUnique({ where: { id } })
  if (!post) return reply.code(404).send({ error: 'Not found' })
  await prisma.post.update({ where: { id }, data: { status: 'rejected', reviewedBy: req.session.user.id, reviewedAt: new Date() } })
  await audit(req, 'post_rejected', post.title)
  return { message: 'Post rejected' }
})

fastify.delete('/admin/posts/:id', { preHandler: requireApprover }, async (req, reply) => {
  const id   = parseInt(req.params.id)
  const post = await prisma.post.findUnique({ where: { id } })
  if (!post) return reply.code(404).send({ error: 'Post not found' })
  await prisma.post.delete({ where: { id } })
  await audit(req, 'post_deleted', post.title)
  return { message: 'Post deleted' }
})

// ── Spotlight ─────────────────────────────────────────────────────────────────

fastify.get('/spotlight', async () => {
  const s = await prisma.spotlight.findFirst({ orderBy: { updatedAt: 'desc' } })
  if (!s) return { name: 'Employee Spotlight', title: 'Featured Staff Member', message: 'No employee spotlight has been published yet.', photo_url: null, updated_at: null }
  return {
    id: s.id, name: s.name, title: s.title, message: s.message,
    photo_filename: s.photoFilename,
    photo_url:      s.photoFilename ? `/api/files/spotlight/${s.photoFilename}` : null,
    updated_at:     s.updatedAt,
  }
})

fastify.post('/spotlight', { preHandler: requireAdmin }, async (req, reply) => {
  const { fields, file } = await handleMultipart(req, '/uploads/spotlight')
  const { name, title, message } = fields
  if (!name || !title || !message) return reply.code(400).send({ error: 'Name, title, and message are required' })
  const s = await prisma.spotlight.create({
    data: { name, title, message, photoFilename: file?.filename || null, updatedBy: req.session.user.id },
  })
  return { message: 'Employee spotlight updated', id: s.id }
})

// ── Resources ─────────────────────────────────────────────────────────────────

fastify.get('/resources', async () => {
  const resources = await prisma.resource.findMany({ orderBy: { createdAt: 'desc' } })
  return resources.map(fmtResource)
})

fastify.post('/resources', { preHandler: requireAdmin }, async (req, reply) => {
  const { fields, file } = await handleMultipart(req, '/uploads/resources')
  const { title, category, video_url } = fields
  if (!title || !category)              return reply.code(400).send({ error: 'Title and category are required' })
  if (!file && !video_url?.trim())      return reply.code(400).send({ error: 'A file or video URL is required' })
  const r = await prisma.resource.create({
    data: {
      title, category,
      filename:     file?.filename     || null,
      originalName: file?.originalname || null,
      videoUrl:     video_url?.trim()  || null,
      uploadedBy:   req.session.user.id,
    },
  })
  return { message: 'Resource uploaded', id: r.id }
})

// ── Schedules ─────────────────────────────────────────────────────────────────

fastify.get('/schedules', async () => {
  const schedules = await prisma.schedule.findMany({ orderBy: { createdAt: 'desc' } })
  return schedules.map(fmtSchedule)
})

fastify.post('/schedules', { preHandler: requireAdmin }, async (req, reply) => {
  const { fields, file } = await handleMultipart(req, '/uploads/schedules')
  if (!file) return reply.code(400).send({ error: 'A file is required' })
  const s = await prisma.schedule.create({
    data: {
      title:        fields.title,
      department:   fields.department,
      weekOf:       fields.week_of     || null,
      filename:     file.filename,
      originalName: file.originalname,
      uploadedBy:   req.session.user.id,
    },
  })
  return { message: 'Schedule uploaded', id: s.id }
})

// ── Site settings ─────────────────────────────────────────────────────────────

fastify.get('/settings', async () => {
  const rows = await prisma.siteSetting.findMany()
  return Object.fromEntries(rows.map(r => [r.key, r.value]))
})

fastify.post('/admin/settings', { preHandler: requireSuperAdmin }, async (req) => {
  const allowed = ['site_name', 'site_subtitle', 'hero_title', 'hero_subtitle', 'hero_slides', 'active_theme', 'banner_enabled', 'banner_text', 'banner_color']
  for (const [k, v] of Object.entries(req.body || {})) {
    if (!allowed.includes(k)) continue
    await prisma.siteSetting.upsert({ where: { key: k }, update: { value: String(v), updatedAt: new Date() }, create: { key: k, value: String(v) } })
  }
  await audit(req, 'settings_updated', Object.keys(req.body || {}).join(', '))
  const rows = await prisma.siteSetting.findMany()
  return Object.fromEntries(rows.map(r => [r.key, r.value]))
})

// ── Admin stats ───────────────────────────────────────────────────────────────

fastify.get('/admin/stats', { preHandler: requireAdmin }, async () => {
  const [totalUsers, totalPosts, pendingPosts, totalContacts, totalResources, totalSchedules, recentPostsRaw] = await Promise.all([
    prisma.user.count(),
    prisma.post.count({ where: { status: 'approved' } }),
    prisma.post.count({ where: { status: 'pending' } }),
    prisma.directory.count(),
    prisma.resource.count(),
    prisma.schedule.count(),
    prisma.post.findMany({ orderBy: { createdAt: 'desc' }, take: 5, include: { author: { select: { username: true } } } }),
  ])
  const recentPosts = recentPostsRaw.map(p => ({ title: p.title, status: p.status, created_at: p.createdAt, author: p.author?.username || null }))
  return { totalUsers, totalPosts, pendingPosts, totalContacts, totalResources, totalSchedules, recentPosts }
})

// ── Audit log ─────────────────────────────────────────────────────────────────

fastify.get('/admin/audit', { preHandler: requireSuperAdmin }, async () => {
  const logs = await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100 })
  return logs.map(l => ({ id: l.id, username: l.username, action: l.action, detail: l.detail, created_at: l.createdAt }))
})

// ── User management ───────────────────────────────────────────────────────────

fastify.get('/admin/users', { preHandler: requireSuperAdmin }, async () => {
  const users = await prisma.user.findMany({ orderBy: { createdAt: 'desc' } })
  return users.map(u => ({ id: u.id, username: u.username, role: u.role, department: u.department, created_at: u.createdAt }))
})

fastify.post('/admin/users', { preHandler: requireSuperAdmin }, async (req, reply) => {
  const { username, password, role, department } = req.body || {}
  if (!username || !password || !role) return reply.code(400).send({ error: 'Username, password, and role are required' })
  const exists = await prisma.user.findUnique({ where: { username } })
  if (exists) return reply.code(409).send({ error: 'Username already taken' })
  const hash = await bcrypt.hash(password, 10)
  const user = await prisma.user.create({ data: { username, passwordHash: hash, role, department: department?.trim() || null } })
  await audit(req, 'user_created', `${username} (${role})`)
  return { message: 'User created', id: user.id }
})

fastify.patch('/admin/users/:id', { preHandler: requireSuperAdmin }, async (req, reply) => {
  const id   = parseInt(req.params.id)
  const { role, password, department } = req.body || {}
  const user = await prisma.user.findUnique({ where: { id } })
  if (!user) return reply.code(404).send({ error: 'User not found' })
  const updates = {}
  if (role)                    { updates.role         = role;                              await audit(req, 'role_changed',  `${user.username} → ${role}`) }
  if (password)                { updates.passwordHash = await bcrypt.hash(password, 10);  await audit(req, 'password_reset', user.username) }
  if (department !== undefined)  updates.department   = department?.trim() || null
  if (Object.keys(updates).length) await prisma.user.update({ where: { id }, data: updates })
  return { message: 'User updated' }
})

fastify.delete('/admin/users/:id', { preHandler: requireSuperAdmin }, async (req, reply) => {
  const id = parseInt(req.params.id)
  if (id === req.session.user.id) return reply.code(400).send({ error: 'You cannot delete your own account' })
  const user = await prisma.user.findUnique({ where: { id } })
  if (!user) return reply.code(404).send({ error: 'User not found' })
  await prisma.user.delete({ where: { id } })
  await audit(req, 'user_deleted', user.username)
  return { message: 'User deleted' }
})

// ── Manager: my posts ─────────────────────────────────────────────────────────

fastify.get('/manager/my-posts', { preHandler: requireAdmin }, async (req) => {
  const posts = await prisma.post.findMany({
    where:   { authorId: req.session.user.id },
    orderBy: { createdAt: 'desc' },
  })
  return posts.map(p => ({ id: p.id, title: p.title, content: p.content, status: p.status, created_at: p.createdAt, reviewed_at: p.reviewedAt }))
})

// ── Manager: department directory ─────────────────────────────────────────────

fastify.get('/manager/directory', { preHandler: requireAdmin }, async (req) => {
  const dept = req.session.user.department
  if (!dept) return []
  return prisma.directory.findMany({ where: { department: dept }, orderBy: { name: 'asc' } })
})

fastify.post('/manager/directory', { preHandler: requireAdmin }, async (req, reply) => {
  const dept = req.session.user.department
  if (!dept) return reply.code(403).send({ error: 'No department assigned to your account' })
  const { name, title, phone, email } = req.body || {}
  if (!name?.trim()) return reply.code(400).send({ error: 'Name is required' })
  const contact = await prisma.directory.create({
    data: { name: name.trim(), title: title?.trim() || '', department: dept, phone: phone?.trim() || '', email: email?.trim() || '' },
  })
  await audit(req, 'directory_add', `${name} (${dept}) by manager ${req.session.user.username}`)
  return { success: true, id: contact.id }
})

fastify.patch('/manager/directory/:id', { preHandler: requireAdmin }, async (req, reply) => {
  const id      = parseInt(req.params.id)
  const dept    = req.session.user.department
  const contact = await prisma.directory.findUnique({ where: { id } })
  if (!contact)                   return reply.code(404).send({ error: 'Not found' })
  if (contact.department !== dept) return reply.code(403).send({ error: 'Not in your department' })
  const { name, title, phone, email } = req.body || {}
  await prisma.directory.update({
    where: { id },
    data: {
      name:  name?.trim()  ?? contact.name,
      title: title?.trim() ?? contact.title,
      phone: phone?.trim() ?? contact.phone,
      email: email?.trim() ?? contact.email,
    },
  })
  await audit(req, 'directory_edit', `#${id} by manager ${req.session.user.username}`)
  return { success: true }
})

fastify.delete('/manager/directory/:id', { preHandler: requireAdmin }, async (req, reply) => {
  const id      = parseInt(req.params.id)
  const dept    = req.session.user.department
  const contact = await prisma.directory.findUnique({ where: { id } })
  if (!contact)                   return reply.code(404).send({ error: 'Not found' })
  if (contact.department !== dept) return reply.code(403).send({ error: 'Not in your department' })
  await prisma.directory.delete({ where: { id } })
  await audit(req, 'directory_delete', `${contact.name} by manager ${req.session.user.username}`)
  return { success: true }
})

// ── Directory ─────────────────────────────────────────────────────────────────

fastify.get('/directory', async (req) => {
  const q = (req.query.q || '').trim()
  const contacts = await prisma.directory.findMany({
    where: q ? { OR: [
      { name:       { contains: q, mode: 'insensitive' } },
      { title:      { contains: q, mode: 'insensitive' } },
      { department: { contains: q, mode: 'insensitive' } },
      { phone:      { contains: q, mode: 'insensitive' } },
      { email:      { contains: q, mode: 'insensitive' } },
    ] } : {},
    orderBy: { name: 'asc' },
  })
  return contacts.map(c => ({ id: c.id, name: c.name, title: c.title, department: c.department, phone: c.phone, email: c.email }))
})

fastify.post('/directory', { preHandler: requireAdmin }, async (req, reply) => {
  const { name, title, department, phone, email } = req.body || {}
  if (!name) return reply.code(400).send({ error: 'Name is required' })
  const contact = await prisma.directory.create({
    data: { name, title: title || '', department: department || '', phone: phone || '', email: email || '' },
  })
  return { message: 'Contact added', id: contact.id }
})

fastify.delete('/directory/:id', { preHandler: requireAdmin }, async (req) => {
  await prisma.directory.delete({ where: { id: parseInt(req.params.id) } })
  return { message: 'Contact removed' }
})

// ── Search ────────────────────────────────────────────────────────────────────

fastify.get('/search', async (req) => {
  const raw = (req.query.q || '').trim()
  if (!raw) return { posts: [], resources: [], schedules: [], directory: [] }

  const [posts, resources, schedules, directory] = await Promise.all([
    prisma.post.findMany({
      where:   { status: 'approved', OR: [{ title: { contains: raw, mode: 'insensitive' } }, { content: { contains: raw, mode: 'insensitive' } }] },
      orderBy: { createdAt: 'desc' }, take: 10,
      select:  { id: true, title: true, content: true, createdAt: true },
    }),
    prisma.resource.findMany({
      where:   { OR: [{ title: { contains: raw, mode: 'insensitive' } }, { category: { contains: raw, mode: 'insensitive' } }] },
      orderBy: { createdAt: 'desc' }, take: 10,
      select:  { id: true, title: true, category: true, filename: true, originalName: true },
    }),
    prisma.schedule.findMany({
      where:   { OR: [{ title: { contains: raw, mode: 'insensitive' } }, { department: { contains: raw, mode: 'insensitive' } }] },
      orderBy: { createdAt: 'desc' }, take: 10,
      select:  { id: true, title: true, department: true, weekOf: true, filename: true, originalName: true },
    }),
    prisma.directory.findMany({
      where:   { OR: [
        { name:       { contains: raw, mode: 'insensitive' } },
        { title:      { contains: raw, mode: 'insensitive' } },
        { department: { contains: raw, mode: 'insensitive' } },
        { phone:      { contains: raw, mode: 'insensitive' } },
        { email:      { contains: raw, mode: 'insensitive' } },
      ] },
      orderBy: { name: 'asc' }, take: 20,
      select:  { id: true, name: true, title: true, department: true, phone: true, email: true },
    }),
  ])

  return {
    posts:     posts.map(p => ({ id: p.id, title: p.title, content: p.content, created_at: p.createdAt })),
    resources: resources.map(r => ({ id: r.id, title: r.title, category: r.category, filename: r.filename, original_name: r.originalName })),
    schedules: schedules.map(s => ({ id: s.id, title: s.title, department: s.department, week_of: s.weekOf, filename: s.filename, original_name: s.originalName })),
    directory,
  }
})

// ── IT Tickets ────────────────────────────────────────────────────────────────

fastify.post('/it-request', async (req, reply) => {
  const { ticket_type, name, department, phone, subject, description, priority, equipment_type, equipment_detail } = req.body || {}
  if (!name?.trim())        return reply.code(400).send({ error: 'Your name is required' })
  if (!description?.trim()) return reply.code(400).send({ error: 'Description is required' })
  if (!['support', 'equipment'].includes(ticket_type)) return reply.code(400).send({ error: 'Invalid request type' })

  await prisma.itTicket.create({
    data: {
      ticketType:      ticket_type,
      name:            name.trim(),
      department:      department?.trim()      || null,
      phone:           phone?.trim()           || null,
      subject:         (subject || (ticket_type === 'equipment' ? `Equipment request: ${equipment_type}` : 'Support request')).trim(),
      description:     description.trim(),
      priority:        priority                || 'normal',
      equipmentType:   equipment_type?.trim()  || null,
      equipmentDetail: equipment_detail?.trim() || null,
    },
  })

  const typeLabel     = ticket_type === 'equipment' ? 'Equipment Request' : 'Technical Support Request'
  const priorityLabel = (priority || 'normal').toUpperCase()
  const bodyLines     = [
    `Type: ${typeLabel}`, `Priority: ${priorityLabel}`, ``,
    `From: ${name.trim()}`,
    ...(department?.trim() ? [`Department: ${department.trim()}`] : []),
    ...(phone?.trim()      ? [`Phone/Ext: ${phone.trim()}`]       : []),
    ``,
  ]
  if (ticket_type === 'equipment' && equipment_type) {
    bodyLines.push(`Equipment Type: ${equipment_type}`)
    if (equipment_detail?.trim()) bodyLines.push(`Model / Details: ${equipment_detail.trim()}`)
    bodyLines.push(``)
  }
  if (subject?.trim() && ticket_type === 'support') { bodyLines.push(`Subject: ${subject.trim()}`); bodyLines.push(``) }
  bodyLines.push(`Description:`, description.trim(), ``, `Submitted via The Heart Center Staff Intranet`)

  await sendMail({
    from:    'no-reply@<company-domain>',
    to:      'InfoTech@<company-domain>',
    subject: ticket_type === 'equipment'
      ? `[Equipment Request] ${equipment_type ? equipment_type[0].toUpperCase() + equipment_type.slice(1) : ''} — ${name.trim()}`
      : `[IT Support] ${subject?.trim() || 'Support Request'} — ${name.trim()} (${priorityLabel})`,
    text:    bodyLines.join('\n'),
  })
  return { success: true }
})

// ── Spotlight nominations ─────────────────────────────────────────────────────

fastify.post('/spotlight/nominations', async (req, reply) => {
  const { nominee_name, nominee_title, nominee_department, reason, submitted_by } = req.body || {}
  if (!nominee_name?.trim()) return reply.code(400).send({ error: 'Nominee name is required' })
  if (!reason?.trim())       return reply.code(400).send({ error: 'Reason is required' })
  await prisma.spotlightNomination.create({
    data: {
      nomineeName:       nominee_name.trim(),
      nomineeTitle:      nominee_title?.trim()      || null,
      nomineeDepartment: nominee_department?.trim() || null,
      reason:            reason.trim(),
      submittedBy:       submitted_by?.trim()       || 'Anonymous',
    },
  })
  return { success: true }
})

fastify.get('/admin/spotlight/nominations', { preHandler: requireApprover }, async () => {
  const nominations = await prisma.spotlightNomination.findMany({ orderBy: { createdAt: 'desc' } })
  return nominations.map(fmtNomination)
})

fastify.delete('/admin/spotlight/nominations/:id', { preHandler: requireApprover }, async (req) => {
  await prisma.spotlightNomination.delete({ where: { id: parseInt(req.params.id) } })
  await audit(req, 'nomination_dismissed', `Nomination #${req.params.id}`)
  return { success: true }
})

fastify.get('/admin/spotlight/nominations/:id', { preHandler: requireApprover }, async (req, reply) => {
  const nom = await prisma.spotlightNomination.findUnique({ where: { id: parseInt(req.params.id) } })
  if (!nom) return reply.code(404).send({ error: 'Not found' })
  return fmtNomination(nom)
})

// ── Signup sheets ─────────────────────────────────────────────────────────────

fastify.get('/signup-sheets', async () => {
  const sheets = await prisma.signupSheet.findMany({
    orderBy: [{ eventDate: 'asc' }, { createdAt: 'desc' }],
    include: { entries: { select: { isWaitlist: true } } },
  })
  return sheets.map(({ entries, ...s }) => ({
    ...fmtSheet(s),
    filled_slots:   entries.filter(e => !e.isWaitlist).length,
    waitlist_count: entries.filter(e =>  e.isWaitlist).length,
  }))
})

fastify.get('/signup-sheets/:id', async (req, reply) => {
  const id    = parseInt(req.params.id)
  const sheet = await prisma.signupSheet.findUnique({
    where:   { id },
    include: { entries: { orderBy: [{ isWaitlist: 'asc' }, { signedUpAt: 'asc' }] } },
  })
  if (!sheet) return reply.code(404).send({ error: 'Not found' })
  const { entries, ...s } = sheet
  return {
    ...fmtSheet(s),
    filled_slots:   entries.filter(e => !e.isWaitlist).length,
    waitlist_count: entries.filter(e =>  e.isWaitlist).length,
    entries:        entries.map(fmtEntry),
  }
})

fastify.post('/signup-sheets/:id/signup', async (req, reply) => {
  const id    = parseInt(req.params.id)
  const sheet = await prisma.signupSheet.findUnique({
    where:   { id },
    include: { entries: { where: { isWaitlist: false }, select: { id: true } } },
  })
  if (!sheet)       return reply.code(404).send({ error: 'Sheet not found' })
  if (!sheet.isOpen) return reply.code(400).send({ error: 'This sign-up sheet is closed' })
  if (sheet.deadline && new Date() > new Date(sheet.deadline))
    return reply.code(400).send({ error: 'The sign-up deadline has passed' })

  const { name, department, notes } = req.body || {}
  if (!name?.trim()) return reply.code(400).send({ error: 'Name is required' })

  const isFull = sheet.maxSlots > 0 && sheet.entries.length >= sheet.maxSlots
  if (isFull && !sheet.allowWaitlist) return reply.code(400).send({ error: 'This event is full' })

  await prisma.signupEntry.create({
    data: { sheetId: id, name: name.trim(), department: department?.trim() || null, notes: notes?.trim() || null, isWaitlist: isFull },
  })
  return { success: true, waitlisted: isFull }
})

fastify.post('/signup-sheets', { preHandler: requireAdmin }, async (req, reply) => {
  const b = req.body || {}
  if (!b.title?.trim()) return reply.code(400).send({ error: 'Title is required' })
  const u     = req.session.user
  const sheet = await prisma.signupSheet.create({
    data: {
      title:             b.title.trim(),
      description:       b.description?.trim()     || null,
      eventType:         b.event_type               || 'single',
      eventDate:         b.event_date               || null,
      endDate:           b.end_date                 || null,
      recurrencePattern: b.recurrence_pattern       || null,
      recurrenceDays:    b.recurrence_days           || null,
      recurrenceEndDate: b.recurrence_end_date      || null,
      deadline:          b.deadline                 || null,
      location:          b.location?.trim()         || null,
      maxSlots:          parseInt(b.max_slots)      || 0,
      allowWaitlist:     Boolean(b.allow_waitlist),
      createdBy:         u.id,
      createdByName:     u.username,
    },
  })
  await audit(req, 'sheet_created', b.title.trim())
  return { id: sheet.id }
})

fastify.patch('/signup-sheets/:id', { preHandler: requireAdmin }, async (req, reply) => {
  const id    = parseInt(req.params.id)
  const sheet = await prisma.signupSheet.findUnique({ where: { id } })
  if (!sheet) return reply.code(404).send({ error: 'Not found' })
  const b = req.body || {}
  await prisma.signupSheet.update({
    where: { id },
    data: {
      title:             b.title              ?? sheet.title,
      description:       b.description        ?? sheet.description,
      eventType:         b.event_type         ?? sheet.eventType,
      eventDate:         b.event_date         ?? sheet.eventDate,
      endDate:           b.end_date           ?? sheet.endDate,
      recurrencePattern: b.recurrence_pattern ?? sheet.recurrencePattern,
      recurrenceDays:    b.recurrence_days    ?? sheet.recurrenceDays,
      recurrenceEndDate: b.recurrence_end_date ?? sheet.recurrenceEndDate,
      deadline:          b.deadline           ?? sheet.deadline,
      location:          b.location           ?? sheet.location,
      maxSlots:          b.max_slots     !== undefined ? parseInt(b.max_slots)        : sheet.maxSlots,
      allowWaitlist:     b.allow_waitlist !== undefined ? Boolean(b.allow_waitlist)   : sheet.allowWaitlist,
      isOpen:            b.is_open        !== undefined ? Boolean(b.is_open)          : sheet.isOpen,
    },
  })
  await audit(req, 'sheet_updated', sheet.title)
  return { success: true }
})

fastify.delete('/signup-sheets/:id', { preHandler: requireApprover }, async (req, reply) => {
  const id    = parseInt(req.params.id)
  const sheet = await prisma.signupSheet.findUnique({ where: { id } })
  if (!sheet) return reply.code(404).send({ error: 'Not found' })
  await prisma.signupSheet.delete({ where: { id } })
  await audit(req, 'sheet_deleted', sheet.title)
  return { success: true }
})

fastify.delete('/signup-sheets/:id/entries/:entryId', { preHandler: requireApprover }, async (req) => {
  await prisma.signupEntry.deleteMany({
    where: { id: parseInt(req.params.entryId), sheetId: parseInt(req.params.id) },
  })
  return { success: true }
})

fastify.get('/signup-sheets/:id/export', { preHandler: requireAdmin }, async (req, reply) => {
  const id    = parseInt(req.params.id)
  const sheet = await prisma.signupSheet.findUnique({ where: { id } })
  if (!sheet) return reply.code(404).send({ error: 'Not found' })
  const entries = await prisma.signupEntry.findMany({
    where:   { sheetId: id },
    orderBy: [{ isWaitlist: 'asc' }, { signedUpAt: 'asc' }],
  })
  const esc  = v => `"${(v || '').toString().replace(/"/g, '""')}"`
  const rows = [
    ['Name', 'Department', 'Notes', 'Status', 'Signed Up At'].map(esc).join(','),
    ...entries.map(e => [e.name, e.department, e.notes, e.isWaitlist ? 'Waitlist' : 'Confirmed', e.signedUpAt].map(esc).join(',')),
  ]
  reply.header('Content-Type', 'text/csv')
  reply.header('Content-Disposition', `attachment; filename="signups-${id}.csv"`)
  return reply.send(rows.join('\n'))
})

// ── Startup seeding ───────────────────────────────────────────────────────────
async function seed() {
  for (const dir of ['/uploads/posts', '/uploads/resources', '/uploads/schedules', '/uploads/spotlight']) {
    fs.mkdirSync(dir, { recursive: true })
  }

  const adminExists = await prisma.user.findUnique({ where: { username: 'admin' } })
  if (!adminExists) {
    const seedPw = process.env.INITIAL_ADMIN_PASSWORD
    if (!seedPw) {
      console.error('FATAL: INITIAL_ADMIN_PASSWORD not set — cannot seed admin.')
      process.exit(1)
    }
    const hash = await bcrypt.hash(seedPw, 10)
    await prisma.user.create({ data: { username: 'admin', passwordHash: hash, role: 'superadmin' } })
    console.log('Created default admin account')
  }

  const defaults = {
    site_name:     'Heart Center',
    site_subtitle: 'Home Page',
    hero_title:    'Welcome to the Heart Center Staff Portal',
    hero_subtitle: 'Access company announcements, weekly schedules, policies, staff resources, HR documents, and internal support tools from one central location.',
    active_theme:  'default',
    banner_enabled: '0',
    banner_text:    '',
    banner_color:   'info',
  }
  for (const [key, value] of Object.entries(defaults)) {
    await prisma.siteSetting.upsert({ where: { key }, update: {}, create: { key, value } })
  }

  const dirCount = await prisma.directory.count()
  if (dirCount === 0) {
    await prisma.directory.createMany({
      data: [
        { name: 'John Test',       title: 'Cardiovascular Technician',    department: 'Cath Lab',               phone: 'Ext. 1001', email: 'john.test@heartcenter.local' },
        { name: 'Jane Smith',      title: 'Patient Services Coordinator', department: 'Administration',         phone: 'Ext. 1002', email: 'jane.smith@heartcenter.local' },
        { name: 'Mike Johnson',    title: 'IT Systems Administrator',     department: 'Information Technology', phone: 'Ext. 1200', email: 'mike.johnson@heartcenter.local' },
        { name: 'Sarah Williams',  title: 'Registered Nurse',             department: 'Cardiology',             phone: 'Ext. 1101', email: 'sarah.williams@heartcenter.local' },
        { name: 'David Brown',     title: 'Clinical Manager',             department: 'Cardiology',             phone: 'Ext. 1100', email: 'david.brown@heartcenter.local' },
        { name: 'Lisa Garcia',     title: 'HR Generalist',                department: 'Human Resources',        phone: 'Ext. 1300', email: 'lisa.garcia@heartcenter.local' },
        { name: 'Robert Martinez', title: 'Biomedical Equipment Tech',    department: 'Biomed',                 phone: 'Ext. 1400', email: 'robert.martinez@heartcenter.local' },
        { name: 'Karen Davis',     title: 'Medical Receptionist',         department: 'Front Desk',             phone: 'Ext. 1000', email: 'karen.davis@heartcenter.local' },
        { name: 'James Wilson',    title: 'Cardiovascular Sonographer',   department: 'Echo Lab',               phone: 'Ext. 1050', email: 'james.wilson@heartcenter.local' },
        { name: 'Emily Taylor',    title: 'Scheduling Coordinator',       department: 'Administration',         phone: 'Ext. 1003', email: 'emily.taylor@heartcenter.local' },
        { name: 'Tom Anderson',    title: 'Network Administrator',        department: 'Information Technology', phone: 'Ext. 1201', email: 'tom.anderson@heartcenter.local' },
        { name: 'Nancy Thomas',    title: 'Benefits Coordinator',         department: 'Human Resources',        phone: 'Ext. 1301', email: 'nancy.thomas@heartcenter.local' },
      ],
    })
    console.log('Seeded directory with test contacts')
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────
async function start() {
  try {
    await seed()
    await fastify.listen({ port: 3000, host: '0.0.0.0' })
    console.log('Fastify backend running on port 3000')
  } catch (err) {
    fastify.log.error(err)
    await prisma.$disconnect()
    process.exit(1)
  }
}

start()
