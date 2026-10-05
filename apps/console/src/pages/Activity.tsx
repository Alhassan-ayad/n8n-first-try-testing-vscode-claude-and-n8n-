import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, hasRole } from '../api';
import { Badge, Button, Card, ErrorBox, Field, fmt, Input, Json, Page, Select, Table, TextArea, useMe, useMeta } from '../ui';

type Row = Record<string, unknown>;

export function Messages() {
  const [channel, setChannel] = useState('');
  const [status, setStatus] = useState('');
  const [templateKey, setTemplateKey] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const params = new URLSearchParams({ page: String(page), ...(channel ? { channel } : {}), ...(status ? { status } : {}), ...(templateKey ? { templateKey } : {}) });
  const q = useQuery({ queryKey: ['messages', params.toString()], queryFn: () => api<{ total: number; items: Row[] }>(`/admin/messages?${params}`), refetchInterval: 15_000 });
  const detail = useQuery({ queryKey: ['message', selected], enabled: !!selected, queryFn: () => api<Row>(`/admin/messages/${selected}`) });

  return (
    <Page title="Messages" subtitle="The outbox: every message with its policy decision (sent, deferred for quiet hours, held by a cap, suppressed) and provider status.">
      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-4">
          <Select value={channel} onChange={(v) => { setChannel(v); setPage(1); }} options={['push', 'email', 'sms', 'inapp', 'whatsapp']} placeholder="All channels" />
          <Select value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={['pending', 'deferred', 'held', 'sending', 'sent', 'delivered', 'opened', 'clicked', 'failed', 'suppressed', 'cancelled']} placeholder="All statuses" />
          <Input placeholder="Template key" value={templateKey} onChange={(e) => { setTemplateKey(e.target.value); setPage(1); }} />
          <p className="self-center text-sm text-stone-500">{q.data ? `${fmt.num(q.data.total)} messages` : ''}</p>
        </div>
        <ErrorBox error={q.error} />
        <Table
          rows={q.data?.items}
          onRowClick={(r) => setSelected(String(r.id))}
          columns={[
            { key: 'createdAt', label: 'Created', render: (r) => fmt.date(r.createdAt as string) },
            { key: 'templateKey', label: 'Template', render: (r) => <span className="font-mono text-xs">{String(r.templateKey)}</span> },
            { key: 'channel', label: 'Channel' },
            { key: 'category', label: 'Cat.' },
            { key: 'toAddress', label: 'To', render: (r) => <span className="text-xs">{String(r.toAddress ?? '')}</span> },
            { key: 'status', label: 'Status', render: (r) => <Badge>{String(r.status)}</Badge> },
            { key: 'statusReason', label: 'Reason', render: (r) => <span className="text-xs text-stone-500">{String(r.statusReason ?? '')}</span> },
            { key: 'releaseAt', label: 'Release', render: (r) => (r.releaseAt ? fmt.date(r.releaseAt as string) : '') },
          ]}
        />
        <div className="mt-3 flex gap-2">
          <Button small disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <Button small disabled={!q.data || page * 50 >= q.data.total} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      </Card>
      {selected && detail.data && (
        <Card title={`Message ${selected}`} actions={<Button small onClick={() => setSelected(null)}>Close</Button>}>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2 text-sm">
              {detail.data.clientId ? <p>Client: <Link className="text-gold-700 hover:underline" to={`/clients/${String(detail.data.clientId)}`}>{String(detail.data.clientId)}</Link></p> : null}
              <p>Kind / topic: {String(detail.data.kind)} / {String(detail.data.topic)} · priority {String(detail.data.priority)}</p>
              {detail.data.subject ? <p className="font-medium">{String(detail.data.subject)}</p> : null}
              {detail.data.title ? <p className="font-medium">{String(detail.data.title)}</p> : null}
              <p className={`whitespace-pre-wrap rounded bg-stone-50 p-3 ${detail.data.language === 'ar' ? 'rtl' : ''}`}>{String(detail.data.body)}</p>
              {detail.data.deepLink ? <p className="text-xs text-stone-500">Deep link: {String(detail.data.deepLink)}</p> : null}
              {detail.data.html ? <iframe title="email" className="h-80 w-full rounded border" srcDoc={String(detail.data.html)} /> : null}
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">Provider events</p>
              <Json value={detail.data.deliveryEvents} />
            </div>
          </div>
        </Card>
      )}
    </Page>
  );
}

