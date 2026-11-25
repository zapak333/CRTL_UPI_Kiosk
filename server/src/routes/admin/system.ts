import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config.js';
import { pool } from '../../db/pool.js';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { ah, idParam, parse } from '../../lib/validate.js';
import { actorOf, requirePerm } from '../../middleware/auth.js';
import { listBackups, runBackup } from '../../services/backup.js';
import { activeProvider } from '../../services/payments/index.js';
import { getPrinterSettings, testPrint } from '../../services/printing/printService.js';
import { scheduleDailyReport } from '../../services/scheduler.js';
import { getSettings, settingsSchema, updateSettings } from '../../services/settings.js';
import { passwordSchema } from './auth.js';

export const systemRouter = Router();

// ---------------- settings ----------------
systemRouter.get('/settings', requirePerm('dashboard.view'), ah(async (_req, res) => {
  const p = activeProvider();
  res.json({
    settings: await getSettings(),
    // Gateway secrets live in the server's .env file only; never sent to the browser or stored in the DB.
    payment: {
      provider: p.name,
      testMode: p.isTestMode,
      razorpayKeyId: config.payment.razorpayKeyId ? config.payment.razorpayKeyId.slice(0, 12) + '…' : null,
      razorpaySecretConfigured: !!config.payment.razorpayKeySecret,
      webhookSecretConfigured: p.name === 'razorpay' ? !!config.payment.razorpayWebhookSecret : true,
      webhookUrl: `${config.publicUrl}/api/webhooks/${p.name}`,
      qrTtlMinutes: config.payment.qrTtlMinutes,
    },
  });
}));

systemRouter.put('/settings', requirePerm('settings.manage'), ah(async (req, res) => {
  const patch = parse(settingsSchema.partial(), req.body);
  const before = await getSettings();
  const s = await updateSettings(patch, req.session.admin!.id);
  if (patch.report_time && patch.report_time !== before.report_time) await scheduleDailyReport();
  const changed: Record<string, unknown> = {};
  for (const k of Object.keys(patch)) changed[k] = { from: (before as any)[k], to: (s as any)[k] };
  await audit(actorOf(req), 'settings.updated', 'settings', null, changed);
  res.json(s);
}));

// ---------------- printer ----------------
const printerSchema = z.object({
  driver: z.enum(['mock', 'network', 'device']),
  network_host: z.string().max(120).regex(/^[A-Za-z0-9.-]*$/, 'Invalid host').nullable(),
  network_port: z.number().int().min(1).max(65535),
  device_path: z.string().max(200).nullable(),
  chars_per_line: z.number().int().min(32).max(64),
  auto_print: z.boolean(),
  cut_paper: z.boolean(),
  open_drawer: z.boolean(),
  check_status: z.boolean(),
  mock_fail: z.boolean(),
  timeout_ms: z.number().int().min(1000).max(30000),
}).partial();

systemRouter.get('/printer', requirePerm('printer.manage'), ah(async (_req, res) => {
  const { rows: recent } = await pool.query(
    `SELECT p.id, p.kind, p.status, p.last_error, p.created_at, o.order_number FROM print_jobs p LEFT JOIN orders o ON o.id=p.order_id ORDER BY p.id DESC LIMIT 15`,
  );
  res.json({ settings: await getPrinterSettings(), recent });
}));

systemRouter.put('/printer', requirePerm('printer.manage'), ah(async (req, res) => {
  const b = parse(printerSchema, req.body);
  const cur = await getPrinterSettings();
  const n = { ...cur, ...b };
  if (n.driver === 'device' && n.device_path && !/^(\/dev\/[A-Za-z0-9/_.-]+|\\\\[^\s]+|[A-Z]:\\[^\s]+|LPT\d|COM\d+)$/i.test(n.device_path))
    throw badRequest('Device path must look like /dev/usb/lp0, \\\\localhost\\PrinterShare, LPT1 or COM3');
  const { rows } = await pool.query(
    `UPDATE printer_settings SET driver=$1, network_host=$2, network_port=$3, device_path=$4, chars_per_line=$5, auto_print=$6, cut_paper=$7,
            open_drawer=$8, check_status=$9, mock_fail=$10, timeout_ms=$11, updated_at=now() WHERE id=1 RETURNING *`,
    [n.driver, n.network_host, n.network_port, n.device_path, n.chars_per_line, n.auto_print, n.cut_paper, n.open_drawer, n.check_status, n.mock_fail, n.timeout_ms],
  );
  await audit(actorOf(req), 'printer.updated', 'printer', 1, b);
  res.json(rows[0]);
}));

