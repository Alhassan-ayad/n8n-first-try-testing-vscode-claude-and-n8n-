import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, hasRole } from '../api';
import { SegmentBuilder, type SegmentFilter } from '../SegmentBuilder';
import { Badge, Button, Card, ErrorBox, fmt, Loading, Page, useMe } from '../ui';

interface Journey {
  key: string;
  name: string;
  objective: string;
  owner: string;
  description: string;
  enabled: boolean;
  holdoutPct: number;
  steps: Array<{ id: string; when: string; actions: string[]; note?: string; conditional: boolean }>;
  enrolled: number;
  active: number;
  treated: number;
  holdout: number;
  convertedTreated: number;
  convertedHoldout: number;
  conversionTreated: number;
  conversionHoldout: number;
  uplift: number;
}

const MANUAL = new Set(['activation', 'first_purchase', 'recurring_xsell', 'former_instalment', 'referral_invite']);

export default function Journeys() {
  const me = useMe();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['journeys'], queryFn: () => api<Journey[]>('/admin/journeys') });
  const [enrolKey, setEnrolKey] = useState<string | null>(null);
  const [filter, setFilter] = useState<SegmentFilter>({});
  const [msg, setMsg] = useState('');
  const [error, setError] = useState<unknown>(null);

  return (
    <Page
      title="Journeys"
      subtitle="Automated lifecycle sequences (§7). Each has entry and exit rules and a 10% holdout. Exit rules are re-checked before every step."
    >
      <ErrorBox error={q.error ?? error} />
      {msg && <p className="rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{msg}</p>}
      {!q.data ? (
        <Loading />
      ) : (
        q.data.map((j) => (
          <Card
            key={j.key}
            title={
              <span>
                {j.name} <span className="ml-1 text-xs font-normal text-stone-500">{j.objective} · {j.owner}</span>
              </span>
            }
            actions={
              <>
                <Badge tone={j.enabled ? 'active' : 'cancelled'}>{j.enabled ? 'enabled' : 'disabled'}</Badge>
                {hasRole(me.data, 'crm') && (
                  <Button small onClick={async () => { await api(`/admin/journeys/${j.key}`, { method: 'PUT', body: { enabled: !j.enabled } }); await qc.invalidateQueries({ queryKey: ['journeys'] }); }}>
                    {j.enabled ? 'Disable' : 'Enable'}
                  </Button>
                )}
                {MANUAL.has(j.key) && hasRole(me.data, 'crm') && <Button small onClick={() => { setEnrolKey(enrolKey === j.key ? null : j.key); setFilter({}); }}>Enrol a segment</Button>}
              </>
            }
          >
            <p className="mb-3 text-sm text-stone-600">{j.description}</p>
            <div className="grid gap-4 lg:grid-cols-3">
              <ol className="space-y-1.5 text-sm lg:col-span-2">
                {j.steps.map((s) => (
                  <li key={s.id} className="flex gap-3">
                    <span className="w-24 shrink-0 font-mono text-xs text-stone-500">{s.id} · {s.when}</span>
                    <span>
                      {s.actions.join(' · ')} {s.conditional && <Badge tone="draft">conditional</Badge>}
                      {s.note && <span className="block text-xs text-stone-500">{s.note}</span>}
                    </span>
                  </li>
                ))}
              </ol>
              <dl className="grid grid-cols-2 content-start gap-y-1 text-sm">
                <dt className="text-stone-500">Active</dt><dd className="text-right tabular-nums">{fmt.num(j.active)}</dd>
                <dt className="text-stone-500">Treated / holdout</dt><dd className="text-right tabular-nums">{fmt.num(j.treated)} / {fmt.num(j.holdout)}</dd>
                <dt className="text-stone-500">Converted (T)</dt><dd className="text-right tabular-nums">{fmt.num(j.convertedTreated)} · {fmt.pct(j.conversionTreated)}</dd>
                <dt className="text-stone-500">Converted (H)</dt><dd className="text-right tabular-nums">{fmt.num(j.convertedHoldout)} · {fmt.pct(j.conversionHoldout)}</dd>
                <dt className="text-stone-500">Uplift</dt><dd className={`text-right font-semibold tabular-nums ${j.uplift > 0 ? 'text-emerald-700' : j.uplift < 0 ? 'text-red-700' : ''}`}>{fmt.pct(j.uplift)}</dd>
              </dl>
            </div>
            {enrolKey === j.key && (
              <div className="mt-4 rounded-lg border border-gold-100 bg-gold-50/40 p-4">
                <p className="mb-3 text-sm font-medium">Enrol matching clients into “{j.name}”. Entry filters, re-entry rules and holdout still apply.</p>
                <SegmentBuilder value={filter} onChange={setFilter} />
                <div className="mt-3">
                  <Button
                    variant="primary"
                    onClick={async () => {
                      setError(null);
                      try {
                        const r = await api<{ matched: number; enrolled: number }>(`/admin/journeys/${j.key}/enrol`, { body: { filter } });
                        setMsg(`${j.name}: ${r.enrolled} of ${r.matched} matching clients enrolled.`);
                        setEnrolKey(null);
                        await qc.invalidateQueries({ queryKey: ['journeys'] });
                      } catch (e) {
                        setError(e);
                      }
                    }}
                  >
                    Enrol
                  </Button>
                </div>
              </div>
            )}
          </Card>
        ))
      )}
    </Page>
  );
}