export function Events() {
  const me = useMe();
  const meta = useMeta();
  const qc = useQueryClient();
  const [type, setType] = useState('');
  const [client, setClient] = useState('');
  const [errorsOnly, setErrorsOnly] = useState(false);
  const params = new URLSearchParams({ ...(type ? { type } : {}), ...(client ? { clientExternalId: client } : {}), ...(errorsOnly ? { errors: '1' } : {}) });
  const q = useQuery({ queryKey: ['events', params.toString()], queryFn: () => api<{ total: number; items: Row[] }>(`/admin/events?${params}`), refetchInterval: 10_000 });
  const [inject, setInject] = useState({ type: 'client.registered', clientExternalId: '', payload: '{\n  "fullName": "Test Client",\n  "phone": "01000000000",\n  "email": "test@example.com",\n  "language": "ar"\n}' });
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState('');

  return (
    <Page title="Events" subtitle="Platform events received from mngm core via SQL Server CDC (or the events API), and how they were processed.">
      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-4">
          <Select value={type} onChange={setType} options={meta.data?.events ?? []} placeholder="All event types" />
          <Input placeholder="Client ID" value={client} onChange={(e) => setClient(e.target.value)} />
          <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" className="accent-gold-600" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} /> Errors only</label>
          <p className="self-center text-sm text-stone-500">{q.data ? `${fmt.num(q.data.total)} events` : ''}</p>
        </div>
        <Table
          rows={q.data?.items}
          columns={[
            { key: 'occurredAt', label: 'Occurred', render: (r) => fmt.date(r.occurredAt as string) },
            { key: 'type', label: 'Type', render: (r) => <span className="font-mono text-xs">{String(r.type)}</span> },
            { key: 'clientExternalId', label: 'Client' },
            { key: 'source', label: 'Source' },
            { key: 'processedAt', label: 'Processed', render: (r) => (r.error ? <Badge tone="failed">error</Badge> : r.processedAt ? <Badge tone="done">ok</Badge> : <Badge tone="pending">pending</Badge>) },
            { key: 'payload', label: 'Payload', render: (r) => <code className="line-clamp-2 max-w-md text-xs">{String(r.payload ?? '')}</code> },
          ]}
        />
      </Card>
      {hasRole(me.data, 'admin') && (
        <Card title="Inject a test event">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Type"><Select value={inject.type} onChange={(v) => setInject({ ...inject, type: v })} options={meta.data?.events ?? []} /></Field>
            <Field label="Client ID (mngm core user id)"><Input value={inject.clientExternalId} onChange={(e) => setInject({ ...inject, clientExternalId: e.target.value })} /></Field>
            <div />
            <Field label="Payload (JSON)" wide><TextArea rows={6} className="font-mono text-xs" value={inject.payload} onChange={(e) => setInject({ ...inject, payload: e.target.value })} /></Field>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <Button variant="primary" onClick={async () => {
              setError(null);
              try {
                const r = await api<{ id: string }>('/admin/events', { body: { type: inject.type, clientExternalId: inject.clientExternalId || undefined, payload: JSON.parse(inject.payload || '{}') } });
                setResult(`Processed ${r.id}`);
                await qc.invalidateQueries({ queryKey: ['events'] });
              } catch (e) {
                setError(e);
              }
            }}>Send event</Button>
            {result && <span className="text-sm text-emerald-700">{result}</span>}
          </div>
          <ErrorBox error={error} />
        </Card>
      )}
    </Page>
  );
}

