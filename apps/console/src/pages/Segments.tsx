import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { cleanFilter, SegmentBuilder, type SegmentFilter } from '../SegmentBuilder';
import { Button, Card, ErrorBox, Field, fmt, Input, Page, Table } from '../ui';

type Row = Record<string, unknown>;

const PRESETS: Array<{ name: string; description: string; filter: SegmentFilter }> = [
  { name: 'Never activated (S1)', description: 'Registered, eKYC not approved — activation pool (O1)', filter: { stages: ['S1'] } },
  { name: 'Activated, no order (S2)', description: 'First purchase pool', filter: { stages: ['S2'] } },
  { name: 'Single buyers', description: 'Exactly one order — second purchase pool (O3)', filter: { minOrders: 1, maxOrders: 1 } },
  { name: 'Repeat buyers without a plan', description: 'Recurring plan cross-sell (O2/O3)', filter: { minOrders: 2, hasRecurringPlan: false } },
  { name: 'Former instalment-finance clients', description: 'Dedicated journey and dashboard (§7.4)', filter: { tagsAny: ['former_instalment'] } },
  { name: 'At risk (S6)', description: 'No order or login for 60 days', filter: { stages: ['S6'] } },
  { name: 'Dormant Premium & Private', description: 'Win-back call list', filter: { stages: ['S7'], tiers: ['premium', 'private'] } },
];

export default function Segments() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['segments'], queryFn: () => api<Row[]>('/admin/segments') });
  const [editing, setEditing] = useState<{ id?: string; name: string; description: string; filter: SegmentFilter } | null>(null);
  const [error, setError] = useState<unknown>(null);

  return (
    <Page
      title="Segments"
      subtitle="Saved audiences built from lifecycle stage and overlay tags (§3). Used by campaigns, banners and journey enrolment."
      actions={<Button variant="primary" onClick={() => setEditing({ name: '', description: '', filter: {} })}>New segment</Button>}
    >
      <ErrorBox error={error ?? list.error} />
      {editing && (
        <Card title={editing.id ? 'Edit segment' : 'New segment'}>
          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            <Field label="Name"><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            <Field label="Description"><Input value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></Field>
          </div>
          {!editing.id && (
            <div className="mb-4 flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <Button small key={p.name} onClick={() => setEditing({ ...editing, name: p.name, description: p.description, filter: p.filter })}>
                  {p.name}
                </Button>
              ))}
            </div>
          )}
          <SegmentBuilder value={editing.filter} onChange={(filter) => setEditing({ ...editing, filter })} />
          <div className="mt-4 flex gap-2">
            <Button
              variant="primary"
              onClick={async () => {
                setError(null);
                try {
                  const body = { name: editing.name, description: editing.description, filter: cleanFilter(editing.filter) };
                  if (editing.id) await api(`/admin/segments/${editing.id}`, { method: 'PUT', body });
                  else await api('/admin/segments', { body });
                  setEditing(null);
                  await qc.invalidateQueries({ queryKey: ['segments'] });
                } catch (e) {
                  setError(e);
                }
              }}
            >
              Save
            </Button>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
          </div>
        </Card>
      )}
      <Card>
        <Table
          rows={list.data}
          onRowClick={(r) => setEditing({ id: String(r.id), name: String(r.name), description: String(r.description ?? ''), filter: JSON.parse(String(r.filter)) as SegmentFilter })}
          columns={[
            { key: 'name', label: 'Name' },
            { key: 'description', label: 'Description' },
            { key: 'lastCount', label: 'Size (at save)', render: (r) => fmt.num(r.lastCount as number), className: 'text-right' },
            { key: 'filter', label: 'Filter', render: (r) => <code className="text-xs text-stone-600">{String(r.filter)}</code> },
            {
              key: 'actions',
              label: '',
              render: (r) => (
                <Button small variant="ghost" onClick={async () => { await api(`/admin/segments/${String(r.id)}`, { method: 'DELETE' }); await qc.invalidateQueries({ queryKey: ['segments'] }); }}>
                  Delete
                </Button>
              ),
            },
          ]}
        />
      </Card>
    </Page>
  );
}
