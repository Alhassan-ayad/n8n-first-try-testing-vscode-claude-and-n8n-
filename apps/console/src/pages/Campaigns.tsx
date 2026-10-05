import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, hasRole } from '../api';
import { cleanFilter, SegmentBuilder, type SegmentFilter } from '../SegmentBuilder';
import { Badge, Button, Card, Checks, ErrorBox, Field, fmt, Input, Json, Loading, Page, Select, Table, TextArea, useMe, useMeta } from '../ui';

type Row = Record<string, unknown>;

export default function Campaigns() {
  const nav = useNavigate();
  const list = useQuery({ queryKey: ['campaigns'], queryFn: () => api<Row[]>('/admin/campaigns') });
  return (
    <Page
      title="Campaign register"
      subtitle="Every campaign is on the calendar with a hypothesis, segment, holdout, compliance reviewer and approver. Nothing is sent that is not here."
      actions={<Button variant="primary" onClick={() => nav('/campaigns/new')}>New campaign</Button>}
    >
      <Card>
        <ErrorBox error={list.error} />
        <Table
          rows={list.data}
          onRowClick={(r) => nav(`/campaigns/${String(r.id)}`)}
          columns={[
            { key: 'code', label: 'ID', render: (r) => <span className="font-mono text-xs">{String(r.code)}</span> },
            { key: 'name', label: 'Name' },
            { key: 'objective', label: 'Obj.' },
            { key: 'channels', label: 'Channels' },
            { key: 'segmentSize', label: 'Size', render: (r) => fmt.num(r.segmentSize as number), className: 'text-right' },
            { key: 'holdoutPct', label: 'Holdout', render: (r) => `${String(r.holdoutPct)}%` },
            { key: 'sendDate', label: 'Send', render: (r) => (r.sendDate ? `${String(r.sendDate)} ${String(r.slot ?? '')}` : '—') },
            { key: 'status', label: 'Status', render: (r) => <Badge>{String(r.status)}</Badge> },
            { key: 'decision', label: 'Decision' },
          ]}
        />
      </Card>
    </Page>
  );
}

interface Campaign {
  id?: string;
  code: string;
  name: string;
  objective: string;
  hypothesis: string;
  segmentFilter: SegmentFilter;
  holdoutPct: number;
  channels: string[];
  templateKey: string;
  topic: string;
  kind: string;
  offerId?: string | null;
  sendDate?: string | null;
  slot?: string | null;
  goalEvent: string;
  attributionDays: number;
  status?: string;
  complianceReviewer?: string | null;
  complianceNote?: string | null;
  approver?: string | null;
  scheduledAt?: string | null;
  decision?: string | null;
  decisionNote?: string | null;
  problems?: string[];
}

const EMPTY: Campaign = {
  code: '',
  name: '',
  objective: 'O3',
  hypothesis: '',
  segmentFilter: {},
  holdoutPct: 10,
  channels: ['push'],
  templateKey: 'promo_generic',
  topic: 'promotions',
  kind: 'promotion',
  goalEvent: 'order.executed',
  attributionDays: 7,
  slot: '11:00',
};

