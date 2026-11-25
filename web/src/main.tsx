import '@fontsource-variable/inter';
import './index.css';
import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

// Kiosk and admin are separate bundles: the customer screen never downloads admin code.
const KioskApp = lazy(() => import('./kiosk/KioskApp'));
const AdminApp = lazy(() => import('./admin/AdminApp'));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Suspense fallback={<div className="flex h-full items-center justify-center text-slate-400">Loading…</div>}>
        <Routes>
          <Route path="/kiosk/*" element={<KioskApp />} />
          <Route path="/admin/*" element={<AdminApp />} />
          <Route path="*" element={<Navigate to="/kiosk" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </React.StrictMode>,
);
