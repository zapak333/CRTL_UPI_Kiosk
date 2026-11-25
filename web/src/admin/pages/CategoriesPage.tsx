import { useState } from 'react';
import { adminApi } from '../../lib/api';
import { ErrorBox, Modal, PageHeader, Toggle, useAsync, useToast } from '../ui';
import { ImageUpload } from './ImageUpload';

interface Cat { id: number; name: string; image_url: string | null; is_active: boolean; display_order: number; item_count: number }

export default function CategoriesPage() {
  const toast = useToast();
  const { data, error, reload } = useAsync(() => adminApi<Cat[]>('/menu/categories'));
  const [edit, setEdit] = useState<{ id?: number; name: string; image_url: string | null; is_active: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!edit) return;
    setErr(null);
    try {
      const { id, ...body } = edit;
      await adminApi(id ? `/menu/categories/${id}` : '/menu/categories', { method: id ? 'PUT' : 'POST', body });
      toast('Category saved');
      setEdit(null);
      reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  async function toggle(c: Cat) {
    await adminApi(`/menu/categories/${c.id}`, { method: 'PUT', body: { is_active: !c.is_active } }).catch((e) => toast(e.message, 'err'));
    reload();
  }
  async function del(c: Cat) {
    if (!confirm(`Delete category "${c.name}"?`)) return;
    try {
      await adminApi(`/menu/categories/${c.id}`, { method: 'DELETE' });
      toast('Category deleted');
      reload();
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  }
  async function move(idx: number, dir: -1 | 1) {
    if (!data) return;
    const ids = data.map((c) => c.id);
    const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    await adminApi('/menu/categories/reorder', { method: 'POST', body: { ids } });
    reload();
  }

  return (
    <>
      <PageHeader title="Categories" sub="Order here is the order shown on the kiosk">
        <button className="btn-primary" onClick={() => setEdit({ name: '', image_url: null, is_active: true })}>+ Add category</button>
      </PageHeader>
      <ErrorBox msg={error} />
      <div className="card divide-y divide-slate-100">
        {data?.map((c, i) => (
          <div key={c.id} className="flex items-center gap-4 p-3">
            <div className="flex flex-col text-xs">
              <button className="text-slate-400 hover:text-navy-700" onClick={() => move(i, -1)} aria-label="Move up">▲</button>
              <button className="text-slate-400 hover:text-navy-700" onClick={() => move(i, 1)} aria-label="Move down">▼</button>
            </div>
            {c.image_url ? <img src={c.image_url} className="h-12 w-16 rounded object-cover" alt="" /> : <div className="h-12 w-16 rounded bg-slate-100" />}
            <div className="flex-1">
              <div className="font-semibold">{c.name}</div>
              <div className="text-xs text-slate-500">{c.item_count} item(s)</div>
            </div>
            <Toggle checked={c.is_active} onChange={() => toggle(c)} label={c.is_active ? 'Active' : 'Inactive'} />
            <button className="btn-secondary px-3 py-1" onClick={() => setEdit({ id: c.id, name: c.name, image_url: c.image_url, is_active: c.is_active })}>Edit</button>
            <button className="rounded px-2 py-1 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-30" disabled={c.item_count > 0} title={c.item_count > 0 ? 'Only empty categories can be deleted' : ''} onClick={() => del(c)}>Delete</button>
          </div>
        ))}
      </div>
      {edit && (
        <Modal title={edit.id ? 'Edit category' : 'Add category'} onClose={() => setEdit(null)}>
          <ErrorBox msg={err} />
          <div className="space-y-4">
            <div><label className="label">Name</label><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus /></div>
            <div><label className="label">Image</label><ImageUpload value={edit.image_url} onChange={(u) => setEdit({ ...edit, image_url: u })} /></div>
            <Toggle checked={edit.is_active} onChange={(v) => setEdit({ ...edit, is_active: v })} label="Show on kiosk" />
            <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={() => setEdit(null)}>Cancel</button><button className="btn-primary" onClick={save}>Save</button></div>
          </div>
        </Modal>
      )}
    </>
  );
}
