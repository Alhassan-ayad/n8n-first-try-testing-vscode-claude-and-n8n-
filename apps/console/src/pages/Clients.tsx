import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, hasRole } from '../api';
import { Badge, Button, Card, ErrorBox, Field, fmt, Input, Loading, Page, Select, Table, Tabs, useMe, useMeta } from '../ui';

type Row = Record<string, unknown>;

export default function Clients() {
  const meta = useMeta();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [stage, setStage] = useState('');
  const [tier, setTier] = useState('');
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page), ...(q ? { q } : {}), ...(stage ? { stage } : {}), ...(tier ? { tier } : {}) });
  const list = useQuery({ queryKey: ['clients', params.toString()], queryFn: () => api<{ total: number; items: Row[] }>(`/admin/clients?${params}`) });

  return (
    <Page title="Clients" subtitle="Single client view: profile, consent, every message, journeys and calls.">
      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-4">
          <Input placeholder="Name, phone, email or client ID" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          <Select value={stage} onChange={(v) => { setStage(v); setPage(1); }} options={(meta.data?.stages ?? []).map((s) => ({ value: s.key, label: `${s.key} ${s.label}` }))} placeholder="All stages" />
          <Select value={tier} onChange={(v) => { setTier(v); setPage(1); }} options={meta.data?.tiers ?? []} placeholder="All tiers" />
          <p className="self-center text-sm text-stone-500">{list.data ? `${fmt.num(list.data.total)} clients` : ''}</p>
        </div>
        <ErrorBox error={list.error} />
        <Table
          rows={list.data?.items}
          onRowClick={(r) => nav(`/clients/${String(r.id)}`)}
          columns={[
            { key: 'externalId', label: 'Client ID' },
            { key: 'fullName', label: 'Name' },
            { key: 'lifecycleStage', label: 'Stage', render: (r) => <Badge>{String(r.lifecycleStage)}</Badge> },
            { key: 'valueTier', label: 'Tier' },
            { key: 'kycStatus', label: 'eKYC' },
            { key: 'orderCount', label: 'Orders', className: 'text-right' },
            { key: 'holdingValueEgp', label: 'Holding EGP', render: (r) => fmt.num(r.holdingValueEgp as number), className: 'text-right tabular-nums' },
            { key: 'language', label: 'Lang' },
            { key: 'updatedAt', label: 'Updated', render: (r) => fmt.date(r.updatedAt as string) },
          ]}
        />
        <div className="mt-3 flex gap-2">
          <Button small disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <Button small disabled={!list.data || page * 50 >= list.data.total} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      </Card>
    </Page>
  );
}

interface ClientView {
  client: Row & { tags: string[] };
  preferences: { topics: Array<{ topic: string; channels: Record<string, boolean> }> };
  consentAudit: Row[];
  messages: Row[];
  enrollments: Array<Row & { stepRuns: Row[] }>;
  callTasks: Row[];
  devices: Row[];
  alerts: Row[];
  surveys: Row[];
  events: Row[];
  suppressions: Row[];
}

