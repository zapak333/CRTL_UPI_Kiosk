import { useState } from 'react';
import { adminApi } from '../../lib/api';
import { addDays, fmtDate, inr, istDateTime, istToday } from '../../lib/format';
import { useUser } from '../AdminApp';
import { Badge, ErrorBox, PageHeader, Stat, useAsync, useToast } from '../ui';

function monthStart(d: string) {
  return d.slice(0, 8) + '01';
}
function weekStart(d: string) {
  const day = new Date(d + 'T00:00:00Z').getUTCDay(); // 0 Sun
  return addDays(d, -((day + 6) % 7));
}

export default function ReportsPage() {
  const today = istToday();
  const { can } = useUser();
  const toast = useToast();
  const presets: Record<string, [string, string]> = {
    'Today': [today, today],
    'Yesterday': [addDays(today, -1), addDays(today, -1)],
    'This week': [weekStart(today), today],
    'Last week': [addDays(weekStart(today), -7), addDays(weekStart(today), -1)],
    'This month': [monthStart(today), today],
    'Last month': [monthStart(addDays(monthStart(today), -1)), addDays(monthStart(today), -1)],
  };
  const [preset, setPreset] = useState('Today');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [csvKind, setCsvKind] = useState('items');
  const { data: r, error, reload } = useAsync(() => adminApi<any>(`/reports?from=${from}&to=${to}`), [from, to]);
  const stored = useAsync(() => adminApi<any[]>('/reports/daily'), []);

  const pick = (k: string) => {
    setPreset(k);
    setFrom(presets[k][0]);
    setTo(presets[k][1]);
  };
  const exportUrl = (format: string, extra = '') => `/api/admin/reports/export?from=${from}&to=${to}&format=${format}${extra}`;
  async function regenerate(date: string) {
    try {
      await adminApi(`/reports/daily/${date}/generate`, { method: 'POST' });
      toast(`End-of-day report for ${fmtDate(date)} generated`);
      stored.reload();
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  }
  const s = r?.summary;
  const title = from === to ? `Sales report for ${fmtDate(from)}` : `Sales report ${fmtDate(from)} to ${fmtDate(to)}`;
  const multiDay = from !== to;

  return (
    <>
      <div className="print:hidden">
        <PageHeader title="Reports" sub="All amounts are verified UPI payments only. Pending and failed payments are never counted as revenue.">
          <a className="btn-secondary" href={exportUrl('xlsx')}>⬇ Excel</a>
          <a className="btn-secondary" href={exportUrl('pdf')}>⬇ PDF</a>
          <span className="flex">
            <select className="input rounded-r-none border-r-0" value={csvKind} onChange={(e) => setCsvKind(e.target.value)}>
              <option value="items">Item-wise</option><option value="summary">Summary</option><option value="daily">Day-wise</option>
              <option value="transactions">Transactions</option><option value="failures">Payment failures</option><option value="refunds">Refunds</option>
            </select>
            <a className="btn-secondary rounded-l-none" href={exportUrl('csv', `&kind=${csvKind}`)}>⬇ CSV</a>
          </span>
          <button className="btn-primary" onClick={() => window.print()}>🖨 Print Report</button>
        </PageHeader>
        <div className="card mb-6 flex flex-wrap items-end gap-2 p-3">
          {Object.keys(presets).map((k) => (
            <button key={k} onClick={() => pick(k)} className={`rounded-full px-3 py-1.5 text-sm font-semibold ${preset === k ? 'bg-navy-700 text-white' : 'bg-slate-100 text-slate-600'}`}>{k}</button>
          ))}
          <div className="ml-auto flex items-end gap-2">
            <div><label className="label">From</label><input type="date" className="input" value={from} max={to} onChange={(e) => { setPreset('Custom'); setFrom(e.target.value); }} /></div>
            <div><label className="label">To</label><input type="date" className="input" value={to} min={from} max={today} onChange={(e) => { setPreset('Custom'); setTo(e.target.value); }} /></div>
            <button className="btn-secondary" onClick={reload}>Refresh</button>
          </div>
        </div>
      </div>
      <ErrorBox msg={error} />

      <h2 className="mb-3 hidden text-xl font-bold print:block">CRTL Canteen — {title}</h2>
      {s && (
        <>
          <h2 className="mb-3 text-lg font-bold print:hidden">{title}</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
            <Stat label="Total orders" value={s.totalOrders} />
            <Stat label="Items sold" value={s.totalItemsSold} />
            <Stat label="Successful txns" value={s.successfulTransactions} tone="green" />
            <Stat label="Total UPI collection" value={inr(s.totalCollection, { decimals: true })} tone="green" />
            <Stat label="Failed payments" value={s.failedPayments} tone="red" />
            <Stat label="Pending payments" value={s.pendingPayments} tone="orange" />
            <Stat label="Cancelled orders" value={s.cancelledOrders} tone="slate" />
            <Stat label="Total refunds" value={inr(s.totalRefunds, { decimals: true })} tone="purple" sub={`${s.refundCount} refund(s)`} />
            <Stat label="Avg. order value" value={inr(s.averageOrderValue)} />
            <div className="card relative overflow-hidden bg-navy-800 p-4 text-white">
              <div className="text-xs font-semibold uppercase tracking-wide text-blue-200">Net collection</div>
              <div className="mt-1 text-2xl font-bold tabular-nums">{inr(s.netCollection, { decimals: true })}</div>
              <div className="text-xs text-blue-200">Captured − completed refunds</div>
            </div>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Table title="Item-wise sales" cols={['Food Item', 'Quantity Sold', 'Unit Price', 'Total Amount']} right={[1, 2, 3]}
              rows={r.items.map((i: any) => [i.item, i.quantity, inr(i.unitPrice), inr(i.total)])}
              foot={r.items.length ? ['Total', r.items.reduce((a: number, i: any) => a + i.quantity, 0), '', inr(s.totalCollection === '0.00' ? '0' : r.items.reduce((a: number, i: any) => a + Number(i.total), 0).toFixed(2))] : undefined} />
            <Table title="Category-wise sales" cols={['Category', 'Quantity', 'Amount']} right={[1, 2]} rows={r.categories.map((c: any) => [c.category, c.quantity, inr(c.total)])} />
          </div>

          {multiDay && (
            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <Table title="Day-wise" cols={['Date', 'Orders', 'Items', 'Collection', 'Refunds', 'Net']} right={[1, 2, 3, 4, 5]}
                rows={r.daily.map((d: any) => [fmtDate(d.date), d.orders, d.items, inr(d.collection), inr(d.refunds), inr(d.net)])} />
              <div className="space-y-6">
                <Table title="Week-wise (weeks start Monday)" cols={['Week of', 'Txns', 'Collection', 'Net']} right={[1, 2, 3]}
                  rows={r.weekly.map((d: any) => [fmtDate(d.period), d.txns, inr(d.collection), inr(d.net)])} />
                <Table title="Month-wise" cols={['Month', 'Txns', 'Collection', 'Net']} right={[1, 2, 3]}
                  rows={r.monthly.map((d: any) => [new Date(d.period + 'T00:00:00Z').toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }), d.txns, inr(d.collection), inr(d.net)])} />
              </div>
            </div>
          )}

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Table title={`Payment failures (${r.failures.length})`} cols={['Time', 'Order', 'Amount', 'Reason']} right={[2]}
              rows={r.failures.map((t: any) => [istDateTime(t.created_at), t.order_number, inr(t.amount), t.failure_reason ?? ''])} />
            <Table title={`Refunds (${r.refunds.length})`} cols={['Time', 'Order', 'Amount', 'Reason', 'Status']} right={[2]}
              rows={r.refunds.map((x: any) => [istDateTime(x.created_at), x.order_number, inr(x.amount), x.reason, <Badge key="b" v={x.status} />])} />
          </div>
        </>
      )}

      <div className="mt-8 print:hidden">
        <h2 className="mb-1 text-lg font-bold">Stored end-of-day reports</h2>
        <p className="mb-3 text-sm text-slate-500">Generated automatically every day at the configured report time (IST). Regenerate a day if late refunds were recorded.</p>
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50"><tr>{['Date', 'Orders', 'Items', 'Txns', 'Collection', 'Refunds', 'Net', 'Failed', 'Generated', ''].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody>
              {stored.data?.map((d: any) => (
                <tr key={d.report_date} className="border-b border-slate-100">
                  <td className="td font-semibold"><button className="text-navy-700 hover:underline" onClick={() => { setPreset('Custom'); setFrom(d.report_date); setTo(d.report_date); window.scrollTo(0, 0); }}>{fmtDate(d.report_date)}</button></td>
                  <td className="td">{d.total_orders}</td><td className="td">{d.total_items_sold}</td><td className="td">{d.successful_txns}</td>
                  <td className="td tabular-nums">{inr(d.total_collection)}</td><td className="td tabular-nums">{inr(d.total_refunds)}</td>
                  <td className="td font-semibold tabular-nums">{inr(d.net_collection)}</td><td className="td">{d.failed_payments}</td>
                  <td className="td text-xs text-slate-500">{istDateTime(d.generated_at)} · {d.generated_by}</td>
                  <td className="td">{can('reports.generate') && <button className="text-xs font-semibold text-navy-700" onClick={() => regenerate(d.report_date)}>Regenerate</button>}</td>
                </tr>
              ))}
              {stored.data && !stored.data.length && <tr><td colSpan={10} className="p-6 text-center text-sm text-slate-400">No stored reports yet. The first one is created tonight.</td></tr>}
            </tbody>
          </table>
        </div>
        {can('reports.generate') && <button className="btn-secondary mt-3" onClick={() => regenerate(today)}>Generate today's report now</button>}
      </div>
    </>
  );
}

