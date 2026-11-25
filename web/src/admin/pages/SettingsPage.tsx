import { useEffect, useState } from 'react';
import { adminApi } from '../../lib/api';
import { formatBytes } from './util';
import { istDateTime } from '../../lib/format';
import { useUser } from '../AdminApp';
import { Badge, ErrorBox, PageHeader, Toggle, useAsync, useToast } from '../ui';
import { ImageUpload } from './ImageUpload';

export default function SettingsPage() {
  const { can } = useUser();
  return (
    <>
      <PageHeader title="Settings" />
      <div className="space-y-6">
        {can('settings.manage') && <GeneralSettings />}
        <PrinterSettings />
        <PaymentInfo />
        {can('backup.manage') && <Backups />}
      </div>
    </>
  );
}

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <h2 className="text-lg font-bold">{title}</h2>
      {sub && <p className="mb-4 text-sm text-slate-500">{sub}</p>}
      <div className={sub ? '' : 'mt-4'}>{children}</div>
    </section>
  );
}

function GeneralSettings() {
  const toast = useToast();
  const { data } = useAsync(() => adminApi<any>('/system/settings'));
  const [s, setS] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (data) setS(data.settings); }, [data]);
  if (!s) return null;
  const f = (k: string, type = 'text', props: any = {}) => (
    <input className="input" type={type} value={s[k] ?? ''} onChange={(e) => setS({ ...s, [k]: type === 'number' ? Number(e.target.value) : e.target.value })} {...props} />
  );
  async function save() {
    setErr(null);
    try {
      setS(await adminApi('/system/settings', { method: 'PUT', body: s }));
      toast('Settings saved');
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  return (
    <Card title="Canteen & kiosk" sub="Shown on the kiosk screen and printed on receipts.">
      <ErrorBox msg={err} />
      <div className="grid gap-4 md:grid-cols-2">
        <div><label className="label">Canteen name</label>{f('canteen_name')}</div>
        <div><label className="label">Institution name</label>{f('institution_name')}</div>
        <div><label className="label">Welcome message</label>{f('welcome_message')}</div>
        <div><label className="label">UPI payee name (shown in UPI app)</label>{f('upi_payee_name')}</div>
        <div className="md:col-span-2"><label className="label">Address (printed on receipt)</label>
          <textarea className="input" rows={2} value={s.address} onChange={(e) => setS({ ...s, address: e.target.value })} /></div>
        <div><label className="label">Contact phone</label>{f('contact_phone')}</div>
        <div><label className="label">Contact email</label>{f('contact_email', 'email')}</div>
        <div className="md:col-span-2"><label className="label">Institution logo</label><ImageUpload value={s.logo_url} onChange={(u) => setS({ ...s, logo_url: u })} /></div>
      </div>
      <h3 className="mb-3 mt-6 font-bold">Hours, tokens & reports</h3>
      <div className="grid gap-4 md:grid-cols-4">
        <div><label className="label">Opening time</label>{f('opening_time', 'time')}</div>
        <div><label className="label">Closing time</label>{f('closing_time', 'time')}</div>
        <div className="flex items-end pb-2"><Toggle checked={s.enforce_operating_hours} onChange={(v) => setS({ ...s, enforce_operating_hours: v })} label="Block orders outside hours" /></div>
        <div><label className="label">EOD report time (IST)</label>{f('report_time', 'time')}</div>
        <div><label className="label">Token prefix</label>{f('token_prefix', 'text', { maxLength: 4, placeholder: 'e.g. A' })}</div>
        <div><label className="label">Token digits</label>{f('token_digits', 'number', { min: 3, max: 6 })}</div>
        <div><label className="label">Kiosk idle timeout (sec)</label>{f('kiosk_idle_timeout_seconds', 'number', { min: 20, max: 900 })}</div>
        <div><label className="label">Max qty per item</label>{f('max_qty_per_item', 'number', { min: 1, max: 50 })}</div>
        <div><label className="label">Admin session timeout (min)</label>{f('admin_session_timeout_minutes', 'number', { min: 5, max: 480 })}</div>
        <div><label className="label">Currency</label><input className="input bg-slate-50" value="INR (₹)" disabled /></div>
      </div>
      <p className="mt-2 text-xs text-slate-400">Tokens reset to 1 every day (IST). Every order also has a permanent unique order number.</p>
      <h3 className="mb-3 mt-6 font-bold">Tax (optional)</h3>
      <div className="grid gap-4 md:grid-cols-4">
        <div className="flex items-end pb-2"><Toggle checked={s.tax_enabled} onChange={(v) => setS({ ...s, tax_enabled: v })} label="Charge tax" /></div>
        <div><label className="label">Tax label</label>{f('tax_label', 'text', { disabled: !s.tax_enabled })}</div>
        <div><label className="label">Rate (%)</label>{f('tax_rate', 'number', { disabled: !s.tax_enabled, step: '0.01' })}</div>
        <div><label className="label">Mode</label>
          <select className="input" disabled={!s.tax_enabled} value={s.tax_mode} onChange={(e) => setS({ ...s, tax_mode: e.target.value })}>
            <option value="exclusive">Added on top of menu prices</option>
            <option value="inclusive">Included in menu prices</option>
          </select></div>
        <div className="md:col-span-2"><label className="label">Tax registration no. (printed)</label>{f('tax_registration_no', 'text', { disabled: !s.tax_enabled })}</div>
      </div>
      <h3 className="mb-3 mt-6 font-bold">Receipt</h3>
      <label className="label">Receipt footer message</label>
      <textarea className="input font-mono" rows={3} value={s.receipt_footer} onChange={(e) => setS({ ...s, receipt_footer: e.target.value })} />
      <div className="mt-5 flex justify-end"><button className="btn-primary" onClick={save}>Save settings</button></div>
    </Card>
  );
}

function PrinterSettings() {
  const toast = useToast();
  const { data, reload } = useAsync(() => adminApi<any>('/system/printer'));
  const [p, setP] = useState<any>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setP(data.settings); }, [data]);
  if (!p) return null;
  async function save() {
    try {
      const { updated_at, id, ...body } = p;
      await adminApi('/system/printer', { method: 'PUT', body: { ...body, network_host: body.network_host || null, device_path: body.device_path || null } });
      toast('Printer settings saved');
      reload();
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  }
  async function test() {
    setBusy(true);
    try {
      const r = await adminApi<any>('/system/printer/test', { method: 'POST' });
      setPreview(r.preview);
      r.ok ? toast('Test page sent to printer') : toast(`Printer error: ${r.error}`, 'err');
      reload();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card title="Thermal receipt printer (80 mm, ESC/POS)" sub="Save before running a test print.">
      <div className="grid gap-4 md:grid-cols-3">
        <div><label className="label">Connection</label>
          <select className="input" value={p.driver} onChange={(e) => setP({ ...p, driver: e.target.value })}>
            <option value="mock">Test mode – save receipts as files</option>
            <option value="network">Network / LAN printer (TCP 9100)</option>
            <option value="device">USB / shared printer (device path)</option>
          </select></div>
        {p.driver === 'network' && <>
          <div><label className="label">Printer IP address</label><input className="input" value={p.network_host ?? ''} onChange={(e) => setP({ ...p, network_host: e.target.value })} placeholder="192.168.1.50" /></div>
          <div><label className="label">Port</label><input className="input" type="number" value={p.network_port} onChange={(e) => setP({ ...p, network_port: Number(e.target.value) })} /></div>
        </>}
        {p.driver === 'device' && (
          <div className="md:col-span-2"><label className="label">Device path</label><input className="input font-mono" value={p.device_path ?? ''} onChange={(e) => setP({ ...p, device_path: e.target.value })} placeholder="/dev/usb/lp0  or  \\localhost\POS80" /></div>
        )}
        {p.driver === 'mock' && <div className="md:col-span-2 self-end pb-2"><Toggle checked={p.mock_fail} onChange={(v) => setP({ ...p, mock_fail: v })} label="Simulate printer disconnected (for testing)" /></div>}
        <div><label className="label">Characters per line</label>
          <select className="input" value={p.chars_per_line} onChange={(e) => setP({ ...p, chars_per_line: Number(e.target.value) })}>
            <option value={48}>48 (80 mm, Font A – standard)</option><option value={42}>42 (80 mm, large margins)</option><option value={64}>64 (80 mm, Font B)</option><option value={32}>32 (58 mm)</option>
          </select></div>
        <div><label className="label">Timeout (ms)</label><input className="input" type="number" value={p.timeout_ms} onChange={(e) => setP({ ...p, timeout_ms: Number(e.target.value) })} /></div>
      </div>
      <div className="mt-4 flex flex-wrap gap-6">
        <Toggle checked={p.auto_print} onChange={(v) => setP({ ...p, auto_print: v })} label="Print automatically after verified payment" />
        <Toggle checked={p.cut_paper} onChange={(v) => setP({ ...p, cut_paper: v })} label="Auto-cut paper" />
        {p.driver === 'network' && <Toggle checked={p.check_status} onChange={(v) => setP({ ...p, check_status: v })} label="Check paper status before printing" />}
        <Toggle checked={p.open_drawer} onChange={(v) => setP({ ...p, open_drawer: v })} label="Open cash drawer" />
      </div>
      <div className="mt-5 flex gap-2">
        <button className="btn-primary" onClick={save}>Save printer settings</button>
        <button className="btn-secondary" onClick={test} disabled={busy}>Print test page</button>
      </div>
      {preview && <pre className="mt-4 inline-block rounded-lg bg-slate-900 p-3 font-mono text-[11px] leading-tight text-green-200">{preview}</pre>}
      <h3 className="mb-2 mt-6 text-sm font-bold">Recent print jobs</h3>
      <div className="text-sm">
        {data?.recent.map((j: any) => (
          <div key={j.id} className="flex items-center gap-3 border-b border-slate-100 py-1.5">
            <span className="w-36 text-xs text-slate-500">{istDateTime(j.created_at)}</span>
            <span className="w-20 text-xs font-semibold">{j.kind}</span>
            <span className="w-48 font-mono text-xs">{j.order_number ?? '—'}</span>
            <Badge v={j.status} />
            <span className="truncate text-xs text-red-600">{j.last_error}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function PaymentInfo() {
  const { data } = useAsync(() => adminApi<any>('/system/settings'));
  const p = data?.payment;
  if (!p) return null;
  return (
    <Card title="UPI payment gateway" sub="Gateway keys are kept in the server's .env file only. They are never stored in the database or sent to any browser.">
      <dl className="grid gap-3 text-sm md:grid-cols-2">
        <Row k="Active provider" v={<span className="font-semibold capitalize">{p.provider}</span>} />
        <Row k="Mode" v={p.provider === 'simulated' ? <span className="font-semibold text-amber-700">Simulated (no real payments)</span> : p.testMode ? <span className="font-semibold text-amber-700">Razorpay TEST mode</span> : <span className="font-semibold text-green-700">LIVE</span>} />
        {p.provider === 'razorpay' && <>
          <Row k="Key ID" v={<span className="font-mono">{p.razorpayKeyId ?? 'not set'}</span>} />
          <Row k="Key secret" v={p.razorpaySecretConfigured ? '✓ configured' : '✕ missing'} />
          <Row k="Webhook secret" v={p.webhookSecretConfigured ? '✓ configured' : '✕ missing'} />
        </>}
        <Row k="Webhook URL (configure in gateway dashboard)" v={<span className="break-all font-mono text-xs">{p.webhookUrl}</span>} />
        <Row k="QR validity" v={`${p.qrTtlMinutes} minutes`} />
      </dl>
    </Card>
  );
}
function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div><dt className="text-xs text-slate-500">{k}</dt><dd>{v}</dd></div>;
}

function Backups() {
  const toast = useToast();
  const { data, reload } = useAsync(() => adminApi<any>('/system/backups'));
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      const r = await adminApi<any>('/system/backups', { method: 'POST' });
      toast(`Backup created: ${r.file}`);
      reload();
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card title="Database backups" sub={data ? `Automatic daily backup (cron "${data.schedule}", IST), kept ${data.keepDays} days, in ${data.dir}` : ''}>
      <button className="btn-primary" disabled={busy} onClick={run}>{busy ? 'Backing up…' : 'Back up now'}</button>
      <div className="mt-4 text-sm">
        {data?.backups.slice(0, 10).map((b: any) => (
          <div key={b.file} className="flex gap-4 border-b border-slate-100 py-1.5"><span className="font-mono text-xs">{b.file}</span><span className="text-slate-500">{formatBytes(b.bytes)}</span><span className="text-slate-500">{istDateTime(b.createdAt)}</span></div>
        ))}
        {data && !data.backups.length && <div className="text-slate-400">No backups yet.</div>}
      </div>
    </Card>
  );
}
