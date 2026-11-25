import { inr, inrPaise, toPaise } from '../lib/format';
import type { KioskConfig, MenuItem } from './types';

export function ReviewScreen({ lines, subtotal, tax, total, config, busy, notice, onBack, onPay }: {
  lines: { item: MenuItem; qty: number }[];
  subtotal: number;
  tax: number;
  total: number;
  config: KioskConfig;
  busy: boolean;
  notice: string | null;
  onBack: () => void;
  onPay: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-8">
      <div className="flex max-h-full w-full max-w-3xl flex-col rounded-3xl bg-white shadow-xl">
        <div className="border-b border-slate-200 px-8 py-6">
          <h1 className="text-3xl font-extrabold">Review your order</h1>
          <p className="mt-1 text-lg text-slate-500">Check your items, then tap Pay Now to pay with any UPI app.</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-8 py-4">
          <table className="w-full text-xl">
            <thead>
              <tr className="text-left text-base text-slate-400">
                <th className="py-2 font-semibold">Item</th>
                <th className="py-2 text-center font-semibold">Qty</th>
                <th className="py-2 text-right font-semibold">Price</th>
                <th className="py-2 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map(({ item, qty }) => (
                <tr key={item.id} className="border-t border-slate-100">
                  <td className="py-3 font-semibold">{item.name}</td>
                  <td className="py-3 text-center tabular-nums">{qty}</td>
                  <td className="py-3 text-right tabular-nums text-slate-500">{inr(item.price)}</td>
                  <td className="py-3 text-right font-bold tabular-nums">{inrPaise(toPaise(item.price) * qty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-slate-200 px-8 py-6">
          {tax > 0 && (
            <div className="mb-1 flex justify-between text-lg text-slate-500">
              <span>Subtotal {inrPaise(subtotal)} + {config.tax_label} ({config.tax_rate}%)</span>
              <span>{inrPaise(tax)}</span>
            </div>
          )}
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-semibold text-slate-600">Total Payable</span>
            <span className="text-5xl font-extrabold tabular-nums text-navy-800">{inrPaise(total)}</span>
          </div>
          {notice && <div className="mt-4 rounded-xl bg-red-50 p-4 text-lg font-semibold text-red-700">{notice}</div>}
          <div className="mt-6 grid grid-cols-2 gap-4">
            <button onClick={onBack} disabled={busy} className="h-20 rounded-2xl border-2 border-slate-300 text-2xl font-bold text-slate-700 active:scale-[.98]">
              ← Continue Shopping
            </button>
            <button onClick={onPay} disabled={busy || !lines.length} className="h-20 rounded-2xl bg-green-600 text-2xl font-extrabold text-white shadow-lg active:scale-[.98] disabled:opacity-60">
              {busy ? 'Please wait…' : `Pay Now ${inrPaise(total)}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
