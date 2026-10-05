import { useState } from 'react';
import { Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { api, getToken, setToken } from './api';
import { Button, ErrorBox, Field, Input, useMe, useMeta } from './ui';
import Dashboard from './pages/Dashboard';
import Clients, { ClientDetail } from './pages/Clients';
import Templates, { TemplateEditor } from './pages/Templates';
import Campaigns, { CampaignEditor } from './pages/Campaigns';
import Offers, { OfferEditor } from './pages/Offers';
import Journeys from './pages/Journeys';
import Segments from './pages/Segments';
import { CallList, Suppression } from './pages/Operations';
import { Banners, Events, Messages } from './pages/Activity';
import { Audit, Settings, Users } from './pages/Settings';

const NAV: Array<{ to: string; label: string; group: string }> = [
  { to: '/', label: 'Dashboard', group: 'Overview' },
  { to: '/journeys', label: 'Journeys', group: 'Engagement' },
  { to: '/campaigns', label: 'Campaigns', group: 'Engagement' },
  { to: '/offers', label: 'Offers', group: 'Engagement' },
  { to: '/segments', label: 'Segments', group: 'Engagement' },
  { to: '/templates', label: 'Templates', group: 'Content' },
  { to: '/banners', label: 'Banners & incidents', group: 'Content' },
  { to: '/clients', label: 'Clients', group: 'Clients' },
  { to: '/calls', label: 'Call list', group: 'Clients' },
  { to: '/suppression', label: 'Suppression', group: 'Clients' },
  { to: '/messages', label: 'Messages', group: 'Activity' },
  { to: '/events', label: 'Events', group: 'Activity' },
  { to: '/settings', label: 'Providers & settings', group: 'Admin' },
  { to: '/users', label: 'Users', group: 'Admin' },
  { to: '/audit', label: 'Audit log', group: 'Admin' },
];

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const nav = useNavigate();
  return (
    <div className="flex min-h-full items-center justify-center bg-ink px-4">
      <form
        className="w-full max-w-sm space-y-4 rounded-xl bg-white p-6 shadow-xl"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            const r = await api<{ token: string }>('/admin/auth/login', { body: { email, password } });
            setToken(r.token);
            nav('/');
            window.location.reload();
          } catch (err) {
            setError(err);
          }
        }}
      >
        <div>
          <p className="text-2xl font-bold tracking-wide text-gold-600">mngm</p>
          <p className="text-sm text-stone-500">Client Engagement Console</p>
        </div>
        <ErrorBox error={error} />
        <Field label="Email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        </Field>
        <Field label="Password">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </Field>
        <Button type="submit" variant="primary">
          Sign in
        </Button>
      </form>
    </div>
  );
}

function Shell() {
  const me = useMe();
  const meta = useMeta();
  const [open, setOpen] = useState(false);
  const groups = [...new Set(NAV.map((n) => n.group))];
  return (
    <div className="flex min-h-full">
      <aside className={`${open ? 'block' : 'hidden'} fixed inset-y-0 z-20 w-60 shrink-0 overflow-y-auto bg-ink text-stone-300 md:static md:block`}>
        <div className="px-5 py-5">
          <p className="text-xl font-bold tracking-wide text-gold-500">mngm</p>
          <p className="text-xs text-stone-400">Engagement console</p>
        </div>
        <nav className="space-y-4 px-3 pb-6">
          {groups.map((g) => (
            <div key={g}>
              <p className="px-2 pb-1 text-[11px] uppercase tracking-wider text-stone-500">{g}</p>
              {NAV.filter((n) => n.group === g).map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={n.to === '/'}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) => `block rounded px-2 py-1.5 text-sm ${isActive ? 'bg-white/10 text-white' : 'hover:bg-white/5 hover:text-white'}`}
                >
                  {n.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-stone-200 bg-white px-4 py-2.5">
          <button className="text-sm md:hidden" onClick={() => setOpen(!open)}>
            ☰ Menu
          </button>
          <div className="flex items-center gap-2 text-xs">
            {meta.data && (
              <span className={`rounded px-2 py-0.5 font-medium ${meta.data.providerMode === 'live' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                Providers: {meta.data.providerMode}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-stone-600 sm:inline">
              {me.data?.name} <span className="text-stone-400">({me.data?.roles.join(', ')})</span>
            </span>
            <Button
              small
              onClick={() => {
                setToken(null);
                window.location.assign('/login');
              }}
            >
              Sign out
            </Button>
          </div>
        </header>
        <main className="flex-1">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/journeys" element={<Journeys />} />
            <Route path="/campaigns" element={<Campaigns />} />
            <Route path="/campaigns/:id" element={<CampaignEditor />} />
            <Route path="/offers" element={<Offers />} />
            <Route path="/offers/:id" element={<OfferEditor />} />
            <Route path="/segments" element={<Segments />} />
            <Route path="/templates" element={<Templates />} />
            <Route path="/templates/:id" element={<TemplateEditor />} />
            <Route path="/banners" element={<Banners />} />
            <Route path="/clients" element={<Clients />} />
            <Route path="/clients/:id" element={<ClientDetail />} />
            <Route path="/calls" element={<CallList />} />
            <Route path="/suppression" element={<Suppression />} />
            <Route path="/messages" element={<Messages />} />
            <Route path="/events" element={<Events />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/users" element={<Users />} />
            <Route path="/audit" element={<Audit />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  const authed = Boolean(getToken());
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/*" element={authed ? <Shell /> : <Navigate to="/login" />} />
    </Routes>
  );
}
