import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, hasRole } from '../api';
import { Badge, Button, Card, ErrorBox, Field, fmt, Input, Loading, Page, Select, Table, TextArea, useMe, useMeta } from '../ui';

type Row = Record<string, unknown>;

export default function Offers() {
  const nav = useNavigate();
  const list = useQuery({ queryKey: ['offers'], queryFn: () => api<Row[]>('/admin/offers') });
  return (
    <Page
      title="Offer register"
      subtitle="No offer is communicated until its cost, eligibility, expiry and approvals are recorded here (§8)."
      actions={<Button variant="primary" onClick={() => nav('/offers/new')}>New offer</Button>}
    >
      <Card>
        <ErrorBox error={list.error} />
        <Table
          rows={list.data}
          onRowClick={(r) => nav(`/offers/${String(r.id)}`)}
          columns={[
            { key: 'code', label: 'ID', render: (r) => <span className="font-mono text-xs">{String(r.code)}</span> },
            { key: 'name', label: 'Name' },
            { key: 'mechanic', label: 'Mechanic' },
            { key: 'worstCaseCost', label: 'Worst case EGP', render: (r) => fmt.num(r.worstCaseCost as number), className: 'text-right tabular-nums' },
            { key: 'approvalTier', label: 'Route' },
            { key: 'endDate', label: 'Expires', render: (r) => fmt.day(r.endDate as string) },
            { key: 'status', label: 'Status', render: (r) => <Badge>{String(r.status)}</Badge> },
            { key: 'decision', label: 'Decision' },
          ]}
        />
      </Card>
    </Page>
  );
}

interface Offer {
  id?: string;
  code: string;
  name: string;
  mechanic: string;
  eligibility: string;
  exclusions?: string | null;
  hypothesis: string;
  costPerRedemption: number;
  expectedRedemption: number;
  eligibleCount: number;
  isNewMechanic: boolean;
  touchesPricing: boolean;
  metalDenominated: boolean;
  hedgeReference?: string | null;
  holdoutPct: number;
  startDate?: string | null;
  endDate?: string | null;
  termsUrlEn?: string | null;
  termsUrlAr?: string | null;
  helpCentreUrl?: string | null;
  status?: string;
}

interface Status {
  offer: Offer & { approvals: Array<{ role: string; approver: string; decision: string; createdAt: string; note?: string }> };
  econ: { treated: number; worstCaseCost: number; expectedCost: number };
  route: { tier: string; requiredRoles: string[]; complianceLevel: string; leadTimeWorkingDays: number };
  approvedRoles: string[];
  problems: string[];
  ready: boolean;
}

const EMPTY: Offer = {
  code: '',
  name: '',
  mechanic: 'activation_bonus',
  eligibility: '',
  hypothesis: '',
  costPerRedemption: 0,
  expectedRedemption: 0.1,
  eligibleCount: 0,
  isNewMechanic: false,
  touchesPricing: false,
  metalDenominated: true,
  holdoutPct: 10,
};

const d = (s?: string | null) => (s ? s.slice(0, 10) : '');

