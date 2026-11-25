import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import logo from '../../components/logo.svg';
import { adminApi } from '../../lib/api';

export default function SetupPage() {
  const [needs, setNeeds] = useState<boolean | null>(null);
  // The Windows installer opens /admin/setup#token=… so the one-time token is pre-filled.
  // It is read from the URL fragment (never sent to the server or written to logs) and then removed.
  const [f, setF] = useState(() => ({ setupToken: new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '', username: '', fullName: '', password: '', confirm: '' }));
  useEffect(() => {
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    adminApi<{ needsSetup: boolean }>('/auth/setup/status').then((r) => setNeeds(r.needsSetup)).catch(() => setNeeds(false));
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (f.password !== f.confirm) return setError('Passwords do not match');
    try {
      await adminApi('/auth/setup', { method: 'POST', body: { setupToken: f.setupToken.trim(), username: f.username, fullName: f.fullName, password: f.password } });
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    }
  }
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="flex min-h-full items-center justify-center bg-navy-900 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl">
        <div className="mb-6 flex items-center gap-3">
          <img src={logo} alt="" className="h-12 w-12" />
          <div>
            <h1 className="text-xl font-bold">First-time setup</h1>
            <p className="text-sm text-slate-500">Create the first administrator account</p>
          </div>
        </div>
        {needs === false && !done && (
          <p className="text-sm text-slate-600">Setup is already complete. <Link className="font-semibold text-navy-700 underline" to="/admin/login">Go to login</Link>.</p>
        )}
        {done && (
          <p className="text-sm text-green-700">Administrator created. <Link className="font-semibold underline" to="/admin/login">Sign in now</Link>.</p>
        )}
        {needs && !done && (
          <form onSubmit={submit} className="space-y-4">
            <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
              The one-time <b>setup token</b> is printed in the server console when the server starts (or set ADMIN_SETUP_TOKEN in the .env file). This prevents anyone else on the network from claiming the admin account.
            </p>
            {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
            <div><label className="label">Setup token</label><input className="input font-mono" value={f.setupToken} onChange={set('setupToken')} required /></div>
            <div><label className="label">Username</label><input className="input" value={f.username} onChange={set('username')} required pattern="[a-zA-Z0-9._-]{3,64}" /></div>
            <div><label className="label">Full name</label><input className="input" value={f.fullName} onChange={set('fullName')} /></div>
            <div><label className="label">Password (10+ characters, letters and numbers)</label><input className="input" type="password" autoComplete="new-password" value={f.password} onChange={set('password')} required minLength={10} /></div>
            <div><label className="label">Confirm password</label><input className="input" type="password" autoComplete="new-password" value={f.confirm} onChange={set('confirm')} required /></div>
            <button className="btn-primary w-full py-3">Create administrator</button>
          </form>
        )}
      </div>
    </div>
  );
}
