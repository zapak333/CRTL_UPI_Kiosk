import { pool } from '../db/pool.js';
import { runBackup } from '../services/backup.js';
runBackup().then((b) => { console.log('Backup created:', b); return pool.end(); }).catch((e) => { console.error(e.message); process.exit(1); });
