import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fn());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, error, loading, reload, setData };
}

const tone: Record<string, string> = {
  PAID: 'bg-green-100 text-green-800',
  SUCCESS: 'bg-green-100 text-green-800',
  PRINTED: 'bg-green-100 text-green-800',
  COMPLETED: 'bg-green-100 text-green-800',
  available: 'bg-green-100 text-green-800',
  PENDING: 'bg-orange-100 text-orange-800',
  PENDING_PAYMENT: 'bg-orange-100 text-orange-800',
  PRINTING: 'bg-orange-100 text-orange-800',
  temporarily_unavailable: 'bg-orange-100 text-orange-800',
  FAILED: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-slate-200 text-slate-700',
  EXPIRED: 'bg-slate-200 text-slate-700',
  NOT_PRINTED: 'bg-slate-100 text-slate-600',
  disabled: 'bg-slate-200 text-slate-700',
  REFUNDED: 'bg-purple-100 text-purple-800',
  PARTIALLY_REFUNDED: 'bg-purple-100 text-purple-800',
};
const label: Record<string, string> = {
  PENDING_PAYMENT: 'Awaiting payment',
  PARTIALLY_REFUNDED: 'Part refunded',
  NOT_PRINTED: 'Not printed',
  temporarily_unavailable: 'Temporarily unavailable',
  SUCCESS: 'Successful',
};
export function Badge({ v }: { v: string | null | undefined }) {
  if (!v) return <span className="text-slate-300">—</span>;
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${tone[v] ?? 'bg-slate-100 text-slate-700'}`}>{label[v] ?? v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, ' ')}</span>;
}

export function PageHeader({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        {sub && <p className="text-sm text-slate-500">{sub}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 pt-16" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`w-full ${wide ? 'max-w-4xl' : 'max-w-lg'} rounded-xl bg-white shadow-2xl`}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-2xl leading-none text-slate-400 hover:text-slate-700" aria-label="Close">×</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function ErrorBox({ msg }: { msg: string | null }) {
  return msg ? <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{msg}</div> : null;
}

type Toast = { id: number; text: string; kind: 'ok' | 'err' };
const ToastCtx = createContext<(text: string, kind?: 'ok' | 'err') => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: 'ok' | 'err' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className={`rounded-lg px-4 py-3 text-sm font-medium text-white shadow-lg ${t.kind === 'ok' ? 'bg-green-600' : 'bg-red-600'}`}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

export function Stat({ label, value, tone = 'navy', sub }: { label: string; value: ReactNode; tone?: 'navy' | 'green' | 'orange' | 'red' | 'purple' | 'slate'; sub?: ReactNode }) {
  const bar = { navy: 'bg-navy-700', green: 'bg-green-600', orange: 'bg-orange-500', red: 'bg-red-600', purple: 'bg-purple-600', slate: 'bg-slate-500' }[tone];
  return (
    <div className="card relative overflow-hidden p-4">
      <div className={`absolute inset-y-0 left-0 w-1 ${bar}`} />
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 truncate text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 text-sm">
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={`relative h-6 w-11 rounded-full transition ${checked ? 'bg-green-600' : 'bg-slate-300'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${checked ? 'left-5' : 'left-0.5'}`} />
      </button>
      {label}
    </label>
  );
}
