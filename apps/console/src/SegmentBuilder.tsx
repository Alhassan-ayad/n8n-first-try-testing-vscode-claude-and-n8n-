import { useState } from 'react';
import { api } from './api';
import { Button, Checks, ErrorBox, Field, fmt, Input, Select, useMeta } from './ui';

export interface SegmentFilter {
  stages?: string[];
  tiers?: string[];
  tagsAny?: string[];
  tagsAll?: string[];
  tagsNone?: string[];
  language?: 'ar' | 'en';
  sources?: string[];
  kycStatus?: string[];
  minOrders?: number;
  maxOrders?: number;
  hasRecurringPlan?: boolean;
  holdsMetal?: 'gold' | 'silver' | 'any';
  minHoldingValue?: number;
  maxHoldingValue?: number;
  inactiveDays?: number;
  registeredDaysAgoMin?: number;
  registeredDaysAgoMax?: number;
}

const csv = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
const numOrUndef = (s: string) => (s === '' ? undefined : Number(s));

/** Clean empty keys so stored filters stay readable. */
export function cleanFilter(f: SegmentFilter): SegmentFilter {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0) || Number.isNaN(v)) continue;
    out[k] = v;
  }
  return out as SegmentFilter;
}

export function SegmentBuilder({ value, onChange }: { value: SegmentFilter; onChange: (f: SegmentFilter) => void }) {
  const meta = useMeta();
  const [preview, setPreview] = useState<{ count: number; sample: Array<Record<string, unknown>> } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const set = (patch: Partial<SegmentFilter>) => onChange(cleanFilter({ ...value, ...patch }));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Lifecycle stages" wide>
          <Checks options={(meta.data?.stages ?? []).map((s) => ({ value: s.key, label: `${s.key} ${s.label}` }))} value={value.stages ?? []} onChange={(stages) => set({ stages })} />
        </Field>
        <Field label="Value tiers">
          <Checks options={meta.data?.tiers ?? []} value={value.tiers ?? []} onChange={(tiers) => set({ tiers })} />
        </Field>
        <Field label="Language">
          <Select value={value.language ?? ''} onChange={(v) => set({ language: (v || undefined) as SegmentFilter['language'] })} options={['ar', 'en']} placeholder="Any" />
        </Field>
        <Field label="Has any of these tags" hint={`e.g. ${meta.data?.tags.slice(0, 4).join(', ') ?? ''}`}>
          <Input value={(value.tagsAny ?? []).join(', ')} onChange={(e) => set({ tagsAny: csv(e.target.value) })} />
        </Field>
        <Field label="Has none of these tags">
          <Input value={(value.tagsNone ?? []).join(', ')} onChange={(e) => set({ tagsNone: csv(e.target.value) })} />
        </Field>
        <Field label="Min / max orders">
          <div className="flex gap-2">
            <Input type="number" min={0} value={value.minOrders ?? ''} onChange={(e) => set({ minOrders: numOrUndef(e.target.value) })} />
            <Input type="number" min={0} value={value.maxOrders ?? ''} onChange={(e) => set({ maxOrders: numOrUndef(e.target.value) })} />
          </div>
        </Field>
        <Field label="Holding value EGP (min / max)">
          <div className="flex gap-2">
            <Input type="number" min={0} value={value.minHoldingValue ?? ''} onChange={(e) => set({ minHoldingValue: numOrUndef(e.target.value) })} />
            <Input type="number" min={0} value={value.maxHoldingValue ?? ''} onChange={(e) => set({ maxHoldingValue: numOrUndef(e.target.value) })} />
          </div>
        </Field>
        <Field label="Holds metal">
          <Select value={value.holdsMetal ?? ''} onChange={(v) => set({ holdsMetal: (v || undefined) as SegmentFilter['holdsMetal'] })} options={['gold', 'silver', 'any']} placeholder="Doesn't matter" />
        </Field>
        <Field label="Recurring plan">
          <Select
            value={value.hasRecurringPlan === undefined ? '' : String(value.hasRecurringPlan)}
            onChange={(v) => set({ hasRecurringPlan: v === '' ? undefined : v === 'true' })}
            options={[
              { value: 'true', label: 'Has a plan' },
              { value: 'false', label: 'No plan' },
            ]}
            placeholder="Doesn't matter"
          />
        </Field>
        <Field label="No order for at least N days">
          <Input type="number" min={0} value={value.inactiveDays ?? ''} onChange={(e) => set({ inactiveDays: numOrUndef(e.target.value) })} />
        </Field>
        <Field label="eKYC status">
          <Checks options={['none', 'submitted', 'approved', 'rejected']} value={value.kycStatus ?? []} onChange={(kycStatus) => set({ kycStatus })} />
        </Field>
        <Field label="Source">
          <Input value={(value.sources ?? []).join(', ')} onChange={(e) => set({ sources: csv(e.target.value) })} placeholder="organic, referral, moneyfellows…" />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          small
          onClick={async () => {
            setError(null);
            try {
              setPreview(await api('/admin/segments/preview', { body: { filter: value } }));
            } catch (e) {
              setError(e);
            }
          }}
        >
          Preview audience
        </Button>
        {preview && (
          <span className="text-sm text-stone-600">
            <strong className="text-ink">{fmt.num(preview.count)}</strong> clients match
            {preview.sample.length > 0 && <> · e.g. {preview.sample.slice(0, 3).map((s) => String(s.fullName ?? s.externalId)).join(', ')}</>}
          </span>
        )}
      </div>
      <ErrorBox error={error} />
    </div>
  );
}
