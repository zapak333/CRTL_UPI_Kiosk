import { useEffect, useState } from 'react';
import { kioskApi } from '../lib/api';
import { inr } from '../lib/format';
import type { KioskOrder } from './types';

const RETURN_SECONDS = 20;

export function SuccessScreen({ order: initial, onDone }: { order: KioskOrder; onDone: () => void }) {
  const [order, setOrder] = useState(initial);
  const [left, setLeft] = useState(RETURN_SECONDS);

  // Keep checking print status for a few seconds so we can show a printer problem clearly.
  useEffect(() => {
    let n = 0;
    const t = setInterval(async () => {
      if (++n > 10) return clearInterval(t);
      const o = await kioskApi<KioskOrder>(`/orders/${initial.id}`, { orderKey: initial.accessKey }).catch(() => null);
      if (o) setOrder(o);
      if (o && o.printStatus !== 'PENDING') clearInterval(t);
    }, 1000);
    return () => clearInterval(t);
  }, [initial.id, initial.accessKey]);

  useEffect(() => {
    const t = setInterval(() => setLeft((l) => l - 1), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (left <= 0) onDone();
  }, [left, onDone]);

  const printFailed = order.printStatus === 'FAILED';
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-8">
      <div className="w-full max-w-3xl rounded-3xl bg-white p-10 text-center shadow-xl">
        <div className="animate-pop mx-auto flex h-28 w-28 items-center justify-center rounded-full bg-green-100 text-7xl text-green-600">✓</div>
        <div className="mt-4 text-4xl font-extrabold text-green-700">Payment Successful</div>
        <div className="mt-6 text-2xl font-semibold text-slate-500">Your order token</div>
        <div className="text-[9rem] font-black leading-none tracking-tight text-navy-800 tabular-nums">#{order.tokenDisplay}</div>
        <div className="mt-2 text-xl text-slate-500">
          {order.orderNumber} · Paid {inr(order.total)} by UPI{order.payment?.transactionRef ? ` · Txn ${order.payment.transactionRef}` : ''}
        </div>

        {printFailed ? (
          <div className="mt-8 rounded-2xl bg-red-50 p-5 text-xl font-semibold text-red-700">
            ⚠ The receipt printer is not responding. Your order is saved and paid — please show token <b>#{order.tokenDisplay}</b> at the counter.
          </div>
        ) : order.printStatus === 'PRINTED' ? (
          <div className="mt-8 rounded-2xl bg-green-50 p-5 text-2xl font-bold text-green-800">🧾 Please collect your printed ticket below and hand it at the counter.</div>
        ) : (
          <div className="mt-8 rounded-2xl bg-slate-50 p-5 text-2xl font-semibold text-slate-600">🖨 Printing your ticket…</div>
        )}

        <div className="mt-8 text-2xl font-bold">THANK YOU! PLEASE COLLECT YOUR ORDER.</div>
        <button onClick={onDone} className="mt-8 h-16 rounded-2xl bg-navy-700 px-12 text-xl font-bold text-white">
          Start new order ({left})
        </button>
      </div>
    </div>
  );
}
