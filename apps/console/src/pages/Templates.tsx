import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, hasRole } from '../api';
import { Badge, Button, Card, ErrorBox, Field, fmt, Input, Loading, Page, Select, Table, Tabs, TextArea, useMe, useMeta } from '../ui';

type Row = Record<string, unknown>;

export default function Templates() {
  const nav = useNavigate();
  const [tab, setTab] = useState('library');
  const [key, setKey] = useState('');
  const [channel, setChannel] = useState('');
  const [status, setStatus] = useState('');
  const [language, setLanguage] = useState('');
  const params = new URLSearchParams({ ...(key ? { key } : {}), ...(channel ? { channel } : {}), ...(status ? { status } : {}), ...(language ? { language } : {}) });
  const list = useQuery({ queryKey: ['templates', params.toString()], queryFn: () => api<Row[]>(`/admin/templates?${params}`), enabled: tab === 'library' });
  const coverage = useQuery({ queryKey: ['coverage'], queryFn: () => api<Array<{ key: string; channel: string; ar: boolean; en: boolean }>>('/admin/templates/coverage'), enabled: tab === 'coverage' });
  const missing = coverage.data?.filter((c) => !c.ar || !c.en).length ?? 0;

  return (
    <Page
      title="Templates"
      subtitle="Arabic and English versions of every message. Approved versions are immutable; edits create a new draft that goes back through Compliance review (§9.2)."
      actions={<Button variant="primary" onClick={() => nav('/templates/new')}>New template</Button>}
    >
      <Card>
        <Tabs value={tab} onChange={setTab} tabs={[{ key: 'library', label: 'Library' }, { key: 'coverage', label: 'Coverage' }]} />
        <div className="pt-4">
          {tab === 'library' && (
            <>
              <div className="mb-4 grid gap-3 sm:grid-cols-4">
                <Input placeholder="Search key" value={key} onChange={(e) => setKey(e.target.value)} />
                <Select value={channel} onChange={setChannel} options={['push', 'email', 'sms', 'inapp', 'whatsapp']} placeholder="All channels" />
                <Select value={status} onChange={setStatus} options={['draft', 'in_review', 'approved', 'rejected', 'retired']} placeholder="All statuses" />
                <Select value={language} onChange={setLanguage} options={['ar', 'en']} placeholder="Both languages" />
              </div>
              <ErrorBox error={list.error} />
              <Table
                rows={list.data}
                onRowClick={(r) => nav(`/templates/${String(r.id)}`)}
                columns={[
                  { key: 'key', label: 'Key', render: (r) => <span className="font-mono text-xs">{String(r.key)}</span> },
                  { key: 'channel', label: 'Channel' },
                  { key: 'language', label: 'Lang' },
                  { key: 'version', label: 'v' },
                  { key: 'category', label: 'Cat.' },
                  { key: 'topic', label: 'Topic' },
                  { key: 'status', label: 'Status', render: (r) => <Badge>{String(r.status)}</Badge> },
                  { key: 'body', label: 'Body', render: (r) => <span className={`line-clamp-1 max-w-sm text-xs text-stone-600 ${r.language === 'ar' ? 'rtl' : ''}`}>{String(r.title ?? r.subject ?? '')} {String(r.body)}</span> },
                ]}
              />
            </>
          )}
          {tab === 'coverage' && (
            <>
              <p className="mb-3 text-sm text-stone-600">
                Every template the platform can send, by channel. A missing approved version means that message will not go out in production.{' '}
                {coverage.data && <strong className={missing ? 'text-red-700' : 'text-emerald-700'}>{missing} gaps</strong>}
              </p>
              <Table
                rows={coverage.data as unknown as Row[] | undefined}
                onRowClick={(r) => { setTab('library'); setKey(String(r.key)); }}
                columns={[
                  { key: 'key', label: 'Key', render: (r) => <span className="font-mono text-xs">{String(r.key)}</span> },
                  { key: 'channel', label: 'Channel' },
                  { key: 'ar', label: 'Arabic approved', render: (r) => (r.ar ? <Badge tone="approved">yes</Badge> : <Badge tone="failed">missing</Badge>) },
                  { key: 'en', label: 'English approved', render: (r) => (r.en ? <Badge tone="approved">yes</Badge> : <Badge tone="failed">missing</Badge>) },
                ]}
              />
            </>
          )}
        </div>
      </Card>
    </Page>
  );
}

interface Template {
  id?: string;
  key: string;
  channel: string;
  language: string;
  category: string;
  topic: string;
  subject?: string | null;
  title?: string | null;
  body: string;
  html?: string | null;
  deepLink?: string | null;
  imageUrl?: string | null;
  status?: string;
  version?: number;
  reviewNote?: string | null;
  submittedBy?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  versions?: Array<{ id: string; version: number; status: string; approvedBy: string | null; updatedAt: string }>;
}

interface LintIssue {
  level: 'error' | 'warning';
  rule: string;
  message: string;
  match?: string;
}

