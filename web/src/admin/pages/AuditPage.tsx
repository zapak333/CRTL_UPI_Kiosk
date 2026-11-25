import { useState } from 'react';
import { adminApi } from '../../lib/api';
import { istDateTime } from '../../lib/format';
import { ErrorBox, PageHeader, useAsync } from '../ui';

export default function AuditPage() {
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const { data, error } = useAsync(() => adminApi<any[]>(`/system/audit?page=${page}${action ? `&action=${encodeURIComponent(action)}` : ''}`), [action, page]);
  return (
    <>
      <PageHeader title="Audit log" sub="Every sign-in, menu change, payment event, print, refund and settings change. Records cannot be deleted.">
        <input className="input w-64" placeholder="Filter by action, e.g. payment, item, auth" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} />
      </PageHeader>
      <ErrorBox msg={error} />
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50"><tr><th className="th">Time</th><th className="th">Who</th><th className="th">Action</th><th className="th">Entity</th><th className="th">Details</th><th className="th">IP</th></tr></thead>
          <tbody>
            {data?.map((a) => (
              <tr key={a.id} className="border-b border-slate-100 align-top">
                <td className="td text-xs">{istDateTime(a.created_at)}</td>
                <td className="td text-xs">{a.actor_name ?? a.actor_type}</td>
                <td className="td text-xs font-semibold">{a.action}</td>
                <td className="td text-xs">{a.entity_type}{a.entity_id ? ` #${a.entity_id}` : ''}</td>
                <td className="max-w-md px-3 py-2"><code className="block truncate text-[11px] text-slate-500" title={JSON.stringify(a.details)}>{JSON.stringify(a.details)}</code></td>
                <td className="td text-xs text-slate-400">{a.ip_address}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button className="btn-secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Newer</button>
        <button className="btn-secondary" disabled={(data?.length ?? 0) < 100} onClick={() => setPage(page + 1)}>Older</button>
      </div>
    </>
  );
}
