import { config } from './config.js';
import { createApp } from './app.js';
import { pool } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { startScheduler, stopScheduler } from './services/scheduler.js';

async function main() {
  if (!config.sessionSecret || (config.isProd && config.sessionSecret.length < 32)) {
    console.error('SESSION_SECRET must be set (32+ random characters in production). See .env.example');
    process.exit(1);
  }
  await runMigrations();
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM admin_users');
  if (rows[0].n === 0) {
    console.log('\n============================================================');
    console.log(' No administrator exists yet. Open /admin/setup and use this');
    console.log(` one-time setup token: ${config.adminSetupToken}`);
    console.log(' (or run: npm run create-admin)');
    console.log('============================================================\n');
  }
  if (config.isProd && config.payment.provider === 'simulated') console.warn('[warn] PAYMENT_PROVIDER=simulated in production: payments are NOT real.');
  await startScheduler();
  const app = createApp();
  const server = app.listen(config.port, () => console.log(`CRTL Canteen Kiosk listening on http://localhost:${config.port} (payments: ${config.payment.provider})`));
  const shutdown = () => {
    console.log('Shutting down…');
    stopScheduler();
    server.close(() => pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error('Fatal startup error', e);
  process.exit(1);
});