systemRouter.post('/printer/test', requirePerm('printer.manage'), ah(async (req, res) => {
  res.json(await testPrint(actorOf(req)));
}));

// ---------------- users ----------------
const roleSchema = z.enum(['superadmin', 'admin', 'staff']);
systemRouter.get('/users', requirePerm('users.manage'), ah(async (_req, res) => {
  const { rows } = await pool.query('SELECT id, username, full_name, role, is_active, last_login_at, locked_until, created_at FROM admin_users ORDER BY id');
  res.json(rows);
}));

systemRouter.post('/users', requirePerm('users.manage'), ah(async (req, res) => {
  const b = parse(z.object({ username: z.string().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/), fullName: z.string().max(120).default(''), role: roleSchema, password: passwordSchema }), req.body);
  try {
    const { rows } = await pool.query(
      `INSERT INTO admin_users (username, full_name, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id, username, full_name, role, is_active`,
      [b.username.toLowerCase(), b.fullName, await bcrypt.hash(b.password, 12), b.role],
    );
    await audit(actorOf(req), 'user.created', 'admin_user', rows[0].id, { username: b.username, role: b.role });
    res.status(201).json(rows[0]);
  } catch (e: any) {
    if (e.code === '23505') throw conflict('Username already exists');
    throw e;
  }
}));

systemRouter.put('/users/:id', requirePerm('users.manage'), ah(async (req, res) => {
  const id = idParam(req);
  const b = parse(z.object({ fullName: z.string().max(120).optional(), role: roleSchema.optional(), isActive: z.boolean().optional(), password: passwordSchema.optional(), unlock: z.boolean().optional() }), req.body);
  const { rows: cur } = await pool.query('SELECT * FROM admin_users WHERE id=$1', [id]);
  if (!cur[0]) throw notFound();
  if (id === req.session.admin!.id && (b.role && b.role !== 'superadmin' || b.isActive === false)) throw badRequest('You cannot demote or deactivate your own account');
  if ((b.role && b.role !== 'superadmin') || b.isActive === false) {
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM admin_users WHERE role='superadmin' AND is_active AND id<>$1`, [id]);
    if (cur[0].role === 'superadmin' && rows[0].n === 0) throw badRequest('At least one active superadmin is required');
  }
  await pool.query(
    `UPDATE admin_users SET full_name=coalesce($2,full_name), role=coalesce($3,role), is_active=coalesce($4,is_active),
            password_hash=coalesce($5,password_hash), locked_until=CASE WHEN $6 THEN NULL ELSE locked_until END,
            failed_attempts=CASE WHEN $6 THEN 0 ELSE failed_attempts END, updated_at=now() WHERE id=$1`,
    [id, b.fullName ?? null, b.role ?? null, b.isActive ?? null, b.password ? await bcrypt.hash(b.password, 12) : null, !!b.unlock],
  );
  if (b.isActive === false || b.password || b.role) await pool.query(`DELETE FROM admin_sessions WHERE (sess->'admin'->>'id')::int = $1`, [id]);
  await audit(actorOf(req), 'user.updated', 'admin_user', id, { ...b, password: b.password ? '[changed]' : undefined });
  res.json({ ok: true });
}));

// ---------------- audit log ----------------
systemRouter.get('/audit', requirePerm('audit.view'), ah(async (req, res) => {
  const q = parse(z.object({ action: z.string().max(60).optional(), page: z.coerce.number().int().min(1).default(1) }), req.query);
  const { rows } = await pool.query(
    `SELECT id, actor_type, actor_name, action, entity_type, entity_id, details, ip_address, created_at FROM audit_logs
      WHERE ($1::text IS NULL OR action ILIKE $1) ORDER BY id DESC LIMIT 100 OFFSET $2`,
    [q.action ? `%${q.action}%` : null, (q.page - 1) * 100],
  );
  res.json(rows);
}));

systemRouter.get('/payment-events', requirePerm('audit.view'), ah(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, provider, provider_event_id, event_type, payment_id, signature_valid, processing_result, received_at FROM payment_events ORDER BY id DESC LIMIT 200`,
  );
  res.json(rows);
}));

// ---------------- backups ----------------
systemRouter.get('/backups', requirePerm('backup.manage'), ah(async (_req, res) => {
  res.json({ dir: config.backupDir, keepDays: config.backupKeepDays, schedule: config.backupCron, backups: await listBackups() });
}));
systemRouter.post('/backups', requirePerm('backup.manage'), ah(async (req, res) => {
  res.json(await runBackup(actorOf(req)));
}));
