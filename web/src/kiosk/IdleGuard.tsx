import { useEffect, useRef, useState } from 'react';

/** After `seconds` without a touch, ask "Still there?" for 15 s, then reset the kiosk. */
export function IdleGuard({ seconds, onTimeout }: { seconds: number; onTimeout: () => void }) {
  const [warn, setWarn] = useState<number | null>(null);
  const last = useRef(Date.now());
  useEffect(() => {
    const touch = () => {
      last.current = Date.now();
      setWarn(null);
    };
    const ev = ['pointerdown', 'keydown', 'touchstart'];
    ev.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const t = setInterval(() => {
      const idle = (Date.now() - last.current) / 1000;
      if (idle >= seconds + 15) onTimeout();
      else if (idle >= seconds) setWarn(Math.ceil(seconds + 15 - idle));
    }, 500);
    return () => {
      ev.forEach((e) => window.removeEventListener(e, touch));
      clearInterval(t);
    };
  }, [seconds, onTimeout]);
  if (warn === null) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70">
      <div className="animate-pop rounded-3xl bg-white p-10 text-center shadow-2xl">
        <div className="text-6xl">⏳</div>
        <div className="mt-4 text-3xl font-extrabold">Are you still there?</div>
        <div className="mt-2 text-xl text-slate-500">Your order will be cleared in {warn} seconds.</div>
        <button className="mt-8 h-20 w-full rounded-2xl bg-navy-700 px-12 text-2xl font-bold text-white">Continue ordering</button>
      </div>
    </div>
  );
}
