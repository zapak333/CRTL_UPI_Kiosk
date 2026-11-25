import { createContext, useContext, useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import logo from '../components/logo.svg';
import { adminApi } from '../lib/api';
import AuditPage from './pages/AuditPage';
import CategoriesPage from './pages/CategoriesPage';
import DashboardPage from './pages/DashboardPage';
import LoginPage from './pages/LoginPage';
import MenuPage from './pages/MenuPage';
import OrdersPage from './pages/OrdersPage';
import PaymentsPage from './pages/PaymentsPage';
import ReportsPage from './pages/ReportsPage';
import SettingsPage from './pages/SettingsPage';
import SetupPage from './pages/SetupPage';
import UsersPage from './pages/UsersPage';
import { ToastProvider } from './ui';

export interface AdminUser {
  id: number;
  username: string;
  fullName: string;
  role: 'superadmin' | 'admin' | 'staff';
  permissions: string[];
}
const UserCtx = createContext<{ user: AdminUser; can: (p: string) => boolean } | null>(null);
export const useUser = () => useContext(UserCtx)!;

const nav = [
  { to: 'dashboard', label: 'Dashboard', icon: '▦', perm: 'dashboard.view' },
  { to: 'orders', label: 'Orders', icon: '🧾', perm: 'orders.view' },
  { to: 'payments', label: 'Payments', icon: '₹', perm: 'reports.view' },
  { to: 'menu', label: 'Food Menu', icon: '🍽', perm: 'menu.manage' },
  { to: 'categories', label: 'Categories', icon: '▤', perm: 'menu.manage' },
  { to: 'reports', label: 'Reports', icon: '📈', perm: 'reports.view' },
  { to: 'settings', label: 'Settings', icon: '⚙', perm: 'printer.manage' },
  { to: 'users', label: 'Users', icon: '👤', perm: 'users.manage' },
  { to: 'audit', label: 'Audit Log', icon: '🛡', perm: 'audit.view' },
];

export default function AdminApp() {
  const [user, setUser] = useState<AdminUser | null | undefined>(undefined);
  const loc = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    document.title = 'CRTL Canteen Admin';
    adminApi<{ user: AdminUser }>('/auth/me').then((r) => setUser(r.user)).catch(() => setUser(null));
  }, []);
  useEffect(() => {
    const h = () => {
      setUser(null);
      navigate('/admin/login?expired=1');
    };
    window.addEventListener('crtl:unauthorized', h);
    return () => window.removeEventListener('crtl:unauthorized', h);
  }, [navigate]);

  if (user === undefined) return <div className="p-10 text-slate-400">Loading…</div>;

  return (
    <ToastProvider>
      <Routes>
        <Route path="setup" element={<SetupPage />} />
        <Route path="login" element={user ? <Navigate to="/admin/dashboard" replace /> : <LoginPage onLogin={setUser} />} />
        <Route path="*" element={user ? <Shell user={user} onLogout={() => setUser(null)} /> : <Navigate to={`/admin/login?next=${encodeURIComponent(loc.pathname)}`} replace />} />
      </Routes>
    </ToastProvider>
  );
}

function Shell({ user, onLogout }: { user: AdminUser; onLogout: () => void }) {
  const can = (p: string) => user.permissions.includes(p);
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  async function logout() {
    await adminApi('/auth/logout', { method: 'POST' }).catch(() => {});
    onLogout();
  }
  const first = nav.find((n) => can(n.perm))?.to ?? 'orders';
  return (
    <UserCtx.Provider value={{ user, can }}>
      <div className="flex min-h-full">
        <aside className={`fixed inset-y-0 left-0 z-30 w-60 shrink-0 flex-col bg-navy-900 text-blue-100 print:hidden lg:static lg:flex ${open ? 'flex' : 'hidden'}`}>
          <div className="flex items-center gap-3 px-5 py-5">
            <img src={logo} alt="" className="h-9 w-9" />
            <div>
              <div className="font-bold text-white">CRTL Canteen</div>
              <div className="text-xs text-blue-300">Administration</div>
            </div>
          </div>
          <nav className="flex-1 space-y-0.5 px-3">
            {nav.filter((n) => can(n.perm)).map((n) => (
              <NavLink key={n.to} to={`/admin/${n.to}`} className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-white/10 text-white' : 'hover:bg-white/5'}`}>
                <span className="w-5 text-center">{n.icon}</span>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="border-t border-white/10 p-4 text-sm">
            <div className="font-semibold text-white">{user.fullName || user.username}</div>
            <div className="text-xs capitalize text-blue-300">{user.role}</div>
            <button onClick={logout} className="mt-3 w-full rounded-lg bg-white/10 py-2 text-sm font-semibold hover:bg-white/20">Log out</button>
          </div>
        </aside>
        {open && <div className="fixed inset-0 z-20 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}
        <main className="min-w-0 flex-1">
          <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 print:hidden lg:hidden">
            <button onClick={() => setOpen(true)} className="btn-secondary px-3" aria-label="Menu">☰</button>
            <span className="font-bold">CRTL Canteen Admin</span>
          </div>
          <div className="mx-auto max-w-7xl p-4 sm:p-6 print:p-0">
            <Routes>
              {can('dashboard.view') && <Route path="dashboard" element={<DashboardPage />} />}
              {can('orders.view') && <Route path="orders" element={<OrdersPage />} />}
              {can('reports.view') && <Route path="payments" element={<PaymentsPage />} />}
              {can('menu.manage') && <Route path="menu" element={<MenuPage />} />}
              {can('menu.manage') && <Route path="categories" element={<CategoriesPage />} />}
              {can('reports.view') && <Route path="reports" element={<ReportsPage />} />}
              {can('printer.manage') && <Route path="settings" element={<SettingsPage />} />}
              {can('users.manage') && <Route path="users" element={<UsersPage />} />}
              {can('audit.view') && <Route path="audit" element={<AuditPage />} />}
              <Route path="*" element={<Navigate to={`/admin/${first}`} replace />} />
            </Routes>
          </div>
        </main>
      </div>
    </UserCtx.Provider>
  );
}
