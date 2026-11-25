import { useRef, useState } from 'react';
import { adminApi } from '../../lib/api';

export function ImageUpload({ value, onChange }: { value: string | null; onChange: (url: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function pick(f: File | undefined) {
    if (!f) return;
    setBusy(true);
    setErr(null);
    try {
      const form = new FormData();
      form.append('image', f);
      const r = await adminApi<{ url: string }>('/menu/uploads', { method: 'POST', form });
      onChange(r.url);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = '';
    }
  }
  return (
    <div className="flex items-center gap-3">
      <div className="h-20 w-28 shrink-0 overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200">
        {value ? <img src={value} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-xs text-slate-400">No image</div>}
      </div>
      <div className="space-y-1">
        <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => ref.current?.click()}>{busy ? 'Uploading…' : value ? 'Change image' : 'Upload image'}</button>
        {value && <button type="button" className="ml-2 text-xs text-red-600" onClick={() => onChange(null)}>Remove</button>}
        <div className="text-xs text-slate-400">JPEG, PNG or WebP, max 3 MB</div>
        {err && <div className="text-xs text-red-600">{err}</div>}
      </div>
    </div>
  );
}
