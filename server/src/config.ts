import 'dotenv/config';
import path from 'node:path';
import crypto from 'node:crypto';

function bool(v: string | undefined, d = false) {
  if (v === undefined || v === '') return d;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

const env = process.env;
const isTest = env.NODE_ENV === 'test';

export const config = {
  env: env.NODE_ENV ?? 'development',
  isProd: env.NODE_ENV === 'production',
  isTest,
  port: Number(env.PORT ?? 8080),
  publicUrl: env.PUBLIC_URL ?? 'http://localhost:8080',
  databaseUrl: isTest
    ? env.TEST_DATABASE_URL ?? 'postgres://crtl:crtl_dev@localhost:5432/crtl_kiosk_test'
    : env.DATABASE_URL ?? 'postgres://crtl:crtl_dev@localhost:5432/crtl_kiosk',
  sessionSecret: env.SESSION_SECRET || (isTest ? 'test-secret' : ''),
  cookieSecure: bool(env.COOKIE_SECURE),
  adminAllowedIps: (env.ADMIN_ALLOWED_IPS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  adminSetupToken: env.ADMIN_SETUP_TOKEN || crypto.randomBytes(12).toString('hex'),
  adminSetupTokenGenerated: !env.ADMIN_SETUP_TOKEN,
  payment: {
    provider: (env.PAYMENT_PROVIDER ?? 'simulated') as 'simulated' | 'razorpay',
    simulatedWebhookSecret: env.SIMULATED_WEBHOOK_SECRET || 'sim-secret-change-me',
    razorpayKeyId: env.RAZORPAY_KEY_ID ?? '',
    razorpayKeySecret: env.RAZORPAY_KEY_SECRET ?? '',
    razorpayWebhookSecret: env.RAZORPAY_WEBHOOK_SECRET ?? '',
    qrTtlMinutes: Number(env.PAYMENT_QR_TTL_MINUTES ?? 5),
  },
  dataDir: path.resolve(env.DATA_DIR ?? './data'),
  backupDir: path.resolve(env.BACKUP_DIR ?? './data/backups'),
  backupKeepDays: Number(env.BACKUP_KEEP_DAYS ?? 30),
  backupCron: env.BACKUP_CRON ?? '30 23 * * *',
  timezone: 'Asia/Kolkata',
};

export const uploadsDir = path.join(config.dataDir, 'uploads');
export const receiptsDir = path.join(config.dataDir, 'receipts');
