import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { Badge, Bar, Card, ErrorBox, fmt, Loading, Page, Select, Stat, Table } from '../ui';

interface Dash {
  periodDays: number;
  totals: { clients: number; open: number; buyers: number; withPlan: number };
  stages: Array<{ stage: string; label: string; count: number }>;
  tiers: Array<{ tier: string; count: number }>;
  delivery: Array<{ channel: string; sent: number; failed: number; suppressed: number; deferred: number; pending: number; deliveryRate: number | null; openRate: number | null; clickRate: number | null }>;
  optOuts: Array<{ channel: string; optOuts: number; marketingSent: number; rate: number; threshold: number; breached: boolean }>;
  objectives: Array<{ key: string; label: string; metric: string; value: number | null; target: number | null; better: 'lower' | 'higher' }>;
  csat: { avg: number | null; responses: number };
  journeys: Array<{ key: string; name: string; enabled: boolean; enrolled: number; active: number; treated: number; holdout: number; conversionTreated: number; conversionHoldout: number; uplift: number }>;
  series: Array<{ day: string; channel: string; count: number }>;
}

export default function Dashboard() {
  const [days, setDays] = useState('30');
  const q = useQuery({ queryKey: ['dashboard', days], queryFn: () => api<Dash>(`/admin/dashboard?days=${days}`), refetchInterval: 60_000 });
  const d = q.data;

  return (
    <Page
      title="Dashboard"
      subtitle="Delivery health, engagement, behaviour and the five plan objectives. Every journey result is shown against its holdout."
      actions={
        <div className="w-36">
          <Select value={days} onChange={setDays} options={[{ value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' }]} />
        </div>
      }
    >
      <ErrorBox error={q.error} />
      {!d ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {d.objectives.map((o) => {
              const isPct = o.key !== 'O5';
              const v = o.value === null ? '—' : isPct ? fmt.pct(o.value) : fmt.num(o.value);
              const ok = o.value !== null && o.target !== null && (o.better === 'lower' ? o.value <= o.target : o.value >= o.target);
              return (
                <Stat
                  key={o.key}
                  label={`${o.key.slice(0, 2)} · ${o.metric}`}
                  value={v}
                  tone={o.target === null || o.value === null ? 'neutral' : ok ? 'good' : 'bad'}
                  hint={o.target !== null ? `Target ${o.better === 'lower' ? '≤' : '≥'} ${isPct ? fmt.pct(o.target, 0) : o.target}` : o.label}
                />
              );
            })}
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <Card title="Delivery health" className="lg:col-span-2">
              <Table
                rows={d.delivery as unknown as Array<Record<string, unknown>>}
                columns={[
                  { key: 'channel', label: 'Channel' },
                  { key: 'sent', label: 'Sent', render: (r) => fmt.num(r.sent as number), className: 'text-right tabular-nums' },
                  { key: 'deliveryRate', label: 'Delivered', render: (r) => fmt.pct(r.deliveryRate as number | null), className: 'text-right tabular-nums' },
                  { key: 'openRate', label: 'Open', render: (r) => fmt.pct(r.openRate as number | null), className: 'text-right tabular-nums' },
                  { key: 'clickRate', label: 'Click', render: (r) => fmt.pct(r.clickRate as number | null), className: 'text-right tabular-nums' },
                  { key: 'failed', label: 'Failed', render: (r) => fmt.num(r.failed as number), className: 'text-right tabular-nums' },
                  { key: 'suppressed', label: 'Suppressed', render: (r) => fmt.num(r.suppressed as number), className: 'text-right tabular-nums' },
                  { key: 'deferred', label: 'Held / deferred', render: (r) => fmt.num(r.deferred as number), className: 'text-right tabular-nums' },
                ]}
              />
            </Card>
            <Card title="Opt-out rate vs stop threshold">
              <div className="space-y-3">
                {d.optOuts.map((o) => (
                  <div key={o.channel}>
                    <div className="flex justify-between text-sm">
                      <span>{o.channel}</span>
                      <span className="tabular-nums">
                        {fmt.pct(o.rate, 2)} <span className="text-stone-400">/ {fmt.pct(o.threshold, 1)}</span> {o.breached && <Badge tone="failed">stop</Badge>}
                      </span>
                    </div>
                    <Bar value={o.rate} max={o.threshold * 2} tone={o.breached ? 'bg-red-500' : 'bg-gold-500'} />
                  </div>
                ))}
                <p className="text-xs text-stone-500">A campaign that pushes email opt-outs above 0.5% or push above 1% is stopped (plan §12.2).</p>
              </div>
            </Card>
          </div>

          <Card title="Journeys — treated vs holdout">
            <Table
              rows={d.journeys as unknown as Array<Record<string, unknown>>}
              columns={[
                { key: 'name', label: 'Journey' },
                { key: 'enabled', label: 'State', render: (r) => <Badge tone={r.enabled ? 'active' : 'cancelled'}>{r.enabled ? 'on' : 'off'}</Badge> },
                { key: 'active', label: 'Active', render: (r) => fmt.num(r.active as number), className: 'text-right tabular-nums' },
                { key: 'treated', label: 'Treated', render: (r) => fmt.num(r.treated as number), className: 'text-right tabular-nums' },
                { key: 'holdout', label: 'Holdout', render: (r) => fmt.num(r.holdout as number), className: 'text-right tabular-nums' },
                { key: 'conversionTreated', label: 'Conv. treated', render: (r) => fmt.pct(r.conversionTreated as number), className: 'text-right tabular-nums' },
                { key: 'conversionHoldout', label: 'Conv. holdout', render: (r) => fmt.pct(r.conversionHoldout as number), className: 'text-right tabular-nums' },
                {
                  key: 'uplift',
                  label: 'Uplift',
                  render: (r) => <span className={(r.uplift as number) > 0 ? 'text-emerald-700' : (r.uplift as number) < 0 ? 'text-red-700' : ''}>{fmt.pct(r.uplift as number)}</span>,
                  className: 'text-right tabular-nums',
                },
              ]}
            />
          </Card>

          <div className="grid gap-5 lg:grid-cols-3">
            <Card title="Clients by lifecycle stage" className="lg:col-span-2">
              <div className="space-y-2">
                {d.stages.map((s) => (
                  <div key={s.stage} className="grid grid-cols-[150px_1fr_70px] items-center gap-3 text-sm">
                    <span>
                      <span className="font-medium">{s.stage}</span> <span className="text-stone-500">{s.label}</span>
                    </span>
                    <Bar value={s.count} max={Math.max(...d.stages.map((x) => x.count), 1)} />
                    <span className="text-right tabular-nums">{fmt.num(s.count)}</span>
                  </div>
                ))}
              </div>
            </Card>
            <Card title="Base">
              <dl className="grid grid-cols-2 gap-y-2 text-sm">
                <dt className="text-stone-500">Clients</dt>
                <dd className="text-right tabular-nums">{fmt.num(d.totals.clients)}</dd>
                <dt className="text-stone-500">Buyers</dt>
                <dd className="text-right tabular-nums">{fmt.num(d.totals.buyers)}</dd>
                <dt className="text-stone-500">Recurring plans</dt>
                <dd className="text-right tabular-nums">{fmt.num(d.totals.withPlan)}</dd>
                <dt className="text-stone-500">CSAT (avg)</dt>
                <dd className="text-right tabular-nums">
                  {d.csat.avg === null ? '—' : d.csat.avg.toFixed(2)} <span className="text-stone-400">({d.csat.responses})</span>
                </dd>
                {d.tiers.map((t) => (
                  <div key={t.tier} className="contents">
                    <dt className="text-stone-500">Tier · {t.tier}</dt>
                    <dd className="text-right tabular-nums">{fmt.num(t.count)}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          </div>
        </>
      )}
    </Page>
  );
}
