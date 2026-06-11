#!/usr/bin/env node
/**
 * One-time migration: SQLite (intranet.db) → PostgreSQL (intranet_hci)
 *
 * Run ONCE on cutover day, after stopping the Express backend and before
 * starting the Fastify backend.
 *
 * Usage:
 *   DATABASE_URL="postgresql://intranet_app:PW@127.0.0.1:5432/intranet_hci?schema=public" \
 *   SQLITE_PATH="/srv/intranet/data/intranet.db" \
 *   node scripts/migrate-sqlite-to-pg.js
 *
 * The script is idempotent in the sense that it will fail fast if any table
 * already has rows — you must truncate manually if you need to re-run.
 */

'use strict';

const Database = require('better-sqlite3');
const { PrismaClient } = require('@prisma/client');

const SQLITE_PATH = process.env.SQLITE_PATH || '/data/intranet.db';

if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL is not set.');
  process.exit(1);
}

const sqlite = new Database(SQLITE_PATH, { readonly: true });
const prisma = new PrismaClient();

// SQLite stores dates as TEXT (ISO strings). Postgres wants Date objects.
function toDate(val) {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

// SQLite stores booleans as 0/1 integers.
function toBool(val) {
  return val === 1 || val === true;
}

async function guardEmpty(model, label) {
  const count = await prisma[model].count();
  if (count > 0) {
    console.error(`ABORT: ${label} already has ${count} rows. Truncate first.`);
    process.exit(1);
  }
}

async function migrate() {
  console.log('Connecting to SQLite:', SQLITE_PATH);
  console.log('Connecting to PostgreSQL via Prisma...\n');

  // ── 1. users ────────────────────────────────────────────────────────────────
  await guardEmpty('user', 'users');
  const users = sqlite.prepare('SELECT * FROM users').all();
  console.log(`Migrating ${users.length} users...`);
  for (const u of users) {
    await prisma.user.create({
      data: {
        id:           u.id,
        username:     u.username,
        passwordHash: u.password_hash,
        role:         u.role || 'employee',
        department:   u.department || null,
        createdAt:    toDate(u.created_at) ?? new Date(),
      },
    });
  }
  // Reset sequence so future inserts don't collide with migrated IDs.
  await prisma.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('users','id'), COALESCE(MAX(id),0)+1, false) FROM users`
  );
  console.log('  users ✓');

  // ── 2. posts ─────────────────────────────────────────────────────────────────
  await guardEmpty('post', 'posts');
  const posts = sqlite.prepare('SELECT * FROM posts').all();
  console.log(`Migrating ${posts.length} posts...`);
  for (const p of posts) {
    await prisma.post.create({
      data: {
        id:            p.id,
        title:         p.title,
        content:       p.content,
        photoFilename: p.photo_filename || null,
        videoUrl:      p.video_url || null,
        authorId:      p.author_id || null,
        status:        p.status || 'pending',
        reviewedBy:    p.reviewed_by || null,
        reviewedAt:    toDate(p.reviewed_at),
        createdAt:     toDate(p.created_at) ?? new Date(),
      },
    });
  }
  await prisma.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('posts','id'), COALESCE(MAX(id),0)+1, false) FROM posts`
  );
  console.log('  posts ✓');

  // ── 3. resources ─────────────────────────────────────────────────────────────
  await guardEmpty('resource', 'resources');
  const resources = sqlite.prepare('SELECT * FROM resources').all();
  console.log(`Migrating ${resources.length} resources...`);
  for (const r of resources) {
    await prisma.resource.create({
      data: {
        id:           r.id,
        title:        r.title,
        category:     r.category,
        filename:     r.filename,
        originalName: r.original_name,
        videoUrl:     r.video_url || null,
        uploadedBy:   r.uploaded_by || null,
        createdAt:    toDate(r.created_at) ?? new Date(),
      },
    });
  }
  await prisma.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('resources','id'), COALESCE(MAX(id),0)+1, false) FROM resources`
  );
  console.log('  resources ✓');

  // ── 4. schedules ─────────────────────────────────────────────────────────────
  await guardEmpty('schedule', 'schedules');
  const schedules = sqlite.prepare('SELECT * FROM schedules').all();
  console.log(`Migrating ${schedules.length} schedules...`);
  for (const s of schedules) {
    await prisma.schedule.create({
      data: {
        id:           s.id,
        title:        s.title,
        department:   s.department,
        weekOf:       s.week_of || null,
        filename:     s.filename,
        originalName: s.original_name,
        uploadedBy:   s.uploaded_by || null,
        createdAt:    toDate(s.created_at) ?? new Date(),
      },
    });
  }
  await prisma.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('schedules','id'), COALESCE(MAX(id),0)+1, false) FROM schedules`
  );
  console.log('  schedules ✓');

  // ── 5. spotlight ─────────────────────────────────────────────────────────────
  await guardEmpty('spotlight', 'spotlight');
  const spotlights = sqlite.prepare('SELECT * FROM spotlight').all();
  console.log(`Migrating ${spotlights.length} spotlight entries...`);
  for (const s of spotlights) {
    await prisma.spotlight.create({
      data: {
        id:            s.id,
        name:          s.name,
        title:         s.title,
        message:       s.message,
        photoFilename: s.photo_filename || null,
        updatedBy:     s.updated_by || null,
        updatedAt:     toDate(s.updated_at) ?? new Date(),
      },
    });
  }
  await prisma.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('spotlight','id'), COALESCE(MAX(id),0)+1, false) FROM spotlight`
  );
  console.log('  spotlight ✓');

  // ── 6. spotlight_nominations ─────────────────────────────────────────────────
  await guardEmpty('spotlightNomination', 'spotlight_nominations');
  const nominations = sqlite.prepare('SELECT * FROM spotlight_nominations').all();
  console.log(`Migrating ${nominations.length} spotlight nominations...`);
  for (const n of nominations) {
    await prisma.spotlightNomination.create({
      data: {
        id:                n.id,
        nomineeName:       n.nominee_name,
        nomineeTitle:      n.nominee_title || null,
        nomineeDepartment: n.nominee_department || null,
        reason:            n.reason,
        submittedBy:       n.submitted_by || null,
        status:            n.status || 'pending',
        createdAt:         toDate(n.created_at) ?? new Date(),
      },
    });
  }
  await prisma.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('spotlight_nominations','id'), COALESCE(MAX(id),0)+1, false) FROM spotlight_nominations`
  );
  console.log('  spotlight_nominations ✓');

  // ── 7. directory ─────────────────────────────────────────────────────────────
  await guardEmpty('directory', 'directory');
  const directory = sqlite.prepare('SELECT * FROM directory').all();
  console.log(`Migrating ${directory.length} directory entries...`);
  for (const d of directory) {
    await prisma.directory.create({
      data: {
        id:         d.id,
        name:       d.name,
        title:      d.title || null,
        department: d.department || null,
        phone:      d.phone || null,
        email:      d.email || null,
        createdAt:  toDate(d.created_at) ?? new Date(),
      },
    });
  }
  await prisma.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('directory','id'), COALESCE(MAX(id),0)+1, false) FROM directory`
  );
  console.log('  directory ✓');

  // ── 8. audit_log ─────────────────────────────────────────────────────────────
  await guardEmpty('auditLog', 'audit_log');
  const auditLog = sqlite.prepare('SELECT * FROM audit_log').all();
  console.log(`Migrating ${auditLog.length} audit log entries...`);
  for (const a of auditLog) {
    await prisma.auditLog.create({
      data: {
        id:        a.id,
        userId:    a.user_id || null,
        username:  a.username || null,
        action:    a.action,
        detail:    a.detail || null,
        createdAt: toDate(a.created_at) ?? new Date(),
      },
    });
  }
  await prisma.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('audit_log','id'), COALESCE(MAX(id),0)+1, false) FROM audit_log`
  );
  console.log('  audit_log ✓');

  // ── 9. site_settings ─────────────────────────────────────────────────────────
  await guardEmpty('siteSetting', 'site_settings');
  const settings = sqlite.prepare('SELECT * FROM site_settings').all();
  console.log(`Migrating ${settings.length} site settings...`);
  for (const s of settings) {
    await prisma.siteSetting.create({
      data: {
        key:       s.key,
        value:     s.value,
        updatedAt: toDate(s.updated_at) ?? new Date(),
      },
    });
  }
  console.log('  site_settings ✓');

  // ── 10. signup_sheets ────────────────────────────────────────────────────────
  await guardEmpty('signupSheet', 'signup_sheets');
  const sheets = sqlite.prepare('SELECT * FROM signup_sheets').all();
  console.log(`Migrating ${sheets.length} signup sheets...`);
  for (const s of sheets) {
    await prisma.signupSheet.create({
      data: {
        id:                s.id,
        title:             s.title,
        description:       s.description || null,
        eventType:         s.event_type || 'single',
        eventDate:         s.event_date || null,
        endDate:           s.end_date || null,
        recurrencePattern: s.recurrence_pattern || null,
        recurrenceDays:    s.recurrence_days || null,
        recurrenceEndDate: s.recurrence_end_date || null,
        deadline:          s.deadline || null,
        location:          s.location || null,
        maxSlots:          s.max_slots || 0,
        allowWaitlist:     toBool(s.allow_waitlist),
        isOpen:            toBool(s.is_open ?? 1),
        createdBy:         s.created_by || null,
        createdByName:     s.created_by_name || null,
        createdAt:         toDate(s.created_at) ?? new Date(),
      },
    });
  }
  await prisma.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('signup_sheets','id'), COALESCE(MAX(id),0)+1, false) FROM signup_sheets`
  );
  console.log('  signup_sheets ✓');

  // ── 11. signup_entries ───────────────────────────────────────────────────────
  await guardEmpty('signupEntry', 'signup_entries');
  const entries = sqlite.prepare('SELECT * FROM signup_entries').all();
  console.log(`Migrating ${entries.length} signup entries...`);
  for (const e of entries) {
    await prisma.signupEntry.create({
      data: {
        id:         e.id,
        sheetId:    e.sheet_id,
        name:       e.name,
        department: e.department || null,
        notes:      e.notes || null,
        isWaitlist: toBool(e.is_waitlist),
        signedUpAt: toDate(e.signed_up_at) ?? new Date(),
      },
    });
  }
  await prisma.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('signup_entries','id'), COALESCE(MAX(id),0)+1, false) FROM signup_entries`
  );
  console.log('  signup_entries ✓');

  // ── 12. it_tickets ───────────────────────────────────────────────────────────
  await guardEmpty('itTicket', 'it_tickets');
  const tickets = sqlite.prepare('SELECT * FROM it_tickets').all();
  console.log(`Migrating ${tickets.length} IT tickets...`);
  for (const t of tickets) {
    await prisma.itTicket.create({
      data: {
        id:              t.id,
        ticketType:      t.ticket_type,
        name:            t.name,
        department:      t.department || null,
        phone:           t.phone || null,
        subject:         t.subject,
        description:     t.description,
        priority:        t.priority || 'normal',
        equipmentType:   t.equipment_type || null,
        equipmentDetail: t.equipment_detail || null,
        status:          t.status || 'open',
        assignedTo:      t.assigned_to || null,
        resolution:      t.resolution || null,
        createdAt:       toDate(t.created_at) ?? new Date(),
        updatedAt:       toDate(t.updated_at) ?? new Date(),
      },
    });
  }
  await prisma.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('it_tickets','id'), COALESCE(MAX(id),0)+1, false) FROM it_tickets`
  );
  console.log('  it_tickets ✓');

  console.log('\n✅  Migration complete. All tables populated and sequences reset.');
}

migrate()
  .catch((err) => {
    console.error('\n❌  Migration failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    sqlite.close();
    await prisma.$disconnect();
  });