function Table({ title, cols, rows, right = [], foot }: { title: string; cols: string[]; rows: React.ReactNode[][]; right?: number[]; foot?: React.ReactNode[] }) {
  return (
    <div className="card overflow-hidden break-inside-avoid">
      <h3 className="border-b border-slate-200 px-4 py-2.5 font-bold">{title}</h3>
      <div className="max-h-[420px] overflow-auto print:max-h-none">
        <table className="w-full">
          <thead className="sticky top-0 bg-slate-50"><tr>{cols.map((c, i) => <th key={c} className={`th ${right.includes(i) ? 'text-right' : ''}`}>{c}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, n) => <tr key={n} className="border-t border-slate-100">{r.map((c, i) => <td key={i} className={`td ${right.includes(i) ? 'text-right tabular-nums' : ''} max-w-[260px] truncate`}>{c}</td>)}</tr>)}
            {!rows.length && <tr><td colSpan={cols.length} className="p-6 text-center text-sm text-slate-400">No records</td></tr>}
          </tbody>
          {foot && <tfoot><tr className="border-t-2 border-slate-300 bg-slate-50 font-bold">{foot.map((c, i) => <td key={i} className={`td ${right.includes(i) ? 'text-right tabular-nums' : ''}`}>{c}</td>)}</tr></tfoot>}
        </table>
      </div>
    </div>
  );
}
