import { useEffect, useMemo, useRef, useState } from 'react';
import { inr } from '../lib/format';
import type { Cart } from './KioskApp';
import type { Category, MenuItem } from './types';

const ALL = 0;

export function MenuGrid({ categories, items, cart, setQty, maxQty }: {
  categories: Category[];
  items: MenuItem[];
  cart: Cart;
  setQty: (id: number, q: number) => void;
  maxQty: number;
}) {
  const [active, setActive] = useState<number>(ALL);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [active]);
  const visibleCats = useMemo(() => categories.filter((c) => items.some((i) => i.category_id === c.id)), [categories, items]);
  const sections = active === ALL ? visibleCats : visibleCats.filter((c) => c.id === active);

  return (
    <div className="flex min-w-0 flex-1">
      <nav className="no-scrollbar flex w-48 shrink-0 flex-col gap-2 overflow-y-auto bg-white p-3 shadow-inner xl:w-56">
        <CatButton label="All Items" active={active === ALL} onClick={() => setActive(ALL)} emoji="🍽️" />
        {visibleCats.map((c) => (
          <CatButton key={c.id} label={c.name} img={c.image_url} active={active === c.id} onClick={() => setActive(c.id)} />
        ))}
      </nav>
      <div ref={scroller} className="no-scrollbar min-w-0 flex-1 overflow-y-auto p-5">
        {sections.map((c) => (
          <section key={c.id} className="mb-8">
            <h2 className="mb-3 text-2xl font-bold text-navy-800">{c.name}</h2>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 2xl:grid-cols-4">
              {items.filter((i) => i.category_id === c.id).map((i) => (
                <ItemCard key={i.id} item={i} qty={cart[i.id] ?? 0} setQty={setQty} maxQty={maxQty} />
              ))}
            </div>
          </section>
        ))}
        {!sections.length && <div className="mt-24 text-center text-2xl text-slate-400">No items are available right now.</div>}
      </div>
    </div>
  );
}

function CatButton({ label, img, emoji, active, onClick }: { label: string; img?: string | null; emoji?: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex min-h-[72px] items-center gap-3 rounded-2xl px-3 py-2 text-left text-lg font-semibold transition active:scale-95 ${
        active ? 'bg-navy-700 text-white shadow-md' : 'bg-slate-100 text-slate-700'
      }`}
    >
      {img ? <img src={img} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" /> : <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/20 text-3xl">{emoji}</span>}
      <span className="leading-tight">{label}</span>
    </button>
  );
}

function ItemCard({ item, qty, setQty, maxQty }: { item: MenuItem; qty: number; setQty: (id: number, q: number) => void; maxQty: number }) {
  const off = !item.available;
  return (
    <div data-item={item.name} className={`relative flex flex-col overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-200 ${off ? 'opacity-50 grayscale' : ''} ${qty ? 'ring-4 ring-green-500' : ''}`}>
      <div className="relative aspect-[4/3] bg-slate-100">
        {item.image_url ? <img src={item.image_url} alt="" className="h-full w-full object-cover" loading="lazy" /> : <div className="flex h-full items-center justify-center text-6xl">🍽️</div>}
        {off && <span className="absolute left-3 top-3 rounded-full bg-slate-900/80 px-3 py-1 text-sm font-bold text-white">Not available now</span>}
        {qty > 0 && <span className="absolute right-3 top-3 flex h-11 min-w-11 items-center justify-center rounded-full bg-green-600 px-2 text-xl font-extrabold text-white shadow">{qty}</span>}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="text-xl font-bold leading-snug">{item.name}</div>
        {item.description && <div className="mt-1 line-clamp-2 text-sm text-slate-500">{item.description}</div>}
        <div className="mt-auto flex items-center justify-between pt-3">
          <div className="text-2xl font-extrabold text-navy-800">{inr(item.price)}</div>
          {off ? null : qty === 0 ? (
            <button onClick={() => setQty(item.id, 1)} className="h-14 rounded-2xl bg-green-600 px-6 text-xl font-bold text-white shadow active:scale-95">
              Add
            </button>
          ) : (
            <Stepper qty={qty} onMinus={() => setQty(item.id, qty - 1)} onPlus={() => setQty(item.id, qty + 1)} plusDisabled={qty >= maxQty} />
          )}
        </div>
      </div>
    </div>
  );
}

export function Stepper({ qty, onMinus, onPlus, plusDisabled, size = 'lg' }: { qty: number; onMinus: () => void; onPlus: () => void; plusDisabled?: boolean; size?: 'lg' | 'md' }) {
  const b = size === 'lg' ? 'h-14 w-14 text-3xl' : 'h-12 w-12 text-2xl';
  return (
    <div className="flex items-center gap-1 rounded-2xl bg-slate-100 p-1">
      <button aria-label="Decrease" onClick={onMinus} className={`${b} rounded-xl bg-white font-bold text-navy-800 shadow-sm active:scale-90`}>−</button>
      <span className={`${size === 'lg' ? 'w-10 text-2xl' : 'w-8 text-xl'} text-center font-extrabold tabular-nums`}>{qty}</span>
      <button aria-label="Increase" onClick={onPlus} disabled={plusDisabled} className={`${b} rounded-xl bg-navy-700 font-bold text-white shadow-sm active:scale-90 disabled:opacity-40`}>+</button>
    </div>
  );
}
