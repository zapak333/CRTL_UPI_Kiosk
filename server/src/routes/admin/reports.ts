import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { badRequest } from '../../lib/errors.js';
import { addDays, istDate, isValidDate } from '../../lib/time.js';
import { ah, parse } from '../../lib/validate.js';
import { actorOf, requirePerm } from '../../middleware/auth.js';
import { toCsv, toPdf, toXlsx, type CsvKind } from '../../services/reports/exporters.js';
import { dashboard, fullReport, generateDailyReport, periodBreakdown } from '../../services/reports/reports.js';

export const reportsRouter = Router();

reportsRouter.get('/dashboard', requirePerm('dashboard.view'), ah(async (_req, res) => {
  res.json(await dashboard());
}));

const rangeSchema = z.object({ from: z.string(), to: z.string().optional() });
function range(q: unknown) {
  const r = parse(rangeSchema, q);
  const to = r.to ?? r.from;
  if (!isValidDate(r.from) || !isValidDate(to)) throw badRequest('Dates must be YYYY-MM-DD');
  if (to < r.from) throw badRequest('"to" must be on or after "from"');
  if (Date.parse(to) - Date.parse(r.from) > 400 * 86400_000) throw badRequest('Range too large (max ~13 months)');
  return { from: r.from, to };
}

reportsRouter.get('/', requirePerm('reports.view'), ah(async (req, res) => {
  const { from, to } = range(req.query);
  const r = await fullReport(from, to);
  const weekly = await periodBreakdown(from, to, 'week');
  const monthly = await periodBreakdown(from, to, 'month');
  const { rows: stored } = await pool.query(`SELECT report_date, generated_at, generated_by FROM daily_reports WHERE report_date BETWEEN $1 AND $2 ORDER BY report_date`, [from, to]);
  res.json({ ...r, weekly, monthly, stored });
}));

reportsRouter.get('/export', requirePerm('reports.view'), ah(async (req, res) => {
  const { from, to } = range(req.query);
  const format = String(req.query.format ?? 'xlsx');
  const kind = String(req.query.kind ?? 'items') as CsvKind;
  const r = await fullReport(from, to);
  const base = from === to ? `crtl-sales-${from}` : `crtl-sales-${from}_to_${to}`;
  await import('../../lib/audit.js').then(({ audit }) => audit(actorOf(req), 'report.exported', 'report', `${from}..${to}`, { format, kind }));
  if (format === 'xlsx') {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.xlsx"`);
    return res.send(await toXlsx(r));
  }
  if (format === 'pdf') {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${req.query.inline ? 'inline' : 'attachment'}; filename="${base}.pdf"`);
    return res.send(await toPdf(r));
  }
  if (format === 'csv') {
    if (!['summary', 'items', 'daily', 'transactions', 'failures', 'refunds'].includes(kind)) throw badRequest('Unknown CSV report');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${base}-${kind}.csv"`);
    return res.send(toCsv(r, kind));
  }
  throw badRequest('format must be xlsx, pdf or csv');
}));

/** Stored End-of-Day reports (auto-generated at the configured time, IST). */
reportsRouter.get('/daily', requirePerm('reports.view'), ah(async (req, res) => {
  const to = isValidDate(req.query.to) ? req.query.to : istDate();
  const from = isValidDate(req.query.from) ? req.query.from : addDays(to, -60);
  const { rows } = await pool.query(
    `SELECT report_date, total_orders, total_items_sold, successful_txns, total_collection::text, failed_payments, pending_payments,
            cancelled_orders, total_refunds::text, net_collection::text, generated_by, generated_at
       FROM daily_reports WHERE report_date BETWEEN $1 AND $2 ORDER BY report_date DESC`,
    [from, to],
  );
  res.json(rows);
}));

reportsRouter.post('/daily/:date/generate', requirePerm('reports.generate'), ah(async (req, res) => {
  const date = String(req.params.date);
  if (!isValidDate(date)) throw badRequest('Invalid date');
  res.json(await generateDailyReport(date, `manual:${req.session.admin!.username}`, actorOf(req)));
}));
