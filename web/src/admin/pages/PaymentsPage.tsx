import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminApi } from '../../lib/api';
import { inr, istDateTime, istToday } from '../../lib/format';
import { Badge, ErrorBox, PageHeader, Stat, useAsync } from '../ui';

export default function PaymentsPage() {
  const today = istToday();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [status, setStatus] = useState('all');
  const nav = useNavigate();
  const { data, error } = useAsync(() => adminApi<any>(`/reports?from=${from}&to=${to}`), [from, to]);
  const events = useAsync(() => adminApi<any[]>('/system/payment-events').catch(() => []), []);
  const rows = (data?.transactions ?? []).filter((t: any) => status === 'all' || t.status === status);
  return (
    <>
      <PageHeader title="Payment Transactions" sub="Every UPI payment attempt, as verified by the server">
        <input type="date" className="input w-40" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" className="input w-40" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        <select className="input w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
          {['all', 'SUCCESS', 'PENDING', 'FAILED', 'EXPIRED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED'].map((s) => <option key={s}>{s}</option>)}
        </select>
      </PageHeader>
      <ErrorBox msg={error} />
      {data && (
        <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label="Captured" value={inr(data.summary.totalCollection)} tone="green" sub={`${data.summary.successfulTransactions} payments`} />
          <Stat label="Refunded" value={inr(data.summary.totalRefunds)} tone="purple" />
          <Stat label="Pending" value={data.summary.pendingPayments} tone="orange" />
          <Stat label="Failed" value={data.summary.failedPayments} tone="red" />
        </div>
      )}
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr><th className="th">Created</th><th className="th">Order</th><th className="th">Token</th><th className="th">Our Ref</th><th className="th">Gateway ID</th><th className="th">Bank RRN</th><th className="th text-right">Amount</th><th className="th">Status</th><th className="th">Verified</th><th className="th">Note</th></tr>
          </thead>
          <tbody>
            {rows.map((t: any) => (
              <tr key={t.id} className="cursor-pointer border-b border-slate-100 hover:bg-blue-50/50" onClick={() => nav(`/admin/orders?open=${t.order_id}`)}>
                <td className="td">{istDateTime(t.created_at)}</td>
                <td className="td font-mono text-xs">{t.order_number}</td>
                <td className="td">{t.token_number ? `#${t.token_number}` : '—'}</td>
                <td className="td font-mono text-xs">{t.attempt_ref}</td>
                <td className="td font-mono text-xs">{t.provider_payment_ref ?? '—'}</td>
                <td className="td font-mono text-xs">{t.bank_rrn ?? '—'}</td>
                <td className="td text-right tabular-nums">{inr(t.amount)}</td>
                <td className="td"><Badge v={t.status} /></td>
                <td className="td text-xs">{t.verified_via ?? '—'}</td>
                <td className="td max-w-[220px] truncate text-xs text-red-600" title={t.failure_reason ?? ''}>{t.failure_reason}</td>
              </tr>
            ))}
            {data && !rows.length && <tr><td colSpan={10} className="p-8 text-center text-slate-400">No transactions.</td></tr>}
          </tbody>
        </table>
      </div>
      <h2 className="mb-2 mt-8 font-bold">Gateway webhook log (latest 200)</h2>
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50"><tr><th className="th">Received</th><th className="th">Provider</th><th className="th">Event</th><th className="th">Event ID</th><th className="th">Signature</th><th className="th">Result</th></tr></thead>
          <tbody>
            {(events.data ?? []).map((e: any) => (
              <tr key={e.id} className="border-b border-slate-100">
                <td className="td">{istDateTime(e.received_at)}</td><td className="td">{e.provider}</td><td className="td">{e.event_type}</td>
                <td className="td font-mono text-xs">{e.provider_event_id ?? '—'}</td>
                <td className="td">{e.signature_valid ? <span className="text-green-700">valid</span> : <span className="font-semibold text-red-600">INVALID</span>}</td>
                <td className="td text-xs">{e.processing_result}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
