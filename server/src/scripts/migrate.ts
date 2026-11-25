import { runMigrations } from '../db/migrate.js';
import { pool } from '../db/pool.js';
runMigrations().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
