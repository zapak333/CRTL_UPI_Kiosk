import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { audit, systemActor, type Actor } from '../lib/audit.js';

/** pg_dump (custom format) into BACKUP_DIR, then prune files older than BACKUP_KEEP_DAYS. */
export async function runBackup(actor: Actor = systemActor) {
  await fs.mkdir(config.backupDir, { recursive: true });
  const stamp = new Date(Date.now() + 330 * 60000).toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
  const file = path.join(config.backupDir, `crtl_kiosk_${stamp}.dump`);
  await new Promise<void>((resolve, reject) => {
    const p = spawn(process.env.PG_DUMP_PATH || 'pg_dump', ['--format=custom', '--no-owner', `--file=${file}`, config.databaseUrl], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`pg_dump failed (${code}): ${err.trim()}`))));
  });
  const stat = await fs.stat(file);
  await prune();
  await audit(actor, 'backup.created', 'backup', path.basename(file), { bytes: stat.size });
  return { file: path.basename(file), bytes: stat.size };
}

async function prune() {
  const cutoff = Date.now() - config.backupKeepDays * 86400_000;
  for (const f of await fs.readdir(config.backupDir)) {
    if (!f.endsWith('.dump')) continue;
    const st = await fs.stat(path.join(config.backupDir, f));
    if (st.mtimeMs < cutoff) await fs.unlink(path.join(config.backupDir, f));
  }
}

export async function listBackups() {
  await fs.mkdir(config.backupDir, { recursive: true });
  const out = [];
  for (const f of await fs.readdir(config.backupDir)) {
    if (!f.endsWith('.dump')) continue;
    const st = await fs.stat(path.join(config.backupDir, f));
    out.push({ file: f, bytes: st.size, createdAt: st.mtime });
  }
  return out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
