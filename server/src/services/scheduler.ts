import cron, { type ScheduledTask } from 'node-cron';
import { config } from '../config.js';
import { istDate } from '../lib/time.js';
import { runBackup } from './backup.js';
import { expireStale } from './orders.js';
import { catchUpDailyReports, generateDailyReport } from './reports/reports.js';
import { getSettings } from './settings.js';

let reportTask: ScheduledTask | null = null;
const tasks: ScheduledTask[] = [];

/** (Re)schedule the End-of-Day report at the configured IST time (default 23:59). */
export async function scheduleDailyReport() {
  const s = await getSettings();
  const [h, m] = s.report_time.split(':').map(Number);
  reportTask?.stop();
  reportTask = cron.schedule(`${m} ${h} * * *`, async () => {
    try {
      await generateDailyReport(istDate(), 'scheduler');
      console.log('[eod] daily report generated for', istDate());
    } catch (e) {
      console.error('[eod] failed', e);
    }
  }, { timezone: config.timezone });
}

export async function startScheduler() {
  await scheduleDailyReport();
  tasks.push(cron.schedule('* * * * *', () => { expireStale().catch((e) => console.error('[expire]', e)); }));
  tasks.push(cron.schedule(config.backupCron, () => {
    runBackup().then((b) => console.log('[backup] created', b.file)).catch((e) => console.error('[backup] failed', e.message));
  }, { timezone: config.timezone }));
  catchUpDailyReports().catch((e) => console.error('[eod] catch-up failed', e));
}

export function stopScheduler() {
  reportTask?.stop();
  tasks.forEach((t) => t.stop());
}
