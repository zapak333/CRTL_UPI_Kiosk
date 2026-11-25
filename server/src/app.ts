import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import connectPg from 'connect-pg-simple';
import express, { type NextFunction, type Request, type Response } from 'express';
import session from 'express-session';
import helmet from 'helmet';
import { config, uploadsDir } from './config.js';
import { pool } from './db/pool.js';
import { HttpError } from './lib/errors.js';
import { adminIpGuard, csrfGuard, requireAdmin } from './middleware/auth.js';
import { authRouter } from './routes/admin/auth.js';
import { menuRouter } from './routes/admin/menu.js';
import { ordersRouter } from './routes/admin/orders.js';
import { reportsRouter } from './routes/admin/reports.js';
import { systemRouter } from './routes/admin/system.js';
import { kioskRouter } from './routes/kiosk.js';
import { simulatorRouter } from './routes/simulator.js';
import { webhookRouter } from './routes/webhooks.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'", 'data:'],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  // Webhooks need the raw body for signature verification -> mounted BEFORE the JSON parser.
  app.use('/api/webhooks', webhookRouter);
  app.use(express.json({ limit: '200kb' }));

  app.get('/api/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true, db: 'up', paymentProvider: config.payment.provider, time: new Date().toISOString() });
    } catch {
      res.status(503).json({ ok: false, db: 'down' });
    }
  });

  app.use('/api/kiosk', kioskRouter);
  if (config.payment.provider === 'simulated') app.use(simulatorRouter);

  // ---- Admin API: IP allow-list (optional) + session + CSRF header ----
  const PgStore = connectPg(session);
  const sessionMw = session({
    name: 'crtl.sid',
    store: new PgStore({ pool, tableName: 'admin_sessions', createTableIfMissing: false, pruneSessionInterval: config.isTest ? false : 600 }),
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true, // idle timeout: every request extends the session by the configured minutes
    cookie: { httpOnly: true, sameSite: 'strict', secure: config.cookieSecure, maxAge: 15 * 60_000, path: '/' },
  });
  app.use('/api/admin', adminIpGuard, sessionMw, csrfGuard);
  app.use('/api/admin/auth', authRouter);
  app.use('/api/admin/menu', requireAdmin, menuRouter);
  app.use('/api/admin/orders', requireAdmin, ordersRouter);
  app.use('/api/admin/reports', requireAdmin, reportsRouter);
  app.use('/api/admin/system', requireAdmin, systemRouter);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // ---- Static: uploaded images + built frontend ----
  fs.mkdirSync(uploadsDir, { recursive: true });
  app.use('/uploads', express.static(uploadsDir, { maxAge: '7d', fallthrough: false }));
  const sampleDir = [path.join(here, '../assets/sample'), path.join(here, '../../assets/sample')].find((d) => fs.existsSync(d));
  if (sampleDir) app.use('/sample', express.static(sampleDir, { maxAge: '7d' }));
  const webDist = [path.join(here, '../../web/dist'), path.join(here, '../../../web/dist')].find((d) => fs.existsSync(d));
  if (webDist) {
    app.use(express.static(webDist, { index: false, maxAge: '1h' }));
    app.get('/', (_req, res) => res.redirect('/kiosk'));
    app.use('/admin', adminIpGuard);
    app.get(/^\/(kiosk|admin)(\/.*)?$/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  // ---- Errors ----
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code, details: err.details });
    const e = err as any;
    if (e?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    if (e?.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Image too large (max 3 MB)' });
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });
  return app;
}