const EMPTY: Template = { key: '', channel: 'push', language: 'ar', category: 'C', topic: 'lifecycle', body: '' };

export function TemplateEditor() {
  const { id } = useParams();
  const isNew = id === 'new';
  const nav = useNavigate();
  const qc = useQueryClient();
  const me = useMe();
  const meta = useMeta();
  const [t, setT] = useState<Template>(EMPTY);
  const [lint, setLint] = useState<LintIssue[]>([]);
  const [preview, setPreview] = useState<{ subject: string | null; title: string | null; body: string; length: number; html: string | null } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState('');
  const [testTo, setTestTo] = useState('');
  const [testClient, setTestClient] = useState('');
  const [info, setInfo] = useState('');

  const q = useQuery({ queryKey: ['template', id], queryFn: () => api<Template>(`/admin/templates/${id}`), enabled: !isNew });
  useEffect(() => {
    if (q.data) setT(q.data);
  }, [q.data]);

  useEffect(() => {
    const h = setTimeout(async () => {
      if (!t.body) return;
      try {
        setLint(await api<LintIssue[]>('/admin/lint', { body: { channel: t.channel, language: t.language, subject: t.subject, title: t.title, body: t.body, html: t.html, deepLink: t.deepLink, category: t.category } }));
      } catch {
        /* ignore */
      }
    }, 400);
    return () => clearTimeout(h);
  }, [t.body, t.subject, t.title, t.channel, t.language, t.deepLink, t.html, t.category]);

  const editable = isNew || ['draft', 'rejected'].includes(t.status ?? 'draft');
  const set = (patch: Partial<Template>) => setT({ ...t, ...patch });
  const run = async (fn: () => Promise<unknown>, msg?: string) => {
    setError(null);
    setInfo('');
    try {
      await fn();
      if (msg) setInfo(msg);
      await qc.invalidateQueries({ queryKey: ['template', id] });
      await qc.invalidateQueries({ queryKey: ['templates'] });
    } catch (e) {
      setError(e);
    }
  };

  if (!isNew && !q.data) return <Page title="Template"><ErrorBox error={q.error} />{!q.error && <Loading />}</Page>;

  const payload = { key: t.key, channel: t.channel, language: t.language, category: t.category, topic: t.topic, subject: t.subject || null, title: t.title || null, body: t.body, html: t.html || null, deepLink: t.deepLink || null, imageUrl: t.imageUrl || null };
  const rtl = t.language === 'ar';

  return (
    <Page
      title={isNew ? 'New template' : `${t.key} · ${t.channel} · ${t.language}`}
      subtitle={isNew ? 'Drafts go to Compliance for review before they can be used.' : `Version ${t.version} · ${t.status}${t.approvedBy ? ` · approved by ${t.approvedBy} ${fmt.date(t.approvedAt)}` : ''}`}
      actions={
        <>
          {(editable || !isNew) && hasRole(me.data, 'crm', 'marketing', 'content', 'research') && (
            <Button
              variant="primary"
              onClick={() =>
                run(async () => {
                  const saved = isNew ? await api<Template>('/admin/templates', { body: payload }) : await api<Template>(`/admin/templates/${id}`, { method: 'PUT', body: payload });
                  if (saved.id !== id) nav(`/templates/${saved.id}`);
                }, editable ? 'Saved' : 'Saved as a new draft version')
              }
            >
              {editable ? 'Save draft' : 'Save as new version'}
            </Button>
          )}
          {!isNew && ['draft', 'rejected'].includes(t.status ?? '') && hasRole(me.data, 'crm', 'marketing', 'content', 'research') && (
            <Button onClick={() => run(() => api(`/admin/templates/${id}/submit`, { body: {} }), 'Submitted for Compliance review')}>Submit for review</Button>
          )}
          {!isNew && t.status === 'in_review' && hasRole(me.data, 'compliance') && (
            <>
              <Button variant="primary" onClick={() => run(() => api(`/admin/templates/${id}/approve`, { body: { note } }), 'Approved')}>Approve</Button>
              <Button variant="danger" onClick={() => run(() => api(`/admin/templates/${id}/reject`, { body: { note } }), 'Rejected')}>Reject</Button>
            </>
          )}
          {!isNew && t.status === 'approved' && hasRole(me.data, 'compliance', 'crm') && (
            <Button onClick={() => run(() => api(`/admin/templates/${id}/retire`, { body: {} }), 'Retired')}>Retire</Button>
          )}
        </>
      }
    >
      <ErrorBox error={error} />
      {info && <p className="rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{info}</p>}
      <div className="grid gap-5 lg:grid-cols-5">
        <Card title="Content" className="lg:col-span-3">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Key" hint="snake_case, shared across channels and languages">
              <Input value={t.key} disabled={!isNew} onChange={(e) => set({ key: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Channel"><Select value={t.channel} onChange={(v) => set({ channel: v })} options={['push', 'email', 'sms', 'inapp', 'whatsapp']} /></Field>
              <Field label="Language"><Select value={t.language} onChange={(v) => set({ language: v })} options={['ar', 'en']} /></Field>
            </div>
            <Field label="Category"><Select value={t.category} onChange={(v) => set({ category: v })} options={meta.data?.categories ?? []} /></Field>
            <Field label="Topic (consent)"><Select value={t.topic} onChange={(v) => set({ topic: v })} options={meta.data?.topics ?? []} /></Field>
            {t.channel === 'email' && (
              <Field label="Subject" wide><Input dir={rtl ? 'rtl' : 'ltr'} value={t.subject ?? ''} disabled={!editable} onChange={(e) => set({ subject: e.target.value })} /></Field>
            )}
            {['push', 'inapp'].includes(t.channel) && (
              <Field label="Title" wide><Input dir={rtl ? 'rtl' : 'ltr'} value={t.title ?? ''} disabled={!editable} onChange={(e) => set({ title: e.target.value })} /></Field>
            )}
            <Field label="Body" wide hint="Handlebars: {{firstName}}, {{grams grams}}, {{egp amount}}, {{metal metal}}, {{date slotAt}}, {{link}}">
              <TextArea dir={rtl ? 'rtl' : 'ltr'} rows={t.channel === 'email' ? 10 : 4} value={t.body} disabled={!editable} onChange={(e) => set({ body: e.target.value })} />
            </Field>
            {t.channel === 'email' && (
              <Field label="HTML body (optional — overrides the plain body inside the branded layout)" wide>
                <TextArea rows={4} className="font-mono text-xs" value={t.html ?? ''} disabled={!editable} onChange={(e) => set({ html: e.target.value })} />
              </Field>
            )}
            <Field label="Deep link" hint="Path like /orders/{{orderId}} — required for push">
              <Input value={t.deepLink ?? ''} disabled={!editable} onChange={(e) => set({ deepLink: e.target.value })} />
            </Field>
            {t.channel === 'push' && (
              <Field label="Image URL (rich push)"><Input value={t.imageUrl ?? ''} disabled={!editable} onChange={(e) => set({ imageUrl: e.target.value })} /></Field>
            )}
          </div>
        </Card>
        <div className="space-y-5 lg:col-span-2">
          <Card title="Compliance lint">
            {lint.length === 0 ? (
              <p className="text-sm text-emerald-700">No issues found.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {lint.map((i, n) => (
                  <li key={n} className={i.level === 'error' ? 'text-red-700' : 'text-amber-700'}>
                    <strong>{i.level}</strong> · {i.message} {i.match && <code className="rounded bg-stone-100 px-1">{i.match}</code>}
                  </li>
                ))}
              </ul>
            )}
            {t.status === 'in_review' && hasRole(me.data, 'compliance') && (
              <div className="mt-3">
                <Field label="Review note"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
              </div>
            )}
            {t.reviewNote && <p className="mt-3 text-sm text-stone-600">Reviewer note: {t.reviewNote}</p>}
          </Card>
          {!isNew && (
            <Card title="Preview" actions={<Button small onClick={() => run(async () => setPreview(await api(`/admin/templates/${id}/preview`, { body: {} })))}>Render with sample data</Button>}>
              {preview ? (
                preview.html ? (
                  <iframe title="email preview" className="h-96 w-full rounded border border-stone-200" srcDoc={preview.html} />
                ) : (
                  <div className={`rounded-lg bg-stone-900 p-3 text-sm text-white ${rtl ? 'rtl' : ''}`}>
                    {preview.title && <p className="font-semibold">{preview.title}</p>}
                    <p className="whitespace-pre-wrap">{preview.body}</p>
                    <p className="mt-2 text-xs text-stone-400">{preview.length} characters</p>
                  </div>
                )
              ) : (
                <p className="text-sm text-stone-500">Render to see the message as a client would.</p>
              )}
            </Card>
          )}
          {!isNew && (
            <Card title="Test send">
              <div className="space-y-3">
                <Field label="Destination" hint="Phone, email, or FCM token — or use a client ID below"><Input value={testTo} onChange={(e) => setTestTo(e.target.value)} /></Field>
                <Field label="…or client ID"><Input value={testClient} onChange={(e) => setTestClient(e.target.value)} /></Field>
                <Button small onClick={() => run(() => api(`/admin/templates/${id}/test-send`, { body: { to: testTo || undefined, clientExternalId: testClient || undefined } }), 'Test message queued — see Messages')}>Send test</Button>
              </div>
            </Card>
          )}
          {t.versions && t.versions.length > 1 && (
            <Card title="Versions">
              <ul className="space-y-1 text-sm">
                {t.versions.map((v) => (
                  <li key={v.id}>
                    <button className="text-gold-700 hover:underline" onClick={() => nav(`/templates/${v.id}`)}>v{v.version}</button> <Badge>{v.status}</Badge>{' '}
                    <span className="text-xs text-stone-500">{fmt.date(v.updatedAt)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </Page>
  );
}
