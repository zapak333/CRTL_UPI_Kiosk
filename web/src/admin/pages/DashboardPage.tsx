import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { adminApi } from '../../lib/api';
import { fmtDate, inr } from '../../lib/format';
import { ErrorBox, PageHeader, Stat, useAsync } from '../ui';

interface Dash {
  today: string;
  summary: { totalOrders: number; totalItemsSold: number; successfulTransactions: number; totalCollection: string; pendingPayments: number; failedPayments: number; totalRefunds: string; refundCount: number; netCollection: string; needsAttention: number };
  bestSeller: { item: string; quantity: number; total: string } | null;
  daily: { date: string; collection: string; net: string; orders: number }[];
  weekly: { period: string; net: string; txns: number }[];
  monthly: { period: string; net: string; txns: number }[];
  attention: { id: number; order_number: string; attention_note: string; business_date: string }[];
  printFailures: { id: number; order_number: string; token_number: number }[];
}

export default function DashboardPage() {
  const { data, error, reload } = useAsync(() => adminApi<Dash>('/reports/dashboard'));
  const [tab, setTab] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  if (!data) return <><ErrorBox msg={error} /><div className="text-slate-400">Loading…</div></>;
  const s = data.summary;
  const chart =
    tab === 'daily'
      ? data.daily.map((d) => ({ label: d.date.slice(8) + '/' + d.date.slice(5, 7), value: Number(d.net) }))
      : tab === 'weekly'
        ? data.weekly.map((d) => ({ label: 'Wk ' + d.period.slice(8) + '/' + d.period.slice(5, 7), value: Number(d.net) }))
        : data.monthly.map((d) => ({ label: new Date(d.period + 'T00:00:00Z').toLocaleString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' }), value: Number(d.net) }));
  return (
    <>
      <PageHeader title="Dashboard" sub={`Today, ${fmtDate(data.today)} (IST)`}>
        <button className="btn-secondary" onClick={reload}>Refresh</button>
      </PageHeader>

      {(data.attention.length > 0 || data.printFailures.length > 0) && (
        <div className="mb-6 space-y-2">
          {data.attention.map((a) => (
            <Link key={a.id} to={`/admin/orders?open=${a.id}`} className="block rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800 hover:bg-red-100">
              ⚠ <b>{a.order_number}</b>: {a.attention_note}
            </Link>
          ))}
          {data.printFailures.map((a) => (
            <Link key={a.id} to={`/admin/orders?open=${a.id}`} className="block rounded-lg border border-orange-200 bg-orange-50 px-4 py-2 text-sm text-orange-800 hover:bg-orange-100">
              🖨 Receipt not printed for token <b>#{a.token_number}</b> ({a.order_number}) — open to print
            </Link>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Today's Total Sales" value={inr(s.totalCollection, { decimals: true })} tone="green" sub={`Net after refunds ${inr(s.netCollection)}`} />
        <Stat label="Today's Total Orders" value={s.totalOrders} />
        <Stat label="Food Items Sold" value={s.totalItemsSold} />
        <Stat label="Successful UPI Payments" value={s.successfulTransactions} tone="green" />
        <Stat label="Pending Payments" value={s.pendingPayments} tone="orange" />
        <Stat label="Failed Transactions" value={s.failedPayments} tone="red" />
        <Stat label="Total Refunds" value={inr(s.totalRefunds)} tone="purple" sub={`${s.refundCount} refund(s)`} />
        <Stat label="Best-Selling Item" value={<span className="text-lg">{data.bestSeller?.item ?? '—'}</span>} tone="slate" sub={data.bestSeller ? `${data.bestSeller.quantity} sold · ${inr(data.bestSeller.total)}` : 'No sales yet today'} />
      </div>

      <div className="card mt-6 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-bold">Net sales</h2>
          <div className="flex rounded-lg bg-slate-100 p-1 text-sm">
            {(['daily', 'weekly', 'monthly'] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`rounded-md px-3 py-1 font-semibold capitalize ${tab === t ? 'bg-white shadow' : 'text-slate-500'}`}>{t}</button>
            ))}
          </div>
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} margin={{ left: 8, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 12, fill: '#64748b' }} tickLine={false} axisLine={false} tickFormatter={(v) => '₹' + Number(v).toLocaleString('en-IN')} width={70} />
              <Tooltip formatter={(v: number) => ['₹' + v.toLocaleString('en-IN', { minimumFractionDigits: 2 }), 'Net sales']} cursor={{ fill: '#f1f5f9' }} />
              <Bar dataKey="value" fill="#1e40af" radius={[4, 4, 0, 0]} maxBarSize={48} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </>
  );
}