export function Banners() {
  const me = useMe();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['banners'], queryFn: () => api<Row[]>('/admin/banners') });
  const now = new Date();
  const later = new Date(now.getTime() + 7 * 86_400_000);
  const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  const [b, setB] = useState({ kind: 'offer', titleEn: '', titleAr: '', bodyEn: '', bodyAr: '', deepLink: '', startsAt: local(now), endsAt: local(later) });
  const [inc, setInc] = useState({ type: 'incident', stage: 'start', messageEn: '', messageAr: '', notify: true });
  const [error, setError] = useState<unknown>(null);
  const [msg, setMsg] = useState('');

  return (
    <Page title="Banners & incidents" subtitle="In-app banners always carry an end date. Incident notices go out within 30 minutes of confirmation, then hourly (§9.3).">
      <ErrorBox error={error} />
      {msg && <p className="rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{msg}</p>}
      {hasRole(me.data, 'admin', 'compliance', 'crm') && (
        <Card title="Publish incident or maintenance notice">
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Type"><Select value={inc.type} onChange={(v) => setInc({ ...inc, type: v })} options={['incident', 'maintenance']} /></Field>
            <Field label="Stage"><Select value={inc.stage} onChange={(v) => setInc({ ...inc, stage: v })} options={['start', 'update', 'resolved', 'scheduled']} /></Field>
            <label className="inline-flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" className="accent-gold-600" checked={inc.notify} onChange={(e) => setInc({ ...inc, notify: e.target.checked })} /> Push + email to active clients</label>
            <div />
            <Field label="Message (English)" wide><TextArea rows={2} value={inc.messageEn} onChange={(e) => setInc({ ...inc, messageEn: e.target.value })} /></Field>
            <Field label="Message (Arabic)" wide><TextArea rows={2} dir="rtl" value={inc.messageAr} onChange={(e) => setInc({ ...inc, messageAr: e.target.value })} /></Field>
          </div>
          <div className="mt-3">
            <Button variant="danger" onClick={async () => {
              setError(null);
              try {
                await api('/admin/incidents', { body: inc });
                setMsg(`Incident notice (${inc.stage}) published.`);
                await qc.invalidateQueries({ queryKey: ['banners'] });
              } catch (e) {
                setError(e);
              }
            }}>Publish</Button>
          </div>
        </Card>
      )}
      {hasRole(me.data, 'crm', 'marketing') && (
        <Card title="New banner">
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Kind"><Select value={b.kind} onChange={(v) => setB({ ...b, kind: v })} options={['info', 'offer', 'maintenance']} /></Field>
            <Field label="Starts"><Input type="datetime-local" value={b.startsAt} onChange={(e) => setB({ ...b, startsAt: e.target.value })} /></Field>
            <Field label="Ends"><Input type="datetime-local" value={b.endsAt} onChange={(e) => setB({ ...b, endsAt: e.target.value })} /></Field>
            <Field label="Deep link"><Input value={b.deepLink} onChange={(e) => setB({ ...b, deepLink: e.target.value })} /></Field>
            <Field label="Title (English)" wide><Input value={b.titleEn} onChange={(e) => setB({ ...b, titleEn: e.target.value })} /></Field>
            <Field label="Title (Arabic)" wide><Input dir="rtl" value={b.titleAr} onChange={(e) => setB({ ...b, titleAr: e.target.value })} /></Field>
            <Field label="Body (English)" wide><TextArea rows={2} value={b.bodyEn} onChange={(e) => setB({ ...b, bodyEn: e.target.value })} /></Field>
            <Field label="Body (Arabic)" wide><TextArea rows={2} dir="rtl" value={b.bodyAr} onChange={(e) => setB({ ...b, bodyAr: e.target.value })} /></Field>
          </div>
          <div className="mt-3">
            <Button variant="primary" onClick={async () => {
              setError(null);
              try {
                await api('/admin/banners', { body: { ...b, deepLink: b.deepLink || null, startsAt: new Date(b.startsAt).toISOString(), endsAt: new Date(b.endsAt).toISOString() } });
                setMsg('Banner created.');
                await qc.invalidateQueries({ queryKey: ['banners'] });
              } catch (e) {
                setError(e);
              }
            }}>Create banner</Button>
          </div>
        </Card>
      )}
      <Card title="Banners">
        <Table
          rows={q.data}
          columns={[
            { key: 'kind', label: 'Kind', render: (r) => <Badge tone={['incident', 'trading_paused', 'price_feed'].includes(String(r.kind)) ? 'failed' : 'draft'}>{String(r.kind)}</Badge> },
            { key: 'titleEn', label: 'Title' },
            { key: 'startsAt', label: 'Starts', render: (r) => fmt.date(r.startsAt as string) },
            { key: 'endsAt', label: 'Ends', render: (r) => fmt.date(r.endsAt as string) },
            { key: 'active', label: 'Active', render: (r) => (r.active && new Date(String(r.endsAt)) > new Date() ? <Badge tone="active">live</Badge> : <Badge tone="cancelled">off</Badge>) },
            { key: 'x', label: '', render: (r) => (r.active ? <Button small variant="ghost" onClick={async () => { await api(`/admin/banners/${String(r.id)}/deactivate`, { body: {} }); await qc.invalidateQueries({ queryKey: ['banners'] }); }}>End now</Button> : null) },
          ]}
        />
      </Card>
    </Page>
  );
}
