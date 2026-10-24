import '@fontsource/cormorant-garamond/latin-400-italic.css';
import '@fontsource/cormorant-garamond/latin-400.css';
import '@fontsource/cormorant-garamond/latin-500.css';
import '@fontsource/cormorant-garamond/latin-600.css';
import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-500.css';
import '@fontsource/dm-sans/latin-600.css';
import '@fontsource/dm-sans/latin-700.css';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  Bell,
  CalendarDays,
  ChartNoAxesCombined,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Flower2,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Menu,
  MoreHorizontal,
  Package,
  Radio,
  RefreshCw,
  Scissors,
  Search,
  Settings,
  Sparkles,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import React, { useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BrowserRouter,
  Link,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { api, branchId, dateNow, post, setActor, setBranch, setCsrf, time } from './api';
import { Avatar, Empty, IconButton } from './components/ui';
import { UI } from './context';
import { BookingDetail, BookingModal } from './features/bookings';
import { CustomerPortal, Login, ReceiptPage } from './features/customer';
import { AssistantDrawer } from './pages/assistant';
import { CalendarPage } from './pages/calendar';
import { ClientsPage } from './pages/clients';
import { DisplayPage } from './pages/display';
import { InventoryPage } from './pages/inventory';
import { Overview } from './pages/overview';
import { QueuePage } from './pages/queue';
import { ReportsPage } from './pages/reports';
import { ServicesPage } from './pages/services';
import { SettingsPage } from './pages/settings';
import { TeamPage } from './pages/team';
import './styles.css';
import './accessibility.css';
const qc = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 15000 } },
});
type Toast = { text: string; type: 'success' | 'error' };
const navItems = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/calendar', label: 'Appointments', icon: CalendarDays },
  { to: '/queue', label: 'Live queue', icon: Radio },
  { to: '/clients', label: 'Clients', icon: Users },
  { to: '/team', label: 'Team', icon: UserRound },
  { to: '/services', label: 'Services', icon: Scissors },
  { to: '/inventory', label: 'Inventory', icon: Package },
  { to: '/reports', label: 'Reports', icon: ChartNoAxesCombined },
];
function App() {
  const [toast, setToast] = useState<Toast | null>(null),
    [date, setDate] = useState(dateNow()),
    [booking, setBooking] = useState<{ walkIn: boolean; services: string[] } | null>(null),
    [detail, setDetail] = useState<any>(null),
    [sidebar, setSidebar] = useState(false),
    [assistant, setAssistant] = useState(false),
    [notifications, setNotifications] = useState(false),
    [search, setSearch] = useState(''),
    [roleMenu, setRoleMenu] = useState(false);
  const location = useLocation(),
    navigate = useNavigate();
  const queryClient = useQueryClient();
  const publicPage =
    location.pathname.startsWith('/book') || location.pathname.startsWith('/receipt/');
  const config = useQuery({ queryKey: ['config'], queryFn: () => api('/config') });
  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        const m = await api('/me');
        setCsrf(m.csrf);
        setActor(m.id);
        if (!branchId || !m.branches.some((b: any) => b.id === branchId))
          setBranch(m.branches[0]?.id || '');
        return m;
      } catch (e) {
        if ((e as any).status === 401) return null;
        throw e;
      }
    },
    retry: false,
  });
  const state = useQuery({
    queryKey: ['state', branchId, date, me.data?.id],
    queryFn: () => api(`/state?date=${date}`),
    enabled: !!me.data && !publicPage && me.data.role !== 'customer',
  });
  const notify = (text: string, type: 'success' | 'error' = 'success') => setToast({ text, type });
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    setSidebar(false);
    setSearch('');
  }, [location.pathname]);
  useEffect(() => {
    if (!me.data || publicPage || me.data.role === 'customer') return;
    const stream = new EventSource('/api/v1/events?branch_id=' + branchId);
    stream.addEventListener('invalidate', () =>
      queryClient.invalidateQueries({ queryKey: ['state'] }),
    );
    return () => stream.close();
  }, [me.data?.id, branchId, publicPage]);
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['state'] });
    queryClient.invalidateQueries({ queryKey: ['my-bookings'] });
  };
  const context = {
    notify,
    me: me.data,
    date,
    setDate,
    openBooking: (walkIn = false, services: string[] = []) => setBooking({ walkIn, services }),
    openDetail: setDetail,
    state: state.data,
    refresh,
  };
  async function demoLogin(role = 'owner') {
    try {
      await post('/auth/demo', { role });
      queryClient.clear();
      await queryClient.invalidateQueries();
      setRoleMenu(false);
      if (role === 'customer') navigate('/book/appointments');
      else navigate('/');
    } catch (e: any) {
      notify(e.message, 'error');
    }
  }
  const active = navItems.find((n) => n.to === location.pathname)?.label || 'Settings';
  if (publicPage)
    return (
      <UI.Provider value={context}>
        <Routes>
          <Route path="/book/*" element={<CustomerPortal config={config.data} />} />
          <Route path="/receipt/:id" element={<ReceiptPage />} />
        </Routes>
        {toast && (
          <div className={`toast ${toast.type}`} role="status">
            {toast.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
            <span>{toast.text}</span>
            <button aria-label="Dismiss notification" onClick={() => setToast(null)}>
              <X size={16} />
            </button>
          </div>
        )}
      </UI.Provider>
    );
  if (me.isPending || config.isPending)
    return (
      <div className="loading-screen">
        <Flower2 className="spin-slow" size={40} />
        <h1>
          aurelle<span>®</span>
        </h1>
        <p>Making room for a beautiful day…</p>
      </div>
    );
  if (!me.data)
    return (
      <UI.Provider value={context}>
        <Login demo={config.data?.demo} onDemo={() => demoLogin()} />
        {toast && (
          <div className={`toast ${toast.type}`} role="status">
            {toast.text}
          </div>
        )}
      </UI.Provider>
    );
  if (me.data.role === 'customer')
    return (
      <UI.Provider value={context}>
        <CustomerPortal config={config.data} />
      </UI.Provider>
    );
  const matching =
    state.data?.bookings
      .filter((b: any) =>
        `${b.customer_name} ${b.reference} ${b.customer_phone}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      )
      .slice(0, 6) || [];
  return (
    <UI.Provider value={context}>
      <div className="app-shell">
        {sidebar && <div className="sidebar-scrim" onClick={() => setSidebar(false)} />}
        <aside className={`sidebar ${sidebar ? 'open' : ''}`}>
          <Link to="/" className="brand">
            <Flower2 size={32} strokeWidth={1.1} />
            <span>
              aurelle<sup>®</sup>
            </span>
          </Link>
          <div className="brand-tagline">SALON, BEAUTIFULLY MANAGED.</div>
          <div className="branch-switch">
            <span className="branch-monogram">a.</span>
            <div>
              <strong>Aurelle Studio</strong>
              <select
                aria-label="Select branch"
                value={branchId}
                onChange={(e) => {
                  setBranch(e.target.value);
                  queryClient.invalidateQueries({ queryKey: ['state'] });
                }}
              >
                {me.data.branches.map((b: any) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <ChevronDown size={15} />
          </div>
          <div className="nav-label">WORKSPACE</div>
          <nav>
            {navItems
              .filter(
                (n) =>
                  me.data.role !== 'professional' || ['/', '/calendar', '/queue'].includes(n.to),
              )
              .map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}
                >
                  <item.icon size={19} strokeWidth={1.6} />
                  <span>{item.label}</span>
                  {item.to === '/queue' && (
                    <span className="nav-count">
                      {state.data?.steps.filter((s: any) =>
                        ['READY', 'CALLED', 'ACTIVE'].includes(s.state),
                      ).length || 0}
                    </span>
                  )}
                </NavLink>
              ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="studio-note">
              <span className="note-icon">
                <Sparkles size={20} />
              </span>
              <h4>A little help. A lot more flow.</h4>
              <p>Meet your thoughtful salon assistant.</p>
              <button onClick={() => setAssistant(true)}>
                Try the assistant <ArrowUpRight size={15} />
              </button>
            </div>
            <NavLink to="/settings" className="nav-item">
              <Settings size={19} strokeWidth={1.6} />
              <span>Settings</span>
            </NavLink>
            <Link to="/book" className="nav-item">
              <ExternalLink size={18} strokeWidth={1.6} />
              <span>Booking page</span>
              <ArrowUpRight size={14} />
            </Link>
            <div className="sidebar-user">
              <Avatar name={me.data.name} color="peach" />
              <div>
                <strong>{me.data.name}</strong>
                <small>{me.data.role === 'owner' ? 'Studio owner' : me.data.role}</small>
              </div>
              <div className="relative">
                <IconButton label="Account options" onClick={() => setRoleMenu(!roleMenu)}>
                  <MoreHorizontal size={19} />
                </IconButton>
                {roleMenu && (
                  <div className="dropdown account-menu">
                    <strong>Workspace access</strong>
                    {config.data?.demo &&
                      ['owner', 'receptionist', 'professional', 'customer'].map((role) => (
                        <button key={role} onClick={() => demoLogin(role)}>
                          Explore as {role}
                        </button>
                      ))}
                    <button
                      onClick={async () => {
                        await post('/auth/logout');
                        queryClient.clear();
                        setRoleMenu(false);
                      }}
                    >
                      Sign out <LogOut size={15} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </aside>
        <div className="workspace">
          <header className="topbar">
            <div className="breadcrumb">
              <IconButton
                label="Open navigation"
                className="mobile-menu"
                onClick={() => setSidebar(true)}
              >
                <Menu size={22} />
              </IconButton>
              <span>Workspace</span>
              <ChevronRight size={14} />
              <strong>{active}</strong>
            </div>
            <div className="topbar-right">
              <div className="global-search">
                <Search size={17} />
                <input
                  placeholder="Search appointments…"
                  aria-label="Search appointments"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <kbd>⌕</kbd>
                {search && (
                  <div className="dropdown search-results">
                    {matching.length ? (
                      matching.map((b: any) => (
                        <button
                          key={b.id}
                          onClick={() => {
                            setDetail(b);
                            setSearch('');
                          }}
                        >
                          <Avatar name={b.customer_name} />
                          <div>
                            <strong>{b.customer_name}</strong>
                            <small>
                              {time(b.starts_at)} · {b.reference}
                            </small>
                          </div>
                          <ArrowUpRight size={16} />
                        </button>
                      ))
                    ) : (
                      <p>No appointments found for this day.</p>
                    )}
                  </div>
                )}
              </div>
              <span className="top-divider" />
              <span className="sample-label">
                <span /> {config.data?.demo ? 'Sample workspace' : 'Live workspace'}
              </span>
              <div className="relative">
                <IconButton
                  label="View activity notifications"
                  onClick={() => setNotifications(!notifications)}
                >
                  <Bell size={19} />
                  {state.data?.products.some((p: any) => p.on_hand <= p.reorder_at) && (
                    <i className="notification-dot" />
                  )}
                </IconButton>
                {notifications && (
                  <div className="dropdown notifications">
                    <h3>A little heads-up</h3>
                    {state.data?.products
                      .filter((p: any) => p.on_hand <= p.reorder_at)
                      .map((p: any) => (
                        <button
                          key={p.id}
                          onClick={() => {
                            navigate('/inventory');
                            setNotifications(false);
                          }}
                        >
                          <Package size={18} />
                          <div>
                            <strong>{p.name} is running low</strong>
                            <small>
                              {p.on_hand} {p.unit} remaining
                            </small>
                          </div>
                        </button>
                      ))}
                    {!state.data?.audit.length ? (
                      <p>Your workspace is up to date.</p>
                    ) : (
                      state.data.audit.slice(0, 3).map((a: any, i: number) => (
                        <div className="activity-item" key={i}>
                          <Activity size={16} />
                          <span>{a.action.replaceAll('.', ' ').replaceAll('_', ' ')}</span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          </header>
          <main id="main-content">
            {state.isPending ? (
              <div className="page-loading">
                <LoaderCircle className="spin" /> Bringing your studio into view…
              </div>
            ) : state.isError ? (
              <Empty
                title="Your workspace is taking a moment"
                description={(state.error as Error).message}
                action={
                  <button className="btn primary" onClick={() => state.refetch()}>
                    <RefreshCw size={16} />
                    Try again
                  </button>
                }
              />
            ) : (
              <Routes>
                <Route path="/" element={<Overview />} />
                <Route path="/calendar" element={<CalendarPage />} />
                <Route path="/queue" element={<QueuePage />} />
                <Route path="/clients" element={<ClientsPage />} />
                <Route path="/team" element={<TeamPage />} />
                <Route path="/services" element={<ServicesPage />} />
                <Route path="/inventory" element={<InventoryPage />} />
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/settings" element={<SettingsPage config={config.data} />} />
                <Route path="/display" element={<DisplayPage />} />
                <Route
                  path="*"
                  element={
                    <Empty
                      title="This page wandered off"
                      description="Return to your workspace to keep the day moving."
                      action={
                        <Link to="/" className="btn primary">
                          Back to overview
                        </Link>
                      }
                    />
                  }
                />
              </Routes>
            )}
          </main>
          <footer className="workspace-footer">
            <span>Thoughtfully made for your everyday.</span>
            <span>
              <span className="status-dot" />{' '}
              {state.isError
                ? 'Connection needs attention'
                : state.isFetching
                  ? 'Syncing your studio…'
                  : 'Studio data up to date'}
              <span className="footer-dot">·</span>Asia/Karachi
            </span>
          </footer>
        </div>
        {booking && (
          <BookingModal
            walkIn={booking.walkIn}
            initialServices={booking.services}
            onClose={() => setBooking(null)}
          />
        )}
        {detail && (
          <BookingDetail bookingId={detail.id} initial={detail} onClose={() => setDetail(null)} />
        )}
        {assistant && (
          <AssistantDrawer
            configured={config.data?.ai_configured}
            onClose={() => setAssistant(false)}
          />
        )}
        {toast && (
          <div className={`toast ${toast.type}`} role="status">
            {toast.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
            <span>{toast.text}</span>
            <button aria-label="Dismiss notification" onClick={() => setToast(null)}>
              <X size={16} />
            </button>
          </div>
        )}
      </div>
    </UI.Provider>
  );
}
class ErrorBoundary extends React.Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    if (this.state.error)
      return (
        <div className="loading-screen">
          <Flower2 size={40} />
          <h1>A little pause.</h1>
          <p>The interface hit an unexpected issue. Your saved studio data is safe.</p>
          <button className="btn primary" onClick={() => window.location.reload()}>
            Refresh the workspace
          </button>
        </div>
      );
    return this.props.children;
  }
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={qc}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
