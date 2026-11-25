import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../../config.js';
import { pool } from '../../db/pool.js';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict, forbidden, HttpError, unauthorized } from '../../lib/errors.js';
import { ah, parse } from '../../lib/validate.js';
import { can, permissions, type Role } from '../../middleware/auth.js';
import { getSettings } from '../../services/settings.js';

export const authRouter = Router();

export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128)
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Password must contain letters and numbers');
const usernameSchema = z.string().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/, 'Letters, numbers, dot, dash, underscore only');

const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: config.isTest ? 1000 : 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many login attempts. Try again later.' } });

async function adminCount() {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM admin_users');
  return rows[0].n as number;
}

function tokenOk(given: string) {
  const a = Buffer.from(given);
  const b = Buffer.from(config.adminSetupToken);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** First-run setup: only available while there are no admin users, and only with the setup token. */
authRouter.get('/setup/status', ah(async (_req, res) => {
  res.json({ needsSetup: (await adminCount()) === 0 });
}));

authRouter.post('/setup', loginLimiter, ah(async (req, res) => {
  const body = parse(z.object({ setupToken: z.string().max(200), username: usernameSchema, fullName: z.string().max(120).default(''), password: passwordSchema }), req.body);
  if ((await adminCount()) > 0) throw conflict('Setup has already been completed');
  if (!tokenOk(body.setupToken)) throw forbidden('Invalid setup token');
  const hash = await bcrypt.hash(body.password, 12);
  const { rows } = await pool.query(
    `INSERT INTO admin_users (username, full_name, password_hash, role) VALUES ($1,$2,$3,'superadmin') RETURNING id`,
    [body.username.toLowerCase(), body.fullName, hash],
  );
  await audit({ type: 'admin', id: rows[0].id, name: body.username, ip: req.ip }, 'admin.setup_completed', 'admin_user', rows[0].id);
  res.status(201).json({ ok: true });
}));

const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

authRouter.post('/login', loginLimiter, ah(async (req, res) => {
  const body = parse(z.object({ username: z.string().max(64), password: z.string().max(128) }), req.body);
  const { rows } = await pool.query('SELECT * FROM admin_users WHERE username = $1', [body.username.toLowerCase()]);
  const u = rows[0];
  const fail = async (reason: string) => {
    await audit({ type: 'admin', id: u?.id ?? null, name: body.username, ip: req.ip }, 'auth.login_failed', 'admin_user', u?.id ?? null, { reason });
    throw unauthorized('Invalid username or password');
  };
  if (!u) {
    await bcrypt.compare(body.password, '$2a$12$C6UzMDM.H6dfI/f/IKcEeO5Q1Q6Q6Q6Q6Q6Q6Q6Q6Q6Q6Q6Q6Q6'); // constant-ish timing
    return fail('unknown_user');
  }
  if (!u.is_active) return fail('inactive');
  if (u.locked_until && new Date(u.locked_until) > new Date()) {
    await audit({ type: 'admin', id: u.id, name: u.username, ip: req.ip }, 'auth.login_locked', 'admin_user', u.id);
    throw new HttpError(423, `Account locked after repeated failed logins. Try again after ${LOCK_MINUTES} minutes.`, 'locked');
  }
  const ok = await bcrypt.compare(body.password, u.password_hash);
  if (!ok) {
    const fails = u.failed_attempts + 1;
    await pool.query(
      `UPDATE admin_users SET failed_attempts=$2, locked_until=CASE WHEN $3 THEN now() + interval '${LOCK_MINUTES} minutes' ELSE locked_until END WHERE id=$1`,
      [u.id, fails >= MAX_FAILS ? 0 : fails, fails >= MAX_FAILS],
    );
    return fail('bad_password');
  }
  await pool.query('UPDATE admin_users SET failed_attempts=0, locked_until=NULL, last_login_at=now() WHERE id=$1', [u.id]);
  const s = await getSettings();
  await new Promise<void>((resolve, reject) => req.session.regenerate((e) => (e ? reject(e) : resolve()))); // prevent session fixation
  req.session.admin = { id: u.id, username: u.username, role: u.role as Role, fullName: u.full_name };
  req.session.cookie.maxAge = s.admin_session_timeout_minutes * 60_000; // idle timeout (rolling)
  await audit({ type: 'admin', id: u.id, name: u.username, ip: req.ip }, 'auth.login', 'admin_user', u.id);
  res.json({ user: me(req.session.admin) });
}));

authRouter.post('/logout', ah(async (req, res) => {
  const a = req.session.admin;
  if (a) await audit({ type: 'admin', id: a.id, name: a.username, ip: req.ip }, 'auth.logout', 'admin_user', a.id);
  await new Promise<void>((resolve) => req.session.destroy(() => resolve()));
  res.clearCookie('crtl.sid');
  res.json({ ok: true });
}));

authRouter.get('/me', (req, res) => {
  if (!req.session.admin) return res.status(401).json({ error: 'Not signed in' });
  res.json({ user: me(req.session.admin) });
});

authRouter.post('/change-password', ah(async (req, res) => {
  const a = req.session.admin;
  if (!a) throw unauthorized();
  const body = parse(z.object({ currentPassword: z.string().max(128), newPassword: passwordSchema }), req.body);
  const { rows } = await pool.query('SELECT password_hash FROM admin_users WHERE id=$1', [a.id]);
  if (!(await bcrypt.compare(body.currentPassword, rows[0].password_hash))) throw badRequest('Current password is incorrect');
  await pool.query('UPDATE admin_users SET password_hash=$2, updated_at=now() WHERE id=$1', [a.id, await bcrypt.hash(body.newPassword, 12)]);
  await audit({ type: 'admin', id: a.id, name: a.username, ip: req.ip }, 'auth.password_changed', 'admin_user', a.id);
  res.json({ ok: true });
}));

function me(a: NonNullable<import('express-session').SessionData['admin']>) {
  const perms = Object.keys(permissions).filter((p) => can(a.role, p as keyof typeof permissions));
  return { ...a, permissions: perms };
}
