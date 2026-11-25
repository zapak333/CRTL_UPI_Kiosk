import { useState } from 'react';
import { adminApi } from '../../lib/api';
import { istDateTime } from '../../lib/format';
import { useUser } from '../AdminApp';
import { ErrorBox, Modal, PageHeader, useAsync, useToast } from '../ui';

const roles = {
  superadmin: 'Everything, including users, settings and backups',
  admin: 'Menu, orders, refunds, reports, printer',
  staff: 'View orders and reprint receipts only',
};

export default function UsersPage() {
  const me = useUser().user;
  const toast = useToast();
  const { data, error, reload } = useAsync(() => adminApi<any[]>('/system/users'));
  const [form, setForm] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    setErr(null);
    try {
      if (form.id) {
        const body: any = { fullName: form.fullName, role: form.role, isActive: form.isActive };
        if (form.password) body.password = form.password;
        await adminApi(`/system/users/${form.id}`, { method: 'PUT', body });
      } else await adminApi('/system/users', { method: 'POST', body: form });
      toast('User saved');
      setForm(null);
      reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  async function unlock(id: number) {
    await adminApi(`/system/users/${id}`, { method: 'PUT', body: { unlock: true } });
    reload();
  }
  return (
    <>
      <PageHeader title="Admin users"><button className="btn-primary" onClick={() => setForm({ username: '', fullName: '', role: 'staff', password: '' })}>+ Add user</button></PageHeader>
      <ErrorBox msg={error} />
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50"><tr><th className="th">Username</th><th className="th">Name</th><th className="th">Role</th><th className="th">Status</th><th className="th">Last login</th><th className="th"></th></tr></thead>
          <tbody>
            {data?.map((u) => (
              <tr key={u.id} className="border-b border-slate-100">
                <td className="td font-semibold">{u.username}{u.id === me.id && <span className="ml-1 text-xs text-slate-400">(you)</span>}</td>
                <td className="td">{u.full_name}</td>
                <td className="td capitalize">{u.role}</td>
                <td className="td">{!u.is_active ? <span className="text-slate-400">Disabled</span> : u.locked_until && new Date(u.locked_until) > new Date() ? <button className="text-orange-600 underline" onClick={() => unlock(u.id)}>Locked – unlock</button> : <span className="text-green-700">Active</span>}</td>
                <td className="td text-xs">{istDateTime(u.last_login_at)}</td>
                <td className="td text-right"><button className="btn-secondary px-3 py-1" onClick={() => setForm({ id: u.id, username: u.username, fullName: u.full_name, role: u.role, isActive: u.is_active, password: '' })}>Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {form && (
        <Modal title={form.id ? `Edit ${form.username}` : 'Add user'} onClose={() => setForm(null)}>
          <ErrorBox msg={err} />
          <div className="space-y-4">
            {!form.id && <div><label className="label">Username</label><input className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></div>}
            <div><label className="label">Full name</label><input className="input" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></div>
            <div><label className="label">Role</label>
              <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {Object.entries(roles).map(([k, v]) => <option key={k} value={k}>{k} — {v}</option>)}
              </select></div>
            <div><label className="label">{form.id ? 'New password (leave blank to keep)' : 'Password'}</label><input className="input" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
            {form.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Account active</label>}
            <p className="text-xs text-slate-400">Passwords need 10+ characters with letters and numbers. Changing a role or password signs that user out.</p>
            <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={() => setForm(null)}>Cancel</button><button className="btn-primary" onClick={save}>Save</button></div>
          </div>
        </Modal>
      )}
      <ChangeOwnPassword />
    </>
  );
}

function ChangeOwnPassword() {
  const toast = useToast();
  const [f, setF] = useState({ currentPassword: '', newPassword: '' });
  async function go() {
    try {
      await adminApi('/auth/change-password', { method: 'POST', body: f });
      toast('Password changed');
      setF({ currentPassword: '', newPassword: '' });
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  }
  return (
    <div className="card mt-6 max-w-md p-5">
      <h2 className="mb-3 font-bold">Change my password</h2>
      <input className="input mb-2" type="password" placeholder="Current password" value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} />
      <input className="input mb-3" type="password" placeholder="New password" value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} />
      <button className="btn-primary" onClick={go}>Change password</button>
    </div>
  );
}
