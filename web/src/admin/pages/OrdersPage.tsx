import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { adminApi } from '../../lib/api';
import { fmtDate, inr, istDateTime, istTime, istToday } from '../../lib/format';
import { useUser } from '../AdminApp';
import { Badge, ErrorBox, Modal, PageHeader, useAsync, useToast } from '../ui';

interface Row {
  id: number; order_number: string; token_number: number | null; business_date: string; created_at: string; paid_at: string | null; status: string;
  total_amount: string; payment_mode: string; print_status: string; needs_attention: boolean; attention_note: string | null; items_summary: string;
  payment_status: string | null; bank_rrn: string | null; provider_payment_ref: string | null;
}

const presets: { k: string; label: string; q: Record<string, string> }[] = [
  { k: 'today', label: "Today's Orders", q: { range: 'today' } },
  { k: 'yesterday', label: "Yesterday's Orders", q: { range: 'yesterday' } },
  { k: 'success', label: 'Successful Payments', q: { range: 'today', payment: 'SUCCESS' } },
  { k: 'failed', label: 'Failed Payments', q: { range: 'today', payment: 'FAILED' } },
  { k: 'pending', label: 'Pending Payments', q: { range: 'today', payment: 'PENDING' } },
  { k: 'cancelled', label: 'Cancelled Orders', q: { range: 'today', status: 'CANCELLED' } },
  { k: 'printfail', label: 'Print Failed', q: { range: 'all', print: 'FAILED' } },
  { k: 'attention', label: 'Needs Attention', q: { range: 'all', attention: '1' } },
];

export default function OrdersPage() {
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<Record<string, string>>({ range: 'today', status: 'all', payment: 'all', print: 'all' });
  const [preset, setPreset] = useState('today');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const today = istToday();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const qs = new URLSearchParams({ ...filter, page: String(page), ...(filter.range === 'custom' ? { from, to } : {}), ...(q ? { q } : {}) }).toString();
  const { data, error, reload } = useAsync(() => adminApi<{ total: number; rows: Row[]; pageSize: number; from: string; to: string }>(`/orders?${qs}`), [qs]);
  const openId = Number(params.get('open')) || null;

  useEffect(() => {
    const t = setInterval(reload, 15000);
    return () => clearInterval(t);
  }, [reload]);

  const choose = (p: (typeof presets)[number]) => {
    setPreset(p.k);
    setPage(1);
    setFilter({ status: 'all', payment: 'all', print: 'all', ...p.q });
  };

  return (
    <>
      <PageHeader title="Orders" sub={data ? `${data.total} order(s)${filter.range !== 'all' ? ` · ${fmtDate(data.from)}${data.from !== data.to ? ' to ' + fmtDate(data.to) : ''}` : ''}` : ''}>
        <input className="input w-64" placeholder="Search order no, token, txn ID…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
      </PageHeader>
      <div className="mb-4 flex flex-wrap gap-2">
        {presets.map((p) => (
          <button key={p.k} onClick={() => choose(p)} className={`rounded-full px-3 py-1.5 text-sm font-semibold ${preset === p.k ? 'bg-navy-700 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`}>{p.label}</button>
        ))}
        <button onClick={() => { setPreset('custom'); setFilter({ ...filter, range: 'custom' }); }} className={`rounded-full px-3 py-1.5 text-sm font-semibold ${preset === 'custom' ? 'bg-navy-700 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`}>Custom Date Range</button>
      </div>
      {filter.range === 'custom' && (
        <div className="card mb-4 flex flex-wrap items-end gap-3 p-3">
          <div><label className="label">From</label><input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label className="label">To</label><input type="date" className="input" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></div>
          <div><label className="label">Order status</label>
            <select className="input" value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
              {['all', 'PAID', 'PENDING_PAYMENT', 'CANCELLED', 'EXPIRED', 'REFUNDED', 'PARTIALLY_REFUNDED'].map((s) => <option key={s}>{s}</option>)}
            </select></div>
          <div><label className="label">Payment</label>
            <select className="input" value={filter.payment} onChange={(e) => setFilter({ ...filter, payment: e.target.value })}>
              {['all', 'SUCCESS', 'FAILED', 'PENDING', 'EXPIRED', 'CANCELLED', 'REFUNDED'].map((s) => <option key={s}>{s}</option>)}
            </select></div>
        </div>
      )}
      <ErrorBox msg={error} />
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Order ID</th><th className="th">Token</th><th className="th">Date</th><th className="th">Time</th><th className="th">Items</th>
              <th className="th text-right">Total</th><th className="th">Mode</th><th className="th">Payment</th><th className="th">Txn Ref</th><th className="th">Print</th><th className="th">Order</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((r) => (
              <tr key={r.id} onClick={() => setParams({ open: String(r.id) })} className={`cursor-pointer border-b border-slate-100 hover:bg-blue-50/50 ${r.needs_attention ? 'bg-red-50' : ''}`}>
                <td className="td font-mono text-xs">{r.order_number}</td>
                <td className="td font-bold">{r.token_number ? `#${r.token_number}` : '—'}</td>
                <td className="td">{fmtDate(r.business_date)}</td>
                <td className="td">{istTime(r.paid_at ?? r.created_at)}</td>
                <td className="td max-w-[220px] truncate text-slate-600" title={r.items_summary}>{r.items_summary}</td>
                <td className="td text-right font-semibold tabular-nums">{inr(r.total_amount)}</td>
                <td className="td">{r.payment_mode}</td>
                <td className="td"><Badge v={r.payment_status} /></td>
                <td className="td font-mono text-xs">{r.bank_rrn ?? r.provider_payment_ref ?? '—'}</td>
                <td className="td"><Badge v={r.status === 'PAID' || r.print_status !== 'NOT_PRINTED' ? r.print_status : null} /></td>
                <td className="td"><Badge v={r.status} />{r.needs_attention && <span title={r.attention_note ?? ''}> ⚠</span>}</td>
              </tr>
            ))}
            {data && !data.rows.length && <tr><td colSpan={11} className="p-8 text-center text-slate-400">No orders match these filters.</td></tr>}
          </tbody>
        </table>
      </div>
      {data && data.total > data.pageSize && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm">
          <button className="btn-secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span>Page {page} of {Math.ceil(data.total / data.pageSize)}</span>
          <button className="btn-secondary" disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
      {openId && <OrderDetail id={openId} onClose={() => { setParams({}); reload(); }} />}
    </>
  );
}

function OrderDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const { can } = useUser();
  const toast = useToast();
  const { data, error, reload } = useAsync(() => adminApi<any>(`/orders/${id}`), [id]);
  const [refund, setRefund] = useState<{ paymentId: number; amount: string; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function reprint() {
    setBusy(true);
    try {
      const r = await adminApi<any>(`/orders/${id}/reprint`, { method: 'POST' });
      r.status === 'PRINTED' ? toast(r.kind === 'ORIGINAL' ? 'Receipt printed' : 'Duplicate receipt printed') : toast(`Print failed: ${r.last_error}`, 'err');
      reload();
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  }
  async function doRefund() {
    if (!refund) return;
    setBusy(true);
    try {
      const r = await adminApi<any>(`/orders/${id}/refund`, { method: 'POST', body: refund });
      r.status === 'FAILED' ? toast(`Refund failed: ${r.failure_reason}`, 'err') : toast(`Refund ${r.status.toLowerCase()}`);
      setRefund(null);
      reload();
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  }
  async function resolve() {
    const note = prompt('Resolution note (e.g. "Refunded manually via gateway dashboard")');
    if (!note) return;
    try {
      await adminApi(`/orders/${id}/resolve`, { method: 'POST', body: { note } });
      reload();
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  }

  const o = data?.order;
  const captured = data?.payments.filter((p: any) => ['SUCCESS', 'PARTIALLY_REFUNDED'].includes(p.status)) ?? [];
  return (
    <Modal title={o ? `Order ${o.order_number}` : 'Order'} onClose={onClose} wide>
      <ErrorBox msg={error} />
      {o && (
        <div className="grid gap-5 md:grid-cols-[1fr_340px]">
          <div className="space-y-5">
            {o.needs_attention && (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                <span>⚠ {o.attention_note}</span>
                {can('orders.refund') && <button className="btn-secondary shrink-0" onClick={resolve}>Mark resolved</button>}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Info k="Token" v={o.token_number ? `#${o.token_number}` : '—'} />
              <Info k="Status" v={<Badge v={o.status} />} />
              <Info k="Created" v={istDateTime(o.created_at)} />
              <Info k="Paid" v={istDateTime(o.paid_at)} />
              <Info k="Total" v={inr(o.total_amount, { decimals: true })} />
              <Info k="Print" v={<Badge v={o.print_status} />} />
              <Info k="Mode" v={o.payment_mode} />
              <Info k="Kiosk" v={o.kiosk_id ?? '—'} />
            </div>
            <Section title="Items (as sold)">
              <table className="w-full text-sm">
                <tbody>
                  {data.items.map((i: any, n: number) => (
                    <tr key={n} className="border-b border-slate-100"><td className="py-1.5">{i.item_name}</td><td className="text-right">{i.quantity} × {inr(i.unit_price)}</td><td className="w-24 text-right font-semibold">{inr(i.line_total)}</td></tr>
                  ))}
                </tbody>
              </table>
            </Section>
            <Section title="Payment attempts">
              {data.payments.map((p: any) => (
                <div key={p.id} className="mb-2 rounded-lg border border-slate-200 p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-xs">{p.attempt_ref}</span>
                    <Badge v={p.status} />
                  </div>
                  <div className="mt-1 grid grid-cols-2 gap-x-4 text-xs text-slate-600">
                    <span>Amount: {inr(p.amount, { decimals: true })}{p.amount_received && p.amount_received !== p.amount ? ` (received ${inr(p.amount_received)})` : ''}</span>
                    <span>Provider: {p.provider}</span>
                    <span>Gateway ID: {p.provider_payment_ref ?? '—'}</span>
                    <span>Bank RRN: {p.bank_rrn ?? '—'}</span>
                    <span>Verified: {p.verified_at ? `${istDateTime(p.verified_at)} via ${p.verified_via}` : '—'}</span>
                    <span>Payer: {p.payer_vpa_masked ?? '—'}</span>
                    {p.failure_reason && <span className="col-span-2 text-red-600">{p.failure_reason}</span>}
                  </div>
                </div>
              ))}
              {!data.payments.length && <div className="text-sm text-slate-400">No payment attempts.</div>}
            </Section>
            {data.refunds.length > 0 && (
              <Section title="Refunds">
                {data.refunds.map((r: any) => (
                  <div key={r.id} className="flex justify-between border-b border-slate-100 py-1.5 text-sm">
                    <span>{istDateTime(r.created_at)} · {r.reason} · by {r.requested_by_name ?? '—'}</span>
                    <span className="flex items-center gap-2 font-semibold">{inr(r.amount)} <Badge v={r.status} /></span>
                  </div>
                ))}
              </Section>
            )}
            <Section title="Audit trail">
              <div className="max-h-48 overflow-y-auto text-xs">
                {data.audit.map((a: any, n: number) => (
                  <div key={n} className="border-b border-slate-100 py-1"><span className="text-slate-400">{istDateTime(a.created_at)}</span> · <b>{a.action}</b> · {a.actor_name ?? a.actor_type}</div>
                ))}
              </div>
            </Section>
          </div>
          <div className="space-y-3">
            {data.receipt ? (
              <pre className="max-h-[420px] overflow-auto rounded-lg bg-slate-900 p-3 font-mono text-[9px] leading-tight text-green-200">{data.receipt}</pre>
            ) : (
              <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">No receipt: this order has no verified payment.</div>
            )}
            {data.receipt && can('orders.reprint') && (
              <button className="btn-primary w-full" disabled={busy} onClick={reprint}>{o.print_status === 'PRINTED' ? 'Reprint receipt (duplicate)' : 'Print receipt'}</button>
            )}
            {can('orders.refund') && captured.map((p: any) => (
              <button key={p.id} className="btn-secondary w-full" onClick={() => setRefund({ paymentId: p.id, amount: p.amount_received ?? p.amount, reason: '' })}>Record refund…</button>
            ))}
            <div className="text-xs text-slate-400">Print jobs: {data.printJobs.map((j: any) => `${j.kind.toLowerCase()} ${j.status.toLowerCase()}${j.last_error ? ` (${j.last_error})` : ''}`).join('; ') || 'none'}</div>
          </div>
        </div>
      )}
      {refund && (
        <Modal title="Refund payment" onClose={() => setRefund(null)}>
          <p className="mb-3 text-sm text-slate-600">The refund is sent to the payment gateway and recorded as a separate transaction. The original payment record is not changed.</p>
          <label className="label">Amount (₹)</label>
          <input className="input mb-3" inputMode="decimal" value={refund.amount} onChange={(e) => setRefund({ ...refund, amount: e.target.value })} />
          <label className="label">Reason</label>
          <input className="input mb-4" value={refund.reason} onChange={(e) => setRefund({ ...refund, reason: e.target.value })} placeholder="e.g. Item not available" />
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setRefund(null)}>Cancel</button>
            <button className="btn-danger" disabled={busy || refund.reason.length < 3} onClick={doRefund}>Refund {inr(refund.amount)}</button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}

function Info({ k, v }: { k: string; v: React.ReactNode }) {
  return <div><div className="text-xs text-slate-400">{k}</div><div className="font-medium">{v}</div></div>;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div><h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">{title}</h3>{children}</div>;
}
