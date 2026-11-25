import bcrypt from 'bcryptjs';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { runMigrations } from '../db/migrate.js';
import { pool } from '../db/pool.js';
import { passwordSchema } from '../routes/admin/auth.js';

/** Interactive creation of an administrator from the server console (no default credentials anywhere). */
async function main() {
  await runMigrations(false);
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const username = (await rl.question('Username: ')).trim().toLowerCase();
  const fullName = (await rl.question('Full name: ')).trim();
  const role = ((await rl.question('Role [superadmin/admin/staff] (superadmin): ')).trim() || 'superadmin');
  const password = await rl.question('Password (min 10 chars, letters + numbers): ');
  rl.close();
  if (!/^[a-z0-9._-]{3,64}$/.test(username)) throw new Error('Invalid username');
  if (!['superadmin', 'admin', 'staff'].includes(role)) throw new Error('Invalid role');
  const pw = passwordSchema.safeParse(password);
  if (!pw.success) throw new Error(pw.error.issues[0].message);
  await pool.query(`INSERT INTO admin_users (username, full_name, password_hash, role) VALUES ($1,$2,$3,$4)`, [username, fullName, await bcrypt.hash(password, 12), role]);
  console.log(`Created ${role} "${username}".`);
  await pool.end();
}
main().catch((e) => { console.error('Error:', e.message); process.exit(1); });