export function CampaignEditor() {
  const { id } = useParams();
  const isNew = id === 'new';
  const nav = useNavigate();
  const qc = useQueryClient();
  const me = useMe();
  const meta = useMeta();
  const [c, setC] = useState<Campaign>(EMPTY);
  const [error, setError] = useState<unknown>(null);
  const [info, setInfo] = useState('');
  const [note, setNote] = useState('');
  const [decision, setDecision] = useState('keep');

  const q = useQuery({
    queryKey: ['campaign', id],
    enabled: !isNew,
    queryFn: async () => {
      const r = await api<Row>(`/admin/campaigns/${id}`);
      return {
        ...(r as unknown as Campaign),
        segmentFilter: JSON.parse(String(r.segmentFilter ?? '{}')) as SegmentFilter,
        channels: String(r.channels ?? '').split(',').filter(Boolean),
      } as Campaign;
    },
  });
  useEffect(() => {
    if (q.data) setC(q.data);
  }, [q.data]);
  const keys = useQuery({ queryKey: ['template-keys'], queryFn: async () => [...new Set((await api<Row[]>('/admin/templates?status=approved')).map((t) => String(t.key)))].sort() });
  const offers = useQuery({ queryKey: ['offers'], queryFn: () => api<Row[]>('/admin/offers') });
  const results = useQuery({ queryKey: ['campaign-results', id], enabled: !isNew && ['running', 'completed'].includes(c.status ?? ''), queryFn: () => api<Row>(`/admin/campaigns/${id}/results`) });

  const set = (patch: Partial<Campaign>) => setC({ ...c, ...patch });
  const editable = isNew || ['draft', 'in_review'].includes(c.status ?? 'draft');
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setError(null);
    setInfo('');
    try {
      await fn();
      setInfo(msg);
      await qc.invalidateQueries({ queryKey: ['campaign', id] });
      await qc.invalidateQueries({ queryKey: ['campaigns'] });
    } catch (e) {
      setError(e);
    }
  };
  const payload = () => ({
    code: c.code,
    name: c.name,
    objective: c.objective,
    hypothesis: c.hypothesis,
    segmentFilter: cleanFilter(c.segmentFilter),
    holdoutPct: Number(c.holdoutPct),
    channels: c.channels,
    templateKey: c.templateKey,
    topic: c.topic,
    kind: c.kind,
    offerId: c.offerId || null,
    sendDate: c.sendDate || null,
    slot: c.slot || null,
    goalEvent: c.goalEvent,
    attributionDays: Number(c.attributionDays),
  });

  if (!isNew && !q.data) return <Page title="Campaign"><ErrorBox error={q.error} />{!q.error && <Loading />}</Page>;
  const st = c.status ?? 'draft';

  return (
    <Page
      title={isNew ? 'New campaign' : `${c.code} · ${c.name}`}
      subtitle={isNew ? 'Brief → draft → compliance review → approval → scheduled at 11:00 or 19:00 (§9.2).' : `Status: ${st}${c.complianceReviewer ? ` · compliance: ${c.complianceReviewer}` : ''}${c.approver ? ` · approved by ${c.approver}` : ''}${c.scheduledAt ? ` · scheduled ${fmt.date(c.scheduledAt)}` : ''}`}
      actions={
        <>
          {editable && hasRole(me.data, 'marketing', 'crm', 'head_of_marketing') && (
            <Button variant="primary" onClick={() => run(async () => {
              const saved = isNew ? await api<Row>('/admin/campaigns', { body: payload() }) : await api<Row>(`/admin/campaigns/${id}`, { method: 'PUT', body: payload() });
              if (isNew) nav(`/campaigns/${String(saved.id)}`);
            }, 'Saved')}>Save</Button>
          )}
          {!isNew && st === 'draft' && <Button onClick={() => run(() => api(`/admin/campaigns/${id}/submit`, { body: {} }), 'Submitted for review')}>Submit for review</Button>}
          {!isNew && st === 'in_review' && !c.complianceReviewer && hasRole(me.data, 'compliance') && (
            <>
              <Button variant="primary" onClick={() => run(() => api(`/admin/campaigns/${id}/compliance`, { body: { approved: true, note } }), 'Compliance review recorded')}>Compliance OK</Button>
              <Button variant="danger" onClick={() => run(() => api(`/admin/campaigns/${id}/compliance`, { body: { approved: false, note } }), 'Returned to draft')}>Return to draft</Button>
            </>
          )}
          {!isNew && st === 'in_review' && c.complianceReviewer && hasRole(me.data, 'head_of_marketing', 'ceo') && (
            <Button variant="primary" onClick={() => run(() => api(`/admin/campaigns/${id}/approve`, { body: {} }), 'Approved')}>Approve</Button>
          )}
          {!isNew && st === 'approved' && <Button variant="primary" onClick={() => run(() => api(`/admin/campaigns/${id}/schedule`, { body: {} }), 'Scheduled')}>Schedule</Button>}
          {!isNew && ['approved', 'scheduled'].includes(st) && hasRole(me.data, 'admin') && (
            <Button onClick={() => run(() => api(`/admin/campaigns/${id}/launch-now`, { body: {} }), 'Launched — contact policy still applies')}>Launch now</Button>
          )}
          {!isNew && !['completed', 'cancelled'].includes(st) && <Button variant="danger" onClick={() => run(() => api(`/admin/campaigns/${id}/cancel`, { body: {} }), 'Cancelled')}>Cancel</Button>}
        </>
      }
    >
      <ErrorBox error={error} />
      {info && <p className="rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{info}</p>}
      {c.problems && c.problems.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p className="font-medium">Not ready to submit:</p>
          <ul className="list-disc pl-5">{c.problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Brief" className="lg:col-span-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Campaign ID" hint="e.g. RAMADAN26-ZAKAT"><Input value={c.code} disabled={!isNew} onChange={(e) => set({ code: e.target.value.toUpperCase() })} /></Field>
            <Field label="Name"><Input value={c.name} disabled={!editable} onChange={(e) => set({ name: e.target.value })} /></Field>
            <Field label="Objective"><Select value={c.objective} onChange={(v) => set({ objective: v })} options={Object.entries(meta.data?.objectives ?? {}).map(([k, v]) => ({ value: k, label: `${k} — ${v}` }))} /></Field>
            <Field label="Holdout %" hint="At least 10% (§8.2)"><Input type="number" min={10} max={50} value={c.holdoutPct} disabled={!editable} onChange={(e) => set({ holdoutPct: Number(e.target.value) })} /></Field>
            <Field label="Hypothesis" wide hint="Which segment, what behaviour we expect to change, and by how much"><TextArea rows={2} value={c.hypothesis} disabled={!editable} onChange={(e) => set({ hypothesis: e.target.value })} /></Field>
            <Field label="Channels" wide><Checks options={['push', 'email', 'sms', 'inapp', 'whatsapp']} value={c.channels} onChange={(channels) => set({ channels })} /></Field>
            <Field label="Template key (approved)"><Select value={c.templateKey} onChange={(v) => set({ templateKey: v })} options={keys.data ?? [c.templateKey]} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Topic (consent)"><Select value={c.topic} onChange={(v) => set({ topic: v })} options={['promotions', 'education', 'lifecycle', 'market_research']} /></Field>
              <Field label="Kind"><Select value={c.kind} onChange={(v) => set({ kind: v })} options={['promotion', 'education', 'lifecycle', 'research']} /></Field>
            </div>
            <Field label="Offer (from the offer register)">
              <Select value={c.offerId ?? ''} onChange={(v) => set({ offerId: v || null })} options={(offers.data ?? []).map((o) => ({ value: String(o.id), label: `${String(o.code)} (${String(o.status)})` }))} placeholder="No offer" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Send date"><Input type="date" value={c.sendDate ?? ''} disabled={!editable} onChange={(e) => set({ sendDate: e.target.value })} /></Field>
              <Field label="Slot"><Select value={c.slot ?? ''} onChange={(v) => set({ slot: v })} options={meta.data?.slots ?? ['11:00', '19:00']} /></Field>
            </div>
            <Field label="Goal event"><Select value={c.goalEvent} onChange={(v) => set({ goalEvent: v })} options={meta.data?.events ?? [c.goalEvent]} /></Field>
            <Field label="Attribution window (days)" hint="7 push/SMS, 14 email, 30 social"><Input type="number" min={1} max={30} value={c.attributionDays} onChange={(e) => set({ attributionDays: Number(e.target.value) })} /></Field>
          </div>
        </Card>
        <Card title="Review">
          <div className="space-y-3 text-sm">
            <Field label="Compliance / review note"><TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            {c.complianceNote && <p className="text-stone-600">Compliance note: {c.complianceNote}</p>}
            <p className="text-xs text-stone-500">Private-tier clients are excluded from promotional sends automatically. Frequency caps, quiet hours and consent are applied per client at send time.</p>
          </div>
        </Card>
      </div>
      <Card title="Segment">
        {editable ? <SegmentBuilder value={c.segmentFilter} onChange={(segmentFilter) => set({ segmentFilter })} /> : <Json value={c.segmentFilter} />}
      </Card>
      {results.data && (
        <Card title="Results vs holdout">
          <div className="grid gap-3 sm:grid-cols-4">
            <div><p className="text-xs text-stone-500">Treated / holdout</p><p className="text-lg font-semibold">{fmt.num(results.data.treated as number)} / {fmt.num(results.data.holdout as number)}</p></div>
            <div><p className="text-xs text-stone-500">Conversion treated</p><p className="text-lg font-semibold">{fmt.pct(results.data.conversionTreated as number)}</p></div>
            <div><p className="text-xs text-stone-500">Conversion holdout</p><p className="text-lg font-semibold">{fmt.pct(results.data.conversionHoldout as number)}</p></div>
            <div><p className="text-xs text-stone-500">Uplift · incremental</p><p className="text-lg font-semibold">{fmt.pct(results.data.uplift as number)} · {fmt.num(results.data.incrementalConversions as number)}</p></div>
          </div>
          <p className="mt-2 text-xs text-stone-500">
            Opt-out rate in treated group: {fmt.pct(results.data.optOutRate as number, 2)} · window {results.data.windowClosed ? 'closed' : 'still open'}
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Field label="Decision"><Select value={decision} onChange={setDecision} options={['keep', 'change', 'stop']} /></Field>
            <Field label="Why"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            <div className="self-end"><Button onClick={() => run(() => api(`/admin/campaigns/${id}/decision`, { body: { decision, note } }), 'Decision recorded in the register')}>Record decision</Button></div>
          </div>
          {c.decision && <p className="mt-2 text-sm">Recorded: <Badge>{c.decision}</Badge> {c.decisionNote}</p>}
        </Card>
      )}
    </Page>
  );
}
