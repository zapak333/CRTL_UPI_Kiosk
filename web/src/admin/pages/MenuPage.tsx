import { useMemo, useState } from 'react';
import { adminApi } from '../../lib/api';
import { inr, istDateTime } from '../../lib/format';
import { Badge, ErrorBox, Modal, PageHeader, useAsync, useToast } from '../ui';
import { ImageUpload } from './ImageUpload';

interface Item { id: number; name: string; description: string; category_id: number; category_name: string; image_url: string | null; price: string; availability_status: string; display_order: number; updated_at: string }
interface Cat { id: number; name: string }

const empty = { name: '', description: '', category_id: 0, image_url: null as string | null, price: '', availability_status: 'available' };

export default function MenuPage() {
  const toast = useToast();
  const items = useAsync(() => adminApi<Item[]>('/menu/items'));
  const cats = useAsync(() => adminApi<Cat[]>('/menu/categories'));
  const [edit, setEdit] = useState<(typeof empty & { id?: number }) | null>(null);
  const [catFilter, setCatFilter] = useState(0);
  const [q, setQ] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<Item | null>(null);

  const list = useMemo(() => (items.data ?? []).filter((i) => (!catFilter || i.category_id === catFilter) && i.name.toLowerCase().includes(q.toLowerCase())), [items.data, catFilter, q]);

  async function save() {
    if (!edit) return;
    setErr(null);
    try {
      const body = { ...edit, category_id: Number(edit.category_id) };
      delete (body as any).id;
      if (edit.id) await adminApi(`/menu/items/${edit.id}`, { method: 'PUT', body });
      else await adminApi('/menu/items', { method: 'POST', body });
      toast(edit.id ? 'Item updated' : 'Item added');
      setEdit(null);
      items.reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  async function setStatus(i: Item, availability_status: string) {
    try {
      await adminApi(`/menu/items/${i.id}`, { method: 'PUT', body: { availability_status } });
      items.reload();
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  }
  async function del(i: Item) {
    try {
      await adminApi(`/menu/items/${i.id}`, { method: 'DELETE' });
      toast(`${i.name} deleted (sales history kept)`);
      setConfirmDel(null);
      items.reload();
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  }
  async function move(i: Item, dir: -1 | 1) {
    const sameCat = (items.data ?? []).filter((x) => x.category_id === i.category_id);
    const idx = sameCat.findIndex((x) => x.id === i.id);
    const j = idx + dir;
    if (j < 0 || j >= sameCat.length) return;
    const ids = sameCat.map((x) => x.id);
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    await adminApi('/menu/items/reorder', { method: 'POST', body: { ids } });
    items.reload();
  }

  return (
    <>
      <PageHeader title="Food Menu" sub={`${items.data?.length ?? 0} items`}>
        <input className="input w-52" placeholder="Search items…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input w-44" value={catFilter} onChange={(e) => setCatFilter(Number(e.target.value))}>
          <option value={0}>All categories</option>
          {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button className="btn-primary" onClick={() => setEdit({ ...empty, category_id: catFilter || cats.data?.[0]?.id || 0 })}>+ Add item</button>
      </PageHeader>
      <ErrorBox msg={items.error} />
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr><th className="th">Order</th><th className="th">Item</th><th className="th">Category</th><th className="th text-right">Price</th><th className="th">Availability</th><th className="th">Updated</th><th className="th"></th></tr>
          </thead>
          <tbody>
            {list.map((i) => (
              <tr key={i.id} className="border-b border-slate-100">
                <td className="td">
                  <div className="flex flex-col text-xs">
                    <button className="text-slate-400 hover:text-navy-700" onClick={() => move(i, -1)} aria-label="Move up">▲</button>
                    <button className="text-slate-400 hover:text-navy-700" onClick={() => move(i, 1)} aria-label="Move down">▼</button>
                  </div>
                </td>
                <td className="td">
                  <div className="flex items-center gap-3">
                    {i.image_url ? <img src={i.image_url} className="h-10 w-14 rounded object-cover" alt="" /> : <div className="h-10 w-14 rounded bg-slate-100" />}
                    <div><div className="font-semibold">{i.name}</div><div className="max-w-xs truncate text-xs text-slate-500">{i.description}</div></div>
                  </div>
                </td>
                <td className="td">{i.category_name}</td>
                <td className="td text-right font-semibold tabular-nums">{inr(i.price, { decimals: true })}</td>
                <td className="td">
                  <select className={`rounded-md border-0 py-1 text-xs font-semibold ring-1 ring-slate-200 ${i.availability_status === 'available' ? 'text-green-700' : i.availability_status === 'disabled' ? 'text-slate-500' : 'text-orange-700'}`} value={i.availability_status} onChange={(e) => setStatus(i, e.target.value)}>
                    <option value="available">Available</option>
                    <option value="temporarily_unavailable">Temporarily unavailable</option>
                    <option value="disabled">Disabled (hidden)</option>
                  </select>
                </td>
                <td className="td text-xs text-slate-500">{istDateTime(i.updated_at)}</td>
                <td className="td text-right">
                  <button className="btn-secondary mr-2 px-3 py-1" onClick={() => setEdit({ id: i.id, name: i.name, description: i.description, category_id: i.category_id, image_url: i.image_url, price: i.price, availability_status: i.availability_status })}>Edit</button>
                  <button className="rounded px-2 py-1 text-sm font-semibold text-red-600 hover:bg-red-50" onClick={() => setConfirmDel(i)}>Delete</button>
                </td>
              </tr>
            ))}
            {items.data && !list.length && <tr><td colSpan={7} className="p-8 text-center text-slate-400">No items.</td></tr>}
          </tbody>
        </table>
      </div>

      {edit && (
        <Modal title={edit.id ? 'Edit food item' : 'Add food item'} onClose={() => setEdit(null)}>
          <ErrorBox msg={err} />
          <div className="space-y-4">
            <div><label className="label">Dish name</label><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus /></div>
            <div><label className="label">Short description (optional)</label><input className="input" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Category</label>
                <select className="input" value={edit.category_id} onChange={(e) => setEdit({ ...edit, category_id: Number(e.target.value) })}>
                  {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select></div>
              <div><label className="label">Price (₹)</label><input className="input" inputMode="decimal" value={edit.price} onChange={(e) => setEdit({ ...edit, price: e.target.value })} placeholder="e.g. 25 or 25.50" /></div>
            </div>
            <div><label className="label">Availability</label>
              <select className="input" value={edit.availability_status} onChange={(e) => setEdit({ ...edit, availability_status: e.target.value })}>
                <option value="available">Available</option>
                <option value="temporarily_unavailable">Temporarily unavailable (shown greyed out)</option>
                <option value="disabled">Disabled (hidden from kiosk)</option>
              </select></div>
            <div><label className="label">Food image</label><ImageUpload value={edit.image_url} onChange={(url) => setEdit({ ...edit, image_url: url })} /></div>
            {edit.id && <p className="text-xs text-slate-500">Price changes apply to new orders only. Past orders keep the price they were sold at.</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-secondary" onClick={() => setEdit(null)}>Cancel</button>
              <button className="btn-primary" onClick={save}>Save</button>
            </div>
          </div>
        </Modal>
      )}
      {confirmDel && (
        <Modal title="Delete food item?" onClose={() => setConfirmDel(null)}>
          <p className="text-sm text-slate-600"><b>{confirmDel.name}</b> will be removed from the menu. Its past sales stay in all reports. To hide it only for today, set it to “Temporarily unavailable” instead.</p>
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setConfirmDel(null)}>Keep</button>
            <button className="btn-danger" onClick={() => del(confirmDel)}>Delete</button>
          </div>
        </Modal>
      )}
      <p className="mt-3 text-xs text-slate-400"><Badge v="available" /> items are orderable; temporarily unavailable items show greyed out; disabled items are hidden from the kiosk.</p>
    </>
  );
}
