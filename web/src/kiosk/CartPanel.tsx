import { inr, inrPaise, toPaise } from '../lib/format';
import { Stepper } from './MenuGrid';
import type { KioskConfig, MenuItem } from './types';

export function CartPanel({ lines, setQty, clear, subtotal, tax, total, count, config, maxQty, notice, onProceed }: {
  lines: { item: MenuItem; qty: number }[];
  setQty: (id: number, q: number) => void;
  clear: () => void;
  subtotal: number;
  tax: number;
  total: number;
  count: number;
  config: KioskConfig;
  maxQty: number;
  notice: string | null;
  onProceed: () => void;
}) {
  return (
    <aside className="flex w-[400px] shrink-0 flex-col border-l border-slate-200 bg-white xl:w-[460px]">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <h2 className="text-2xl font-bold">Your Order {count > 0 && <span className="text-slate-400">({count})</span>}</h2>
        {lines.length > 0 && (
          <button onClick={clear} className="rounded-xl px-3 py-2 text-base font-semibold text-red-600 active:bg-red-50">Clear Cart</button>
        )}
      </div>
      <div className="no-scrollbar flex-1 overflow-y-auto px-4 py-2">
        {lines.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-slate-400">
            <div className="text-7xl">🛒</div>
            <div className="mt-3 text-xl font-semibold">Your cart is empty</div>
            <div className="mt-1 text-base">Tap <b className="text-green-600">Add</b> on any item to start</div>
          </div>
        ) : (
          lines.map(({ item, qty }) => (
            <div key={item.id} className="border-b border-slate-100 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-lg font-bold">{item.name}</div>
                  <div className="text-sm text-slate-500">{inr(item.price)} each</div>
                </div>
                <div className="text-lg font-bold tabular-nums">{inrPaise(toPaise(item.price) * qty)}</div>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <Stepper size="md" qty={qty} onMinus={() => setQty(item.id, qty - 1)} onPlus={() => setQty(item.id, qty + 1)} plusDisabled={qty >= maxQty} />
                <button onClick={() => setQty(item.id, 0)} className="rounded-xl px-4 py-3 text-base font-semibold text-red-600 active:bg-red-50">Remove</button>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="border-t border-slate-200 p-5">
        {notice && <div className="mb-3 rounded-xl bg-red-50 p-3 text-base font-semibold text-red-700">{notice}</div>}
        {tax > 0 && (
          <>
            <Row label="Subtotal" value={inrPaise(subtotal)} />
            <Row label={`${config.tax_label} (${config.tax_rate}%)`} value={inrPaise(tax)} />
          </>
        )}
        <div className="flex items-baseline justify-between py-1">
          <span className="text-xl font-semibold text-slate-600">Total Payable</span>
          <span className="text-4xl font-extrabold tabular-nums text-navy-800">{inrPaise(total)}</span>
        </div>
        {config.tax_enabled && config.tax_mode === 'inclusive' && <div className="text-right text-xs text-slate-400">Prices include {config.tax_label}</div>}
        <button
          onClick={onProceed}
          disabled={lines.length === 0}
          className="mt-3 h-20 w-full rounded-2xl bg-green-600 text-2xl font-extrabold text-white shadow-lg active:scale-[.98] disabled:bg-slate-300 disabled:shadow-none"
        >
          Proceed to Payment →
        </button>
      </div>
    </aside>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-base text-slate-500">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
