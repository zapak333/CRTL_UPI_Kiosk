import { useEffect, useState } from 'react';
import logo from '../components/logo.svg';
import type { KioskConfig } from './types';

export function Header({ config }: { config: KioskConfig }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const date = now.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const time = now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true });
  return (
    <header className="flex items-center justify-between bg-navy-800 px-8 py-4 text-white shadow-lg">
      <div className="flex items-center gap-4">
        <img src={config.logo_url || logo} alt="" className="h-16 w-16 rounded-2xl bg-white/10 object-contain p-1" />
        <div>
          <div className="text-3xl font-extrabold tracking-tight">{config.canteen_name}</div>
          <div className="text-base text-blue-200">{config.institution_name}</div>
        </div>
      </div>
      <div className="hidden text-center text-2xl font-semibold text-blue-50 lg:block">{config.welcome_message}</div>
      <div className="text-right">
        <div className="text-3xl font-bold tabular-nums">{time}</div>
        <div className="text-base text-blue-200">{date}</div>
      </div>
    </header>
  );
}
