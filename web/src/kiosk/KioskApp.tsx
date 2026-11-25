import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, kioskApi } from '../lib/api';
import { inrPaise, toPaise } from '../lib/format';
import { CartPanel } from './CartPanel';
import { Header } from './Header';
import { IdleGuard } from './IdleGuard';
import { MenuGrid } from './MenuGrid';
import { PaymentScreen } from './PaymentScreen';
import { ReviewScreen } from './ReviewScreen';
import { ServiceScreen } from './ServiceScreen';
import { SuccessScreen } from './SuccessScreen';
import type { Category, KioskConfig, KioskOrder, MenuItem } from './types';

export type Cart = Record<number, number>; // itemId -> qty
type Screen = 'menu' | 'review' | 'payment' | 'success';

function randomKey() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b); // works on plain-http LAN kiosks too (randomUUID needs a secure context)
  return 'k' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export default function KioskApp() {
  const [config, setConfig] = useState<KioskConfig | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cart, setCart] = useState<Cart>({});
  const [screen, setScreen] = useState<Screen>('menu');
  const [order, setOrder] = useState<KioskOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const checkoutKey = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, m] = await Promise.all([
        kioskApi<KioskConfig>('/config'),
        kioskApi<{ categories: Category[]; items: MenuItem[] }>('/menu'),
      ]);
      setConfig(c);
      setCategories(m.categories);
      setItems(m.items);
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    document.title = 'CRTL Canteen Kiosk';
    load();
    const t = setInterval(load, 60_000); // pick up menu/price/availability changes
    return () => clearInterval(t);
  }, [load]);

  // Drop cart lines for items that disappeared or became unavailable.
  useEffect(() => {
    setCart((c) => {
      const next: Cart = {};
      let changed = false;
      for (const [id, q] of Object.entries(c)) {
        const it = items.find((i) => i.id === Number(id));
        if (it && it.available) next[Number(id)] = q;
        else changed = true;
      }
      return changed ? next : c;
    });
  }, [items]);

  // Try to enter full-screen on first touch (browsers require a user gesture). Chrome --kiosk does this already.
  useEffect(() => {
    const go = () => {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
    };
    window.addEventListener('pointerdown', go, { once: true });
    const block = (e: Event) => e.preventDefault();
    window.addEventListener('contextmenu', block);
    return () => {
      window.removeEventListener('pointerdown', go);
      window.removeEventListener('contextmenu', block);
    };
  }, []);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const lines = Object.entries(cart)
    .map(([id, qty]) => ({ item: byId.get(Number(id))!, qty }))
    .filter((l) => l.item);
  const subtotal = lines.reduce((a, l) => a + toPaise(l.item.price) * l.qty, 0);
  const tax = config?.tax_enabled && config.tax_mode === 'exclusive' ? Math.round((subtotal * Math.round(config.tax_rate * 100)) / 10000) : 0;
  const total = subtotal + tax;
  const count = lines.reduce((a, l) => a + l.qty, 0);
  const maxQ = config?.max_qty_per_item ?? 20;

  const setQty = (id: number, q: number) => {
    checkoutKey.current = null; // cart changed -> new order on next checkout
    setCart((c) => {
      const n = { ...c };
      if (q <= 0) delete n[id];
      else n[id] = Math.min(q, maxQ);
      return n;
    });
  };
  const clearCart = () => {
    checkoutKey.current = null;
    setCart({});
  };

  const resetAll = useCallback(() => {
    checkoutKey.current = null;
    setCart({});
    setOrder(null);
    setNotice(null);
    setScreen('menu');
    load();
  }, [load]);

  async function payNow() {
    if (!lines.length || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      if (!checkoutKey.current) checkoutKey.current = randomKey();
      const created = await kioskApi<KioskOrder>('/orders', {
        method: 'POST',
        body: { idempotencyKey: checkoutKey.current, kioskId: localStorageGet('crtl.kioskId'), items: lines.map((l) => ({ itemId: l.item.id, quantity: l.qty })) },
      });
      const paid = await kioskApi<KioskOrder>(`/orders/${created.id}/pay`, { method: 'POST', orderKey: created.accessKey });
      setOrder({ ...paid, accessKey: created.accessKey });
      setScreen('payment');
    } catch (e) {
      const err = e as ApiError;
      if (err.code === 'item_unavailable') {
        checkoutKey.current = null;
        await load();
        setScreen('menu');
      }
      setNotice(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (loadError && !config) return <ServiceScreen title="Kiosk is starting…" message="Connecting to the canteen server. Please wait or contact the counter." retry={load} />;
  if (!config) return <div className="kiosk flex h-full items-center justify-center text-2xl text-slate-400">Loading menu…</div>;
  if (!config.open && screen === 'menu')
    return <ServiceScreen title="We are closed right now" message={`Ordering is available from ${config.opening_time} to ${config.closing_time}.`} config={config} retry={load} />;

  return (
    <div className="kiosk flex h-full flex-col overflow-hidden bg-slate-100">
      <Header config={config} />
      {config.paymentTestMode && (
        <div className="bg-amber-400 px-6 py-1 text-center text-sm font-bold tracking-wide text-amber-950">TEST MODE — payments are simulated, no real money is collected</div>
      )}
      {loadError && <div className="bg-red-600 px-6 py-2 text-center font-semibold text-white">Connection problem — showing the last loaded menu. Payments are unavailable until the connection returns.</div>}

      {screen === 'menu' && (
        <div className="flex min-h-0 flex-1">
          <MenuGrid categories={categories} items={items} cart={cart} setQty={setQty} maxQty={maxQ} />
          <CartPanel
            lines={lines}
            setQty={setQty}
            clear={clearCart}
            subtotal={subtotal}
            tax={tax}
            total={total}
            count={count}
            config={config}
            maxQty={maxQ}
            notice={notice}
            onProceed={() => {
              setNotice(null);
              setScreen('review');
            }}
          />
        </div>
      )}

      {screen === 'review' && (
        <ReviewScreen
          lines={lines}
          subtotal={subtotal}
          tax={tax}
          total={total}
          config={config}
          busy={busy}
          notice={notice}
          onBack={() => setScreen('menu')}
          onPay={payNow}
        />
      )}

      {screen === 'payment' && order && (
        <PaymentScreen
          order={order}
          testMode={config.paymentTestMode}
          onUpdate={(o) => setOrder((prev) => ({ ...o, accessKey: prev?.accessKey }))}
          onPaid={(o) => {
            setOrder((prev) => ({ ...o, accessKey: prev?.accessKey }));
            setCart({});
            checkoutKey.current = null;
            setScreen('success');
          }}
          onCancelled={resetAll}
        />
      )}

      {screen === 'success' && order && <SuccessScreen order={order} onDone={resetAll} />}

      {/* Idle protection: abandoned carts are cleared so the next customer starts fresh. */}
      {(screen === 'menu' || screen === 'review') && count > 0 && <IdleGuard seconds={config.kiosk_idle_timeout_seconds} onTimeout={resetAll} />}

      <footer className="flex items-center justify-between bg-white px-6 py-2 text-sm text-slate-400">
        <span>{config.institution_name}</span>
        <span>Need help? Please ask at the counter.</span>
      </footer>
    </div>
  );
}

function localStorageGet(k: string) {
  try {
    return localStorage.getItem(k) ?? undefined;
  } catch {
    return undefined;
  }
}
