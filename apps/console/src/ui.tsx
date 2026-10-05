import { useQuery } from '@tanstack/react-query';
import { type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes, useState } from 'react';
import { api, ApiError, type Me } from './api';

export const fmt = {
  num: (n: number | null | undefined, d = 0) =>
    n === null || n === undefined || Number.isNaN(n) ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }),
  pct: (n: number | null | undefined, d = 1) => (n === null || n === undefined ? '—' : `${(n * 100).toFixed(d)}%`),
  date: (s: string | null | undefined) => (s ? new Date(s).toLocaleString('en-GB', { timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short' }) : '—'),
  day: (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString('en-GB', { timeZone: 'Africa/Cairo' }) : '—'),
};

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/admin/auth/me') });
}

export function useMeta() {
  return useQuery({ queryKey: ['meta'], queryFn: () => api<Meta>('/admin/meta'), staleTime: Infinity });
}

export interface Meta {
  channels: string[];
  consentChannels: string[];
  topics: string[];
  consentableTopics: string[];
  categories: string[];
  kinds: string[];
  stages: Array<{ key: string; label: string }>;
  tiers: string[];
  tags: string[];
  objectives: Record<string, string>;
  mechanics: Record<string, string>;
  events: string[];
  slots: string[];
  roles: string[];
  providerMode: string;
}

export function Page({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-stone-500">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      <div className="space-y-5">{children}</div>
    </div>
  );
}

export function Card({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-stone-200 bg-white ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-stone-800">{title}</h2>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-gold-600 text-white hover:bg-gold-700 disabled:bg-stone-300',
  secondary: 'border border-stone-300 bg-white text-stone-800 hover:bg-stone-50 disabled:text-stone-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-stone-300',
  ghost: 'text-gold-700 hover:bg-gold-50',
};

export function Button({
  children,
  variant = 'secondary',
  onClick,
  disabled,
  type = 'button',
  small,
}: {
  children: ReactNode;
  variant?: Variant;
  onClick?: () => void | Promise<unknown>;
  disabled?: boolean;
  type?: 'button' | 'submit';
  small?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type={type}
      disabled={disabled || busy}
      onClick={
        onClick
          ? async () => {
              setBusy(true);
              try {
                await onClick();
              } finally {
                setBusy(false);
              }
            }
          : undefined
      }
      className={`${small ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-sm'} inline-flex items-center gap-1.5 rounded-md font-medium transition-colors ${VARIANTS[variant]}`}
    >
      {busy ? '…' : children}
    </button>
  );
}

const STATUS_COLORS: Record<string, string> = {
  sent: 'bg-emerald-50 text-emerald-700',
  delivered: 'bg-emerald-100 text-emerald-800',
  opened: 'bg-teal-100 text-teal-800',
  clicked: 'bg-teal-200 text-teal-900',
  approved: 'bg-emerald-100 text-emerald-800',
  live: 'bg-emerald-100 text-emerald-800',
  active: 'bg-emerald-50 text-emerald-700',
  completed: 'bg-stone-100 text-stone-700',
  done: 'bg-stone-100 text-stone-700',
  pending: 'bg-sky-50 text-sky-700',
  sending: 'bg-sky-50 text-sky-700',
  scheduled: 'bg-sky-50 text-sky-700',
  running: 'bg-sky-100 text-sky-800',
  open: 'bg-sky-50 text-sky-700',
  in_review: 'bg-amber-50 text-amber-800',
  pending_approval: 'bg-amber-50 text-amber-800',
  deferred: 'bg-amber-50 text-amber-800',
  held: 'bg-amber-100 text-amber-900',
  draft: 'bg-stone-100 text-stone-600',
  failed: 'bg-red-50 text-red-700',
  rejected: 'bg-red-50 text-red-700',
  suppressed: 'bg-stone-200 text-stone-700',
  cancelled: 'bg-stone-200 text-stone-600',
  retired: 'bg-stone-200 text-stone-500',
  exited: 'bg-stone-100 text-stone-600',
  skipped: 'bg-stone-100 text-stone-500',
  holdout: 'bg-violet-50 text-violet-700',
};

export function Badge({ children, tone }: { children: ReactNode; tone?: string }) {
  const cls = STATUS_COLORS[tone ?? String(children)] ?? 'bg-stone-100 text-stone-700';
  return <span className={`inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}

export interface Column<T> {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
  className?: string;
}

export function Table<T extends Record<string, unknown>>({
  columns,
  rows,
  onRowClick,
  empty = 'Nothing here yet.',
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  onRowClick?: (row: T) => void;
  empty?: string;
}) {
  if (!rows) return <Loading />;
  if (!rows.length) return <p className="py-6 text-center text-sm text-stone-500">{empty}</p>;
  return (
    <div className="-mx-4 overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
            {columns.map((c) => (
              <th key={c.key} className={`px-4 py-2 font-medium ${c.className ?? ''}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={(r.id as string) ?? i}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              className={`border-b border-stone-100 last:border-0 ${onRowClick ? 'cursor-pointer hover:bg-gold-50/50' : ''}`}
            >
              {columns.map((c) => (
                <td key={c.key} className={`px-4 py-2 align-top ${c.className ?? ''}`}>
                  {c.render ? c.render(r) : String(r[c.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Loading() {
  return <p className="py-6 text-center text-sm text-stone-400">Loading…</p>;
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as ApiError;
  const details = e.details;
  return (
    <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      <p className="font-medium">{e.message ?? String(error)}</p>
      {Array.isArray(details) && (
        <ul className="mt-1 list-disc pl-5">
          {details.map((d, i) => (
            <li key={i}>{typeof d === 'string' ? d : (d as { message?: string; path?: string[] }).message ?? JSON.stringify(d)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Field({ label, hint, children, wide }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`block ${wide ? 'sm:col-span-2' : ''}`}>
      <span className="mb-1 block text-xs font-medium text-stone-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-stone-400">{hint}</span>}
    </label>
  );
}

const inputCls = 'w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputCls} ${props.className ?? ''}`} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputCls} ${props.className ?? ''}`} />;
}

export function Select({ options, value, onChange, placeholder }: { options: Array<string | { value: string; label: string }>; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => {
        const v = typeof o === 'string' ? o : o.value;
        const l = typeof o === 'string' ? o : o.label;
        return (
          <option key={v} value={v}>
            {l}
          </option>
        );
      })}
    </select>
  );
}

export function Checks({ options, value, onChange }: { options: Array<string | { value: string; label: string }>; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {options.map((o) => {
        const v = typeof o === 'string' ? o : o.value;
        const l = typeof o === 'string' ? o : o.label;
        return (
          <label key={v} className="inline-flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={value.includes(v)}
              onChange={(e) => onChange(e.target.checked ? [...value, v] : value.filter((x) => x !== v))}
              className="accent-gold-600"
            />
            {l}
          </label>
        );
      })}
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'good' | 'bad' | 'neutral' }) {
  const toneCls = tone === 'good' ? 'text-emerald-700' : tone === 'bad' ? 'text-red-700' : 'text-ink';
  return (
    <div className="rounded-lg border border-stone-200 bg-white px-4 py-3">
      <p className="text-xs font-medium text-stone-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${toneCls}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-stone-500">{hint}</p>}
    </div>
  );
}

export function Tabs({ tabs, value, onChange }: { tabs: Array<{ key: string; label: string }>; value: string; onChange: (k: string) => void }) {
  return (
    <div className="flex gap-1 border-b border-stone-200">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${value === t.key ? 'border-gold-600 text-gold-700' : 'border-transparent text-stone-500 hover:text-stone-800'}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Json({ value }: { value: unknown }) {
  return <pre className="max-h-80 overflow-auto rounded bg-stone-50 p-3 text-xs">{JSON.stringify(value, null, 2)}</pre>;
}

export function Bar({ value, max, tone = 'bg-gold-500' }: { value: number; max: number; tone?: string }) {
  const w = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-2 w-full rounded bg-stone-100">
      <div className={`h-2 rounded ${tone}`} style={{ width: `${w}%` }} />
    </div>
  );
}
