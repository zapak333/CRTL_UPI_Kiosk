import { useEffect } from 'react';
import logo from '../components/logo.svg';
import type { KioskConfig } from './types';

export function ServiceScreen({ title, message, retry, config }: { title: string; message: string; retry: () => void; config?: KioskConfig }) {
  useEffect(() => {
    const t = setInterval(retry, 15_000);
    return () => clearInterval(t);
  }, [retry]);
  return (
    <div className="kiosk flex h-full flex-col items-center justify-center bg-navy-800 p-10 text-center text-white">
      <img src={config?.logo_url || logo} alt="" className="h-28 w-28" />
      <div className="mt-6 text-2xl text-blue-200">{config?.canteen_name ?? 'CRTL Canteen'}</div>
      <h1 className="mt-6 text-5xl font-extrabold">{title}</h1>
      <p className="mt-4 max-w-2xl text-2xl text-blue-100">{message}</p>
    </div>
  );
}
