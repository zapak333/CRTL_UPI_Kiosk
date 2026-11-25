import { useEffect, useRef, useState } from 'react';
import { ApiError, kioskApi } from '../lib/api';
import { inr } from '../lib/format';
import type { KioskOrder } from './types';

const POLL_MS = 2000;
const IDLE_CANCEL_SECONDS = 60;

export function PaymentScreen({ order, testMode, onUpdate, onPaid, onCancelled }: {
  order: KioskOrder;
  testMode: boolean;
  onUpdate: (o: KioskOrder) => void;
  onPaid: (o: KioskOrder) => void;
  onCancelled: () => void;
}) {
  const key = order.accessKey!;
  const [now, setNow] = useState(Date.now());
  const [netError, setNetError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stoppedAt = useRef<number | null>(null);
  const p = order.payment;
  const remaining = p ? Math.max(0, Math.floor((new Date(p.expiresAt).getTime() - now) / 1000)) : 0;
  const localExpired = p?.status === 'PENDING' && remaining === 0;
  const state: 'pending' | 'failed' | 'expired' | 'cancelled' =
    order.status === 'CANCELLED' || order.status === 'EXPIRED' ? 'cancelled' : p?.status === 'FAILED' ? 'failed' : p?.status === 'EXPIRED' || p?.status === 'CANCELLED' || localExpired ? 'expired' : 'pending';

  // Poll the server. The server itself verifies with the payment provider; the kiosk never decides payment success.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const o = await kioskApi<KioskOrder>(`/orders/${order.id}`, { orderKey: key });
        if (!alive) return;
        setNetError(false);
        if (o.status === 'PAID') onPaid(o);
        else onUpdate(o);
      } catch (e) {
        if (alive) setNetError((e as ApiError).status === 0);
      }
    };
    const t = setInterval(tick, POLL_MS);
    const c = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      alive = false;
      clearInterval(t);
      clearInterval(c);
    };
  }, [order.id, key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-cancel an order left on a failed/expired screen.
  useEffect(() => {
    if (state === 'pending') {
      stoppedAt.current = null;
      return;
    }
    if (state === 'cancelled') {
      const t = setTimeout(onCancelled, 6000);
      return () => clearTimeout(t);
    }
    stoppedAt.current ??= Date.now();
    if (Date.now() - stoppedAt.current > IDLE_CANCEL_SECONDS * 1000) cancel();
  }, [state, now]); // eslint-disable-line react-hooks/exhaustive-deps

  async function retry() {
    setBusy(true);
    setError(null);
    try {
      const o = await kioskApi<KioskOrder>(`/orders/${order.id}/pay`, { method: 'POST', orderKey: key });
      if (o.status === 'PAID') onPaid(o);
      else onUpdate(o);
      stoppedAt.current = null;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    try {
      const o = await kioskApi<KioskOrder>(`/orders/${order.id}/cancel`, { method: 'POST', orderKey: key });
      onUpdate(o);
      onCancelled();
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 409) {
        // Payment arrived while cancelling: show the token instead.
        const o = await kioskApi<KioskOrder>(`/orders/${order.id}`, { orderKey: key }).catch(() => null);
        if (o?.status === 'PAID') return onPaid(o);
      }
      setError(err.message);
    } finally {
      setBusy(false);
      setConfirmCancel(false);
    }
  }

  async function simulate(outcome: string) {
    const ref = p?.qrPayload?.split('/').pop();
    if (ref) await fetch(`/api/simulator/${ref}/${outcome}`, { method: 'POST' }).catch(() => {});
  }

  const mm = String(Math.floor(remaining / 60)).padStart(1, '0');
  const ss = String(remaining % 60).padStart(2, '0');

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center gap-8 p-8">
      <div className="flex w-full max-w-5xl overflow-hidden rounded-3xl bg-white shadow-xl">
        {/* Left: order info */}
        <div className="flex w-[42%] flex-col bg-navy-800 p-8 text-white">
          <div className="text-lg text-blue-200">Order number</div>
          <div className="text-2xl font-bold tracking-wide">{order.orderNumber}</div>
          <div className="mt-6 text-lg text-blue-200">Amount to pay</div>
          <div className="text-6xl font-extrabold tabular-nums">{inr(order.total)}</div>
          <div className="no-scrollbar mt-6 flex-1 space-y-1 overflow-y-auto text-lg text-blue-100">
            {order.items.map((i) => (
              <div key={i.name} className="flex justify-between gap-3">
                <span className="truncate">{i.quantity} × {i.name}</span>
                <span className="tabular-nums">{inr(i.lineTotal)}</span>
              </div>
            ))}
          </div>
          <div className="mt-6 rounded-2xl bg-white/10 p-4 text-base text-blue-100">
            <div className="font-bold text-white">How to pay</div>
            <ol className="mt-1 list-decimal space-y-0.5 pl-5">
              <li>Open any UPI app (GPay, PhonePe, Paytm, BHIM…)</li>
              <li>Scan the QR code on the right</li>
              <li>Check the amount and pay</li>
              <li>Wait here — your token prints automatically</li>
            </ol>
          </div>
        </div>

        {/* Right: QR / status */}
        <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
          {state === 'pending' && p && (
            <>
              <div className="flex items-center gap-3 rounded-full bg-orange-100 px-5 py-2 text-xl font-bold text-orange-700">
                <span className="h-4 w-4 animate-ping rounded-full bg-orange-500" /> Waiting for payment
              </div>
              <div className="relative mt-5 rounded-3xl border-8 border-slate-100 p-3">
                {p.qrDataUrl ? <img src={p.qrDataUrl} alt="UPI QR code" className="h-80 w-80" /> : p.qrImageUrl ? <img src={p.qrImageUrl} alt="UPI QR code" className="h-80 w-80 bg-white object-contain" /> : <div className="flex h-80 w-80 items-center justify-center text-slate-400">Generating QR…</div>}
              </div>
              <div className="mt-4 text-xl text-slate-600">
                Scan to pay <b className="text-navy-800">{inr(p.amount)}</b> · QR valid for <b className="tabular-nums">{mm}:{ss}</b>
              </div>
              {netError && <div className="mt-3 rounded-xl bg-red-50 px-4 py-2 text-lg font-semibold text-red-700">Connection issue — still checking your payment…</div>}
            </>
          )}

          {state === 'failed' && (
            <StatusBlock icon="✕" tone="red" title="Payment failed" text={p?.failureReason ?? 'The payment did not go through. No money was taken for this attempt.'} />
          )}
          {state === 'expired' && <StatusBlock icon="⏱" tone="orange" title="QR code expired" text="Please do not scan the old code. Tap “New QR code” to try again." />}
          {state === 'cancelled' && <StatusBlock icon="✕" tone="slate" title="Order cancelled" text="Returning to the menu…" />}

          {error && <div className="mt-4 rounded-xl bg-red-50 px-4 py-2 text-lg font-semibold text-red-700">{error}</div>}

          {state !== 'cancelled' && (
            <div className="mt-8 flex w-full max-w-md flex-col gap-3">
              {(state === 'failed' || state === 'expired') && (
                <button disabled={busy} onClick={retry} className="h-20 rounded-2xl bg-green-600 text-2xl font-extrabold text-white shadow-lg active:scale-[.98] disabled:opacity-60">
                  {state === 'failed' ? 'Try Again' : 'New QR code'}
                </button>
              )}
              <button
                disabled={busy}
                onClick={() => (confirmCancel ? cancel() : setConfirmCancel(true))}
                className={`h-16 rounded-2xl border-2 text-xl font-bold active:scale-[.98] ${confirmCancel ? 'border-red-600 bg-red-600 text-white' : 'border-slate-300 text-slate-600'}`}
              >
                {confirmCancel ? 'Tap again to cancel order' : 'Cancel Order'}
              </button>
            </div>
          )}

          {testMode && state === 'pending' && (
            <div className="mt-6 w-full max-w-md rounded-2xl border-2 border-dashed border-amber-400 bg-amber-50 p-3">
              <div className="text-sm font-bold uppercase tracking-wide text-amber-800">Test mode simulator</div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <button onClick={() => simulate('success')} className="rounded-xl bg-green-600 py-3 text-sm font-bold text-white">Pay ✓</button>
                <button onClick={() => simulate('fail')} className="rounded-xl bg-red-600 py-3 text-sm font-bold text-white">Decline ✕</button>
                <button onClick={() => simulate('silent')} className="rounded-xl bg-slate-600 py-3 text-sm font-bold text-white">Lost webhook</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBlock({ icon, tone, title, text }: { icon: string; tone: 'red' | 'orange' | 'slate'; title: string; text: string }) {
  const c = { red: 'bg-red-100 text-red-600', orange: 'bg-orange-100 text-orange-600', slate: 'bg-slate-100 text-slate-500' }[tone];
  return (
    <div className="animate-pop">
      <div className={`mx-auto flex h-28 w-28 items-center justify-center rounded-full text-6xl font-bold ${c}`}>{icon}</div>
      <div className="mt-5 text-4xl font-extrabold">{title}</div>
      <div className="mx-auto mt-2 max-w-md text-xl text-slate-500">{text}</div>
    </div>
  );
}