export function ClientDetail() {
  const { id } = useParams();
  const me = useMe();
  const qc = useQueryClient();
  const [tab, setTab] = useState('messages');
  const [tagInput, setTagInput] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<unknown>(null);
  const q = useQuery({ queryKey: ['client', id], queryFn: () => api<ClientView>(`/admin/clients/${id}`) });
  const d = q.data;
  const refresh = () => qc.invalidateQueries({ queryKey: ['client', id] });

  if (!d) return <Page title="Client"><ErrorBox error={q.error} />{!q.error && <Loading />}</Page>;
  const c = d.client;

  return (
    <Page title={String(c.fullName ?? c.externalId)} subtitle={`Client ${String(c.externalId)} · ${String(c.lifecycleStage)} · ${String(c.valueTier)} · ${String(c.language)}`}>
      <ErrorBox error={error} />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Profile">
          <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
            {[
              ['Phone', c.phone],
              ['Email', c.email],
              ['eKYC', `${String(c.kycStatus)}${(c.kycRejectCount as number) ? ` (rejected ×${String(c.kycRejectCount)})` : ''}`],
              ['Orders', c.orderCount],
              ['Avg order EGP', fmt.num(c.avgOrderAmount as number)],
              ['Gold g', fmt.num(c.goldGrams as number, 3)],
              ['Silver g', fmt.num(c.silverGrams as number, 3)],
              ['Holding EGP', fmt.num(c.holdingValueEgp as number)],
              ['Cash EGP', fmt.num(c.cashBalanceEgp as number)],
              ['Recurring plan', c.hasRecurringPlan ? 'yes' : 'no'],
              ['Source', c.source],
              ['Registered', fmt.day(c.registeredAt as string)],
              ['Last order', fmt.day(c.lastOrderAt as string)],
              ['Last login', fmt.day(c.lastLoginAt as string)],
            ].map(([k, v]) => (
              <div key={String(k)} className="contents">
                <dt className="text-stone-500">{String(k)}</dt>
                <dd className="truncate text-right">{String(v ?? '—')}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4">
            <p className="mb-1 text-xs font-medium text-stone-600">Tags</p>
            <div className="flex flex-wrap gap-1">
              {c.tags.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 rounded bg-gold-50 px-1.5 py-0.5 text-xs text-gold-700">
                  {t}
                  {hasRole(me.data, 'crm', 'marketing') && (
                    <button className="text-stone-400 hover:text-red-600" onClick={async () => { await api(`/admin/clients/${String(c.id)}/tags`, { method: 'PUT', body: { remove: [t] } }); void refresh(); }}>
                      ×
                    </button>
                  )}
                </span>
              ))}
            </div>
            {hasRole(me.data, 'crm', 'marketing') && (
              <div className="mt-2 flex gap-2">
                <Input value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder="add tag" />
                <Button small onClick={async () => { if (!tagInput) return; await api(`/admin/clients/${String(c.id)}/tags`, { method: 'PUT', body: { add: [tagInput.trim()] } }); setTagInput(''); void refresh(); }}>Add</Button>
              </div>
            )}
          </div>
        </Card>

        <Card title="Consent & preferences" className="lg:col-span-2">
          <div className="-mx-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-left text-xs uppercase text-stone-500">
                  <th className="px-4 py-2">Topic</th>
                  {['push', 'email', 'sms', 'whatsapp', 'call'].map((ch) => <th key={ch} className="px-2 py-2 text-center">{ch}</th>)}
                </tr>
              </thead>
              <tbody>
                {d.preferences.topics.map((t) => (
                  <tr key={t.topic} className="border-b border-stone-100">
                    <td className="px-4 py-1.5">{t.topic}</td>
                    {['push', 'email', 'sms', 'whatsapp', 'call'].map((ch) => (
                      <td key={ch} className="px-2 py-1.5 text-center">
                        <input
                          type="checkbox"
                          className="accent-gold-600"
                          checked={t.channels[ch] ?? false}
                          disabled={!hasRole(me.data, 'crm', 'cx', 'callcentre')}
                          onChange={async (e) => {
                            if (note.trim().length < 3) {
                              setError(new Error('Enter a reason (e.g. "client asked by phone") before changing consent — it is recorded in the audit trail.'));
                              return;
                            }
                            setError(null);
                            await api(`/admin/clients/${String(c.id)}/consents`, { body: { changes: [{ channel: ch, topic: t.topic, granted: e.target.checked }], note } });
                            void refresh();
                          }}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Reason for consent change (required, audited)">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Client requested via call centre" />
            </Field>
            <p className="self-end text-xs text-stone-500">Account, security and transaction messages are mandatory and are not shown here.</p>
          </div>
          {d.suppressions.length > 0 && (
            <div className="mt-3 text-sm">
              <p className="font-medium text-red-700">On suppression list:</p>
              <ul className="list-disc pl-5 text-stone-700">
                {d.suppressions.map((s) => <li key={String(s.id)}>{String(s.channel)} · {String(s.scope)} · {String(s.reason)} ({fmt.day(s.createdAt as string)})</li>)}
              </ul>
            </div>
          )}
        </Card>
      </div>

      <Card>
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { key: 'messages', label: `Messages (${d.messages.length})` },
            { key: 'journeys', label: `Journeys (${d.enrollments.length})` },
            { key: 'calls', label: `Calls (${d.callTasks.length})` },
            { key: 'events', label: `Events (${d.events.length})` },
            { key: 'consent', label: 'Consent history' },
            { key: 'other', label: 'Devices, alerts, surveys' },
          ]}
        />
        <div className="pt-4">
          {tab === 'messages' && (
            <Table
              rows={d.messages}
              columns={[
                { key: 'createdAt', label: 'Created', render: (r) => fmt.date(r.createdAt as string) },
                { key: 'templateKey', label: 'Template' },
                { key: 'channel', label: 'Channel' },
                { key: 'category', label: 'Cat.' },
                { key: 'status', label: 'Status', render: (r) => <><Badge>{String(r.status)}</Badge> <span className="text-xs text-stone-500">{String(r.statusReason ?? '')}</span></> },
                { key: 'body', label: 'Content', render: (r) => <span className="line-clamp-2 max-w-md text-xs text-stone-600">{String(r.title ?? r.subject ?? '')} {String(r.body ?? '')}</span> },
                { key: 'releaseAt', label: 'Release', render: (r) => (r.releaseAt ? fmt.date(r.releaseAt as string) : '') },
              ]}
            />
          )}
          {tab === 'journeys' &&
            (d.enrollments.length === 0 ? (
              <p className="text-sm text-stone-500">Not enrolled in any journey.</p>
            ) : (
              <div className="space-y-4">
                {d.enrollments.map((en) => (
                  <div key={String(en.id)} className="rounded border border-stone-200 p-3">
                    <p className="text-sm font-medium">
                      {String(en.journeyKey)} <Badge>{String(en.status)}</Badge> {Boolean(en.holdout) && <Badge tone="holdout">holdout</Badge>}{' '}
                      {Boolean(en.convertedAt) && <Badge tone="approved">converted</Badge>}
                      <span className="ml-2 text-xs text-stone-500">entered {fmt.date(en.enteredAt as string)} {en.exitReason ? `· exit: ${String(en.exitReason)}` : ''}</span>
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {en.stepRuns.map((s) => (
                        <span key={String(s.id)} className="rounded bg-stone-50 px-2 py-1 text-xs" title={String(s.result ?? '')}>
                          {String(s.stepId)} · <Badge>{String(s.status)}</Badge> · {fmt.date(s.fireAt as string)}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          {tab === 'calls' && (
            <Table rows={d.callTasks} columns={[{ key: 'reason', label: 'Reason' }, { key: 'status', label: 'Status', render: (r) => <Badge>{String(r.status)}</Badge> }, { key: 'outcome', label: 'Outcome' }, { key: 'dueAt', label: 'Due', render: (r) => fmt.date(r.dueAt as string) }, { key: 'notes', label: 'Notes' }]} />
          )}
          {tab === 'events' && (
            <Table rows={d.events} columns={[{ key: 'occurredAt', label: 'When', render: (r) => fmt.date(r.occurredAt as string) }, { key: 'type', label: 'Event' }, { key: 'source', label: 'Source' }, { key: 'payload', label: 'Payload', render: (r) => <code className="text-xs">{String(r.payload ?? '').slice(0, 160)}</code> }]} />
          )}
          {tab === 'consent' && (
            <Table rows={d.consentAudit} columns={[{ key: 'createdAt', label: 'When', render: (r) => fmt.date(r.createdAt as string) }, { key: 'channel', label: 'Channel' }, { key: 'topic', label: 'Topic' }, { key: 'granted', label: 'Granted', render: (r) => (r.granted ? 'yes' : 'no') }, { key: 'source', label: 'Source' }, { key: 'wordingVersion', label: 'Wording' }, { key: 'actor', label: 'By' }]} />
          )}
          {tab === 'other' && (
            <div className="grid gap-5 lg:grid-cols-3">
              <div><p className="mb-2 text-sm font-medium">Devices</p><Table rows={d.devices} columns={[{ key: 'platform', label: 'Platform' }, { key: 'token', label: 'Token' }, { key: 'invalidatedAt', label: 'Valid', render: (r) => (r.invalidatedAt ? 'invalid' : 'valid') }]} /></div>
              <div><p className="mb-2 text-sm font-medium">Price alerts</p><Table rows={d.alerts} columns={[{ key: 'metal', label: 'Metal' }, { key: 'direction', label: 'Dir' }, { key: 'level', label: 'Level' }, { key: 'active', label: 'Active', render: (r) => (r.active ? 'yes' : 'no') }]} /></div>
              <div><p className="mb-2 text-sm font-medium">Surveys</p><Table rows={d.surveys} columns={[{ key: 'survey', label: 'Survey' }, { key: 'score', label: 'Score' }, { key: 'reason', label: 'Reason' }]} /></div>
            </div>
          )}
        </div>
      </Card>
    </Page>
  );
}
