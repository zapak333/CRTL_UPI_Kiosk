import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import logo from '../../components/logo.svg';
import { adminApi } from '../../lib/api';
import type { AdminUser } from '../AdminApp';

export default function LoginPage({ onLogin }: { onLogin: (u: AdminUser) => void }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(params.get('expired') ? 'Your session expired. Please sign in again.' : null);
  const [busy, setBusy] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  useEffect(() => {
    adminApi<{ needsSetup: boolean }>('/auth/setup/status').then((r) => setNeedsSetup(r.needsSetup)).catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await adminApi<{ user: AdminUser }>('/auth/login', { method: 'POST', body: { username, password } });
      onLogin(r.user);
      const next = params.get('next');
      navigate(next && next.startsWith('/admin/') && !next.startsWith('/admin/login') ? next : '/admin/dashboard', { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-navy-900 p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-2xl">
        <div className="mb-6 flex flex-col items-center text-center">
          <img src={logo} alt="" className="h-14 w-14" />
          <h1 className="mt-3 text-xl font-bold">CRTL Canteen Admin</h1>
          <p className="text-sm text-slate-500">Authorised staff only</p>
        </div>
        {needsSetup && (
          <div className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            No administrator exists yet. <Link to="/admin/setup" className="font-semibold underline">Run first-time setup</Link>.
          </div>
        )}
        {error && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        <label className="label" htmlFor="u">Username</label>
        <input id="u" className="input mb-4" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
        <label className="label" htmlFor="p">Password</label>
        <input id="p" className="input mb-6" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <button className="btn-primary w-full py-3" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