export function OfferEditor() {
  const { id } = useParams();
  const isNew = id === 'new';
  const nav = useNavigate();
  const qc = useQueryClient();
  const me = useMe();
  const meta = useMeta();
  const [o, setO] = useState<Offer>(EMPTY);
  const [error, setError] = useState<unknown>(null);
  const [info, setInfo] = useState('');
  const [review, setReview] = useState({ actualRedemptions: 0, actualCost: 0, result: '', decision: 'keep' });

  const q = useQuery({ queryKey: ['offer', id], enabled: !isNew, queryFn: () => api<Status>(`/admin/offers/${id}`) });
  useEffect(() => {
    if (q.data) setO(q.data.offer);
  }, [q.data]);

  const set = (patch: Partial<Offer>) => setO({ ...o, ...patch });
  const editable = isNew || ['draft', 'pending_approval', 'rejected'].includes(o.status ?? 'draft');
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setError(null);
    setInfo('');
    try {
      await fn();
      setInfo(msg);
      await qc.invalidateQueries({ queryKey: ['offer', id] });
      await qc.invalidateQueries({ queryKey: ['offers'] });
    } catch (e) {
      setError(e);
    }
  };
  const payload = () => ({
    code: o.code,
    name: o.name,
    mechanic: o.mechanic,
    eligibility: o.eligibility,
    exclusions: o.exclusions || null,
    hypothesis: o.hypothesis,
    costPerRedemption: Number(o.costPerRedemption),
    expectedRedemption: Number(o.expectedRedemption),
    eligibleCount: Number(o.eligibleCount),
    isNewMechanic: o.isNewMechanic,
    touchesPricing: o.touchesPricing,
    metalDenominated: o.metalDenominated,
    hedgeReference: o.hedgeReference || null,
    holdoutPct: Number(o.holdoutPct),
    startDate: o.startDate || null,
    endDate: o.endDate || null,
    termsUrlEn: o.termsUrlEn || null,
    termsUrlAr: o.termsUrlAr || null,
    helpCentreUrl: o.helpCentreUrl || null,
  });

  if (!isNew && !q.data) return <Page title="Offer"><ErrorBox error={q.error} />{!q.error && <Loading />}</Page>;
  const s = q.data;

  return (
    <Page
      title={isNew ? 'New offer' : `${o.code} · ${o.name}`}
      subtitle={isNew ? 'Economics and the approval route are computed from the worst-case cost.' : `Status: ${o.status}`}
      actions={
        <>
          {editable && hasRole(me.data, 'marketing', 'crm', 'head_of_marketing') && (
            <Button variant="primary" onClick={() => run(async () => {
              const r = isNew ? await api<Status>('/admin/offers', { body: payload() }) : await api<Status>(`/admin/offers/${id}`, { method: 'PUT', body: payload() });
              if (isNew) nav(`/offers/${String(r.offer.id)}`);
            }, 'Saved — any change resets approvals')}>Save</Button>
          )}
          {!isNew && ['draft', 'rejected'].includes(o.status ?? '') && <Button onClick={() => run(() => api(`/admin/offers/${id}/submit`, { body: {} }), 'Submitted for approval')}>Submit for approval</Button>}
        </>
      }
    >
      <ErrorBox error={error} />
      {info && <p className="rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{info}</p>}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Offer" className="lg:col-span-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Offer ID"><Input value={o.code} disabled={!isNew} onChange={(e) => set({ code: e.target.value.toUpperCase() })} /></Field>
            <Field label="Name"><Input value={o.name} disabled={!editable} onChange={(e) => set({ name: e.target.value })} /></Field>
            <Field label="Mechanic" wide><Select value={o.mechanic} onChange={(v) => set({ mechanic: v })} options={Object.entries(meta.data?.mechanics ?? {}).map(([k, v]) => ({ value: k, label: v }))} /></Field>
            <Field label="Hypothesis" wide><TextArea rows={2} value={o.hypothesis} disabled={!editable} onChange={(e) => set({ hypothesis: e.target.value })} /></Field>
            <Field label="Eligibility" wide><TextArea rows={2} value={o.eligibility} disabled={!editable} onChange={(e) => set({ eligibility: e.target.value })} /></Field>
            <Field label="Exclusions / anti-abuse" wide hint="One account per verified identity; buy-and-sell patterns excluded; referral fraud screening"><TextArea rows={2} value={o.exclusions ?? ''} disabled={!editable} onChange={(e) => set({ exclusions: e.target.value })} /></Field>
            <Field label="Cost per redemption (EGP)"><Input type="number" min={0} value={o.costPerRedemption} disabled={!editable} onChange={(e) => set({ costPerRedemption: Number(e.target.value) })} /></Field>
            <Field label="Expected redemption (0–1)"><Input type="number" step="0.01" min={0} max={1} value={o.expectedRedemption} disabled={!editable} onChange={(e) => set({ expectedRedemption: Number(e.target.value) })} /></Field>
            <Field label="Eligible clients"><Input type="number" min={0} value={o.eligibleCount} disabled={!editable} onChange={(e) => set({ eligibleCount: Number(e.target.value) })} /></Field>
            <Field label="Holdout %"><Input type="number" min={10} max={50} value={o.holdoutPct} disabled={!editable} onChange={(e) => set({ holdoutPct: Number(e.target.value) })} /></Field>
            <Field label="Start"><Input type="date" value={d(o.startDate)} disabled={!editable} onChange={(e) => set({ startDate: e.target.value })} /></Field>
            <Field label="Expiry"><Input type="date" value={d(o.endDate)} disabled={!editable} onChange={(e) => set({ endDate: e.target.value })} /></Field>
            <Field label="Terms URL (English)"><Input value={o.termsUrlEn ?? ''} disabled={!editable} onChange={(e) => set({ termsUrlEn: e.target.value })} /></Field>
            <Field label="Terms URL (Arabic)"><Input value={o.termsUrlAr ?? ''} disabled={!editable} onChange={(e) => set({ termsUrlAr: e.target.value })} /></Field>
            <Field label="Help-centre entry URL"><Input value={o.helpCentreUrl ?? ''} disabled={!editable} onChange={(e) => set({ helpCentreUrl: e.target.value })} /></Field>
            <Field label="Hedge reference" hint="Required for metal-denominated incentives at go-live"><Input value={o.hedgeReference ?? ''} disabled={!editable} onChange={(e) => set({ hedgeReference: e.target.value })} /></Field>
            <div className="flex flex-wrap gap-4 text-sm sm:col-span-2">
              <label className="inline-flex items-center gap-1.5"><input type="checkbox" className="accent-gold-600" checked={o.metalDenominated} onChange={(e) => set({ metalDenominated: e.target.checked })} /> Metal-denominated</label>
              <label className="inline-flex items-center gap-1.5"><input type="checkbox" className="accent-gold-600" checked={o.isNewMechanic} onChange={(e) => set({ isNewMechanic: e.target.checked })} /> New mechanic</label>
              <label className="inline-flex items-center gap-1.5"><input type="checkbox" className="accent-gold-600" checked={o.touchesPricing} onChange={(e) => set({ touchesPricing: e.target.checked })} /> Touches pricing, spread or delivery</label>
            </div>
          </div>
        </Card>
        <div className="space-y-5">
          {s && (
            <Card title="Economics & approval route">
              <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
                <dt className="text-stone-500">Treated clients</dt><dd className="text-right tabular-nums">{fmt.num(s.econ.treated)}</dd>
                <dt className="text-stone-500">Worst-case cost</dt><dd className="text-right tabular-nums">EGP {fmt.num(s.econ.worstCaseCost)}</dd>
                <dt className="text-stone-500">Expected cost</dt><dd className="text-right tabular-nums">EGP {fmt.num(s.econ.expectedCost)}</dd>
                <dt className="text-stone-500">Route</dt><dd className="text-right">{s.route.tier}</dd>
                <dt className="text-stone-500">Compliance</dt><dd className="text-right">{s.route.complianceLevel}</dd>
                <dt className="text-stone-500">Lead time</dt><dd className="text-right">{s.route.leadTimeWorkingDays} working days</dd>
              </dl>
              <div className="mt-4 space-y-2">
                {s.route.requiredRoles.map((role) => {
                  const a = s.offer.approvals.find((x) => x.role === role);
                  return (
                    <div key={role} className="flex items-center justify-between text-sm">
                      <span>{role}</span>
                      {a ? (
                        <span><Badge>{a.decision}</Badge> <span className="text-xs text-stone-500">{a.approver}</span></span>
                      ) : o.status === 'pending_approval' && hasRole(me.data, role) ? (
                        <span className="flex gap-1">
                          <Button small variant="primary" onClick={() => run(() => api(`/admin/offers/${id}/approve`, { body: { role, decision: 'approved' } }), `${role} approval recorded`)}>Approve</Button>
                          <Button small variant="danger" onClick={() => run(() => api(`/admin/offers/${id}/approve`, { body: { role, decision: 'rejected' } }), 'Rejected')}>Reject</Button>
                        </span>
                      ) : (
                        <Badge tone="pending">pending</Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
          {s && s.problems.length > 0 && (
            <Card title="Before it can go live">
              <ul className="list-disc space-y-1 pl-5 text-sm text-amber-900">{s.problems.map((p) => <li key={p}>{p}</li>)}</ul>
            </Card>
          )}
          {s && ['ended', 'live'].includes(o.status ?? '') && (
            <Card title="Post-campaign review (within 10 working days)">
              <div className="space-y-3">
                <Field label="Actual redemptions"><Input type="number" value={review.actualRedemptions} onChange={(e) => setReview({ ...review, actualRedemptions: Number(e.target.value) })} /></Field>
                <Field label="Actual cost (EGP)"><Input type="number" value={review.actualCost} onChange={(e) => setReview({ ...review, actualCost: Number(e.target.value) })} /></Field>
                <Field label="Result"><TextArea rows={2} value={review.result} onChange={(e) => setReview({ ...review, result: e.target.value })} /></Field>
                <Field label="Decision"><Select value={review.decision} onChange={(v) => setReview({ ...review, decision: v })} options={['keep', 'change', 'stop']} /></Field>
                <Button onClick={() => run(() => api(`/admin/offers/${id}/review`, { body: review }), 'Review recorded')}>Record review</Button>
              </div>
            </Card>
          )}
        </div>
      </div>
    </Page>
  );
}
