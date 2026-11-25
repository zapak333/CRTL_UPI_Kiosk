import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import type { Actor } from '../lib/audit.js';
import { forbidden, unauthorized } from '../lib/errors.js';

export type Role = 'superadmin' | 'admin' | 'staff';

declare module 'express-session' {
  interface SessionData {
    admin?: { id: number; username: string; role: Role; fullName: string };
  }
}

/** Permission matrix. superadmin: everything. admin: day-to-day management. staff: counter tasks only. */
export const permissions = {
  'dashboard.view': ['superadmin', 'admin', 'staff'],
  'orders.view': ['superadmin', 'admin', 'staff'],
  'orders.reprint': ['superadmin', 'admin', 'staff'],
  'orders.refund': ['superadmin', 'admin'],
  'menu.manage': ['superadmin', 'admin'],
  'reports.view': ['superadmin', 'admin'],
  'reports.generate': ['superadmin', 'admin'],
  'settings.manage': ['superadmin'],
  'printer.manage': ['superadmin', 'admin'],
  'users.manage': ['superadmin'],
  'audit.view': ['superadmin', 'admin'],
  'backup.manage': ['superadmin'],
} as const satisfies Record<string, Role[]>;
export type Permission = keyof typeof permissions;

export function can(role: Role | undefined, perm: Permission) {
  return !!role && (permissions[perm] as readonly Role[]).includes(role);
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.session?.admin) return next(unauthorized());
  next();
}

export function requirePerm(perm: Permission) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.session.admin) return next(unauthorized());
    if (!can(req.session.admin.role, perm)) return next(forbidden('Your role does not allow this action'));
    next();
  };
}

/**
 * CSRF defence for cookie-authenticated admin API: state-changing requests must carry a custom header,
 * which browsers will not send cross-site without a CORS preflight (and we allow no CORS).
 */
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-crtl-admin') !== '1') return next(forbidden('Missing request header'));
  next();
}

export function adminIpGuard(req: Request, res: Response, next: NextFunction) {
  if (!config.adminAllowedIps.length) return next();
  const ip = (req.ip ?? '').replace('::ffff:', '');
  if (config.adminAllowedIps.includes(ip)) return next();
  res.status(404).send('Not found');
}

export function actorOf(req: Request): Actor {
  const a = req.session?.admin;
  return a ? { type: 'admin', id: a.id, name: a.username, ip: req.ip } : { type: 'kiosk', name: 'kiosk', ip: req.ip };
}
