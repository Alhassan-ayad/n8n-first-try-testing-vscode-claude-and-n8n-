import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { Badge, Button, Card, Checks, ErrorBox, Field, fmt, Input, Json, Page, Select, Table, TextArea, useMeta } from '../ui';

type Row = Record<string, unknown>;

interface ProviderInfo {
  providers: Array<{ channel: string; mode: string; provider: string; liveProvider: string; credentialsPresent: boolean }>;
  webhooks: Record<string, string>;
  cdc: { configured: boolean; checkpoints: Row[]; lastEvent: Row | null };
}

export function Settings() {
  const q = useQuery({ queryKey: ['providers'], queryFn: () => api<ProviderInfo>('/admin/settings/providers'), refetchInterval: 30_000 });
  const [t, setT] = useState({ channel: 'sms', to: '', subject: 'mngm test message', body: 'This is a test message from the mngm engagement platform.' });
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<unknown>(null);

  return (
    <Page title="Providers & settings" subtitle="SMS via eZagel, email via SendGrid, push via Firebase. Set PROVIDER_MODE=live in .env once credentials are in place — no code change needed.">
      <ErrorBox error={q.error} />
      <Card title="Providers">
        <Table
          rows={q.data?.providers as unknown as Row[] | undefined}
          columns={[
            { key: 'channel', label: 'Channel' },
            { key: 'liveProvider', label: 'Provider' },
            { key: 'mode', label: 'Mode', render: (r) => <Badge tone={r.mode === 'live' ? 'active' : 'deferred'}>{String(r.mode)}</Badge> },
            { key: 'credentialsPresent', label: 'Credentials', render: (r) => (r.credentialsPresent ? <Badge tone="approved">present</Badge> : <Badge tone="failed">missing</Badge>) },
          ]}
        />
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Webhook URLs to register with providers">
          <dl className="space-y-2 text-sm">
            {Object.entries(q.data?.webhooks ?? {}).map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-stone-500">{k}</dt>
                <dd className="break-all font-mono text-xs">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card title="CDC ingestion (mngm SQL Server)">
          <p className="mb-2 text-sm">
            {q.data?.cdc.configured ? <Badge tone="active">configured</Badge> : <Badge tone="failed">SOURCE_MSSQL_URL not set</Badge>}{' '}
            {q.data?.cdc.lastEvent && <span className="text-stone-600">Last event: {String(q.data.cdc.lastEvent.type)} at {fmt.date(q.data.cdc.lastEvent.createdAt as string)}</span>}
          </p>
          <Table rows={q.data?.cdc.checkpoints} columns={[{ key: 'captureInstance', label: 'Capture instance' }, { key: 'lastLsn', label: 'LSN', render: (r) => <span className="font-mono text-xs">{String(r.lastLsn)}</span> }, { key: 'updatedAt', label: 'Updated', render: (r) => fmt.date(r.updatedAt as string) }]} />
        </Card>
      </div>
      <Card title="Provider smoke test">
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Channel"><Select value={t.channel} onChange={(v) => setT({ ...t, channel: v })} options={['sms', 'email', 'push', 'whatsapp']} /></Field>
          <Field label={t.channel === 'push' ? 'FCM device token' : t.channel === 'email' ? 'Email address' : 'Mobile number'}><Input value={t.to} onChange={(e) => setT({ ...t, to: e.target.value })} /></Field>
          <Field label="Subject / title"><Input value={t.subject} onChange={(e) => setT({ ...t, subject: e.target.value })} /></Field>
          <div />
          <Field label="Body" wide><TextArea rows={2} value={t.body} onChange={(e) => setT({ ...t, body: e.target.value })} /></Field>
        </div>
        <div className="mt-3">
          <Button variant="primary" onClick={async () => {
            setError(null);
            setResult(null);
            try {
              setResult(await api('/admin/settings/test-send', { body: t }));
            } catch (e) {
              setError(e);
            }
          }}>Send through provider</Button>
        </div>
        <ErrorBox error={error} />
        {result !== null && <div className="mt-3"><Json value={result} /></div>}
      </Card>
    </Page>
  );
}

export function Users() {
  const meta = useMeta();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['users'], queryFn: () => api<Row[]>('/admin/users') });
  const [u, setU] = useState({ email: '', name: '', password: '', roles: ['viewer'] as string[] });
  const [error, setError] = useState<unknown>(null);

  return (
    <Page title="Users" subtitle="Roles drive the approval routes: compliance reviews content, head_of_marketing / cfo / ceo approve offers and campaigns (§8.3, §9.2).">
      <Card title="Add user">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Email"><Input value={u.email} onChange={(e) => setU({ ...u, email: e.target.value })} /></Field>
          <Field label="Name"><Input value={u.name} onChange={(e) => setU({ ...u, name: e.target.value })} /></Field>
          <Field label="Temporary password (10+ chars)"><Input type="password" value={u.password} onChange={(e) => setU({ ...u, password: e.target.value })} /></Field>
          <Field label="Roles" wide><Checks options={meta.data?.roles ?? []} value={u.roles} onChange={(roles) => setU({ ...u, roles })} /></Field>
        </div>
        <div className="mt-3">
          <Button variant="primary" onClick={async () => {
            setError(null);
            try {
              await api('/admin/users', { body: u });
              setU({ email: '', name: '', password: '', roles: ['viewer'] });
              await qc.invalidateQueries({ queryKey: ['users'] });
            } catch (e) {
              setError(e);
            }
          }}>Create</Button>
        </div>
        <ErrorBox error={error} />
      </Card>
      <Card>
        <Table
          rows={q.data}
          columns={[
            { key: 'email', label: 'Email' },
            { key: 'name', label: 'Name' },
            { key: 'roles', label: 'Roles', render: (r) => (r.roles as string[]).join(', ') },
            { key: 'lastLoginAt', label: 'Last login', render: (r) => fmt.date(r.lastLoginAt as string) },
            { key: 'active', label: 'Active', render: (r) => <Button small variant="ghost" onClick={async () => { await api(`/admin/users/${String(r.id)}`, { method: 'PUT', body: { active: !r.active } }); await qc.invalidateQueries({ queryKey: ['users'] }); }}>{r.active ? 'Disable' : 'Enable'}</Button> },
          ]}
        />
      </Card>
    </Page>
  );
}

export function Audit() {
  const [entity, setEntity] = useState('');
  const q = useQuery({ queryKey: ['audit', entity], queryFn: () => api<Row[]>(`/admin/audit?${new URLSearchParams(entity ? { entity } : {})}`) });
  return (
    <Page title="Audit log" subtitle="Every approval, consent change, suppression, test send and configuration change.">
      <Card>
        <div className="mb-3 max-w-xs"><Select value={entity} onChange={setEntity} options={['template', 'campaign', 'offer', 'journey', 'client', 'suppression', 'call_task', 'admin_user', 'provider', 'incident', 'event']} placeholder="All entities" /></div>
        <Table
          rows={q.data}
          columns={[
            { key: 'createdAt', label: 'When', render: (r) => fmt.date(r.createdAt as string) },
            { key: 'actor', label: 'Who' },
            { key: 'action', label: 'Action' },
            { key: 'entity', label: 'Entity' },
            { key: 'entityId', label: 'ID', render: (r) => <span className="font-mono text-xs">{String(r.entityId ?? '')}</span> },
            { key: 'detail', label: 'Detail', render: (r) => <code className="line-clamp-2 max-w-md text-xs">{String(r.detail ?? '')}</code> },
          ]}
        />
      </Card>
    </Page>
  );
}
