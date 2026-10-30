'use client';

import { useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import type { TemplateDto, TemplateRole } from '@/lib/sign/templates';
import FieldPlacer, { newKey, type PlacedField } from './FieldPlacer';
import { api, SignDialog, useErrorText, useToast } from './ui';

type Tab = 'setup' | 'fields' | 'use' | 'bulk';
type Role = 'signer' | 'approver' | 'cc';
type Person = { name: string; email: string };

const toPlaced = (tp: TemplateDto): PlacedField[] => tp.fields.map((f) => ({ key: newKey(), partyId: f.roleKey, kind: f.kind, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, required: f.required, label: f.label, options: f.options }));

/** Plantilla: documento, roles, campos por rol, usarla con personas y el envío masivo desde un CSV. */
export default function TemplateEditor({ initial, startTab, maxMb }: { initial: TemplateDto; startTab: Tab; maxMb: number }) {
  const t = useTranslations('sign');
  const locale = useLocale();
  const router = useRouter();
  const errorText = useErrorText();
  const [toasts, toast] = useToast();
  const [tp, setTp] = useState(initial);
  const [tab, setTab] = useState<Tab>(initial.canEdit ? startTab : startTab === 'setup' || startTab === 'fields' ? 'use' : startTab);
  const [meta, setMeta] = useState({ name: initial.name, description: initial.description, message: initial.message, signingOrder: initial.signingOrder, otpRequired: initial.otpRequired, expiresDays: initial.expiresDays, reminderDays: initial.reminderDays });
  const [roles, setRoles] = useState<TemplateRole[]>(initial.roles);
  const [fields, setFields] = useState<PlacedField[]>(() => toPlaced(initial));
  const [people, setPeople] = useState<Record<string, Person>>({});
  const [csv, setCsv] = useState('name,email\n');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Mismo bulkId mientras no cambie el CSV: reintentar no duplica.
  const bulkIdRef = useRef<string | null>(null);
  const [bulkResult, setBulkResult] = useState<{ sent: number; errors: Array<{ row: number; error: string }> } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [docVersion, setDocVersion] = useState(0);

  const parties = useMemo(() => tp.roles.filter((r) => r.role !== 'cc').map((r) => ({ id: r.key, name: r.name })), [tp.roles]);
  const bulkTarget = tp.roles.find((r) => r.role === 'signer');

  const patch = async (body: Record<string, unknown>): Promise<boolean> => {
    setError('');
    const r = await api<{ template: TemplateDto }>(`/api/sign/templates/${tp.id}`, { method: 'PATCH', json: body });
    if (!r.ok) {
      setError(errorText(r.data.error));
      return false;
    }
    setTp(r.data.template);
    setRoles(r.data.template.roles);
    setFields(toPlaced(r.data.template));
    return true;
  };
  const saveSetup = async () => {
    setBusy(true);
    const ok = await patch({ ...meta, roles });
    setBusy(false);
    if (ok) {
      toast(t('templates.saved'));
      router.refresh();
    }
  };
  const saveFields = async () => {
    setBusy(true);
    const ok = await patch({ fields: fields.map((f) => ({ roleKey: f.partyId, kind: f.kind, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, required: f.required, label: f.label, options: f.options.filter((o) => o.trim()) })) });
    setBusy(false);
    if (ok) toast(t('templates.saved'));
  };
  const upload = async (file: File | null) => {
    if (!file) return;
    if (file.size > maxMb * 1024 * 1024) return toast(errorText('pdf_too_large'), 'bad');
    const fd = new FormData();
    fd.set('file', file);
    setBusy(true);
    const r = await api<{ template: TemplateDto }>(`/api/sign/templates/${tp.id}/document`, { method: 'POST', body: fd });
    setBusy(false);
    if (!r.ok) return toast(errorText(r.data.error), 'bad');
    setTp(r.data.template);
    setFields(toPlaced(r.data.template));
    setDocVersion((v) => v + 1);
  };
  const use = async (send: boolean) => {
    setBusy(true);
    setError('');
    const r = await api<{ id: string }>(`/api/sign/templates/${tp.id}/use`, { method: 'POST', json: { mode: 'use', title: title.trim() || undefined, recipients: people, send, locale } });
    setBusy(false);
    if (!r.ok) return setError(errorText(r.data.error));
    router.push(`/app/sign/envelopes/${r.data.id}`);
  };
  const bulk = async () => {
    setBusy(true);
    setError('');
    setBulkResult(null);
    const fixed = Object.fromEntries(Object.entries(people).filter(([k]) => k !== bulkTarget?.key));
    // En tandas de 25 filas con el mismo bulkId: cada fila tiene su clave, un reintento no duplica sobres.
    const lines = csv.replace(/\r/g, '').split('\n').filter((l) => l.trim());
    const [header, ...rows] = lines;
    if (!header || !rows.length) {
      setBusy(false);
      return setError(errorText('csv_empty'));
    }
    const bulkId = bulkIdRef.current ?? `blk_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
    bulkIdRef.current = bulkId;
    const total = { sent: 0, errors: [] as Array<{ row: number; error: string }> };
    for (let i = 0; i < rows.length; i += 25) {
      const chunk = [header, ...rows.slice(i, i + 25)].join('\n');
      const r = await api<{ sent: number; errors: Array<{ row: number; error: string }> }>(`/api/sign/templates/${tp.id}/use`, { method: 'POST', json: { mode: 'bulk', csv: chunk, fixed, locale, bulkId, offset: i } });
      if (!r.ok) {
        setBusy(false);
        setBulkResult(total);
        return setError(errorText(r.data.error));
      }
      total.sent += r.data.sent;
      total.errors.push(...r.data.errors);
      setBulkResult({ ...total, errors: [...total.errors] });
    }
    setBusy(false);
  };
  const remove = async () => {
    const r = await api(`/api/sign/templates/${tp.id}`, { method: 'DELETE' });
    if (!r.ok) return toast(errorText(r.data.error), 'bad');
    router.push('/app/sign/templates');
    router.refresh();
  };

  const personFields = (role: TemplateRole) => (
    <fieldset key={role.key} className="sg-fieldset">
      <legend className="label">
        {role.name} · {t(`role.${role.role}`)}
      </legend>
      <div className="ui-fields-2">
        <label className="ui-field">
          <span className="label">{t('editor.name')}</span>
          <input className="input" maxLength={120} value={people[role.key]?.name ?? ''} onChange={(e) => setPeople((p) => ({ ...p, [role.key]: { name: e.target.value, email: p[role.key]?.email ?? '' } }))} />
        </label>
        <label className="ui-field">
          <span className="label">{t('editor.email')}</span>
          <input className="input" type="email" maxLength={254} value={people[role.key]?.email ?? ''} onChange={(e) => setPeople((p) => ({ ...p, [role.key]: { name: p[role.key]?.name ?? '', email: e.target.value } }))} />
        </label>
      </div>
    </fieldset>
  );

  const tabs: Tab[] = tp.canEdit ? ['setup', 'fields', 'use', 'bulk'] : ['use', 'bulk'];
  return (
    <div className="app-page ui-page sg-page">
      {toasts}
      <PageHeader
        back={{ href: '/app/sign/templates', label: t('nav.templates') }}
        title={tp.name}
        description={tp.description || t('templates.desc')}
        actions={
          tp.canEdit ? (
            <button type="button" className="btn btn-ghost" onClick={() => setDeleteOpen(true)}>
              {t('templates.delete')}
            </button>
          ) : undefined
        }
      />
      <div className="ui-tabs" role="tablist" aria-label={tp.name}>
        {tabs.map((k) => (
          <button key={k} type="button" role="tab" className="ui-tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {t(`templates.tab.${k}`)}
          </button>
        ))}
      </div>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}

      {tab === 'setup' && (
        <div className="ui-fields sg-form">
          <label className="ui-field">
            <span className="label">{t('templates.colName')}</span>
            <input className="input" maxLength={160} value={meta.name} onChange={(e) => setMeta((m) => ({ ...m, name: e.target.value }))} />
          </label>
          <label className="ui-field">
            <span className="label">{t('templates.description')}</span>
            <input className="input" maxLength={500} value={meta.description} onChange={(e) => setMeta((m) => ({ ...m, description: e.target.value }))} />
          </label>
          <section className="sg-doc-bar" aria-label={t('editor.document')}>
            <span className="sg-rowtitle">{tp.documentName || t('editor.noDocument')}</span>
            <span className="sg-rowmeta num">{tp.pages.length ? t('editor.pages', { n: tp.pages.length }) : ''}</span>
            <label className="btn btn-sm btn-outline sg-file-btn">
              {tp.hasDocument ? t('editor.replace') : t('editor.upload')}
              <input type="file" accept="application/pdf,.pdf" className="sr-only" disabled={busy} onChange={(e) => void upload(e.target.files?.[0] ?? null)} />
            </label>
          </section>
          <fieldset className="sg-fieldset">
            <legend className="label">{t('templates.roles')}</legend>
            <ol className="sg-recipients">
              {roles.map((r, i) => (
                <li key={r.key} className="sg-recipient">
                  {meta.signingOrder === 'sequential' && (
                    <label className="ui-field sg-order">
                      <span className="label">{t('editor.orderShort')}</span>
                      <input className="input num" type="number" min={1} max={50} value={r.order} onChange={(e) => setRoles((xs) => xs.map((x) => (x.key === r.key ? { ...x, order: Number(e.target.value) || 1 } : x)))} />
                    </label>
                  )}
                  <label className="ui-field">
                    <span className="label">{t('templates.roleName')}</span>
                    <input className="input" maxLength={60} value={r.name} onChange={(e) => setRoles((xs) => xs.map((x) => (x.key === r.key ? { ...x, name: e.target.value } : x)))} />
                  </label>
                  <label className="ui-field">
                    <span className="label">{t('editor.role')}</span>
                    <select className="select" value={r.role} onChange={(e) => setRoles((xs) => xs.map((x) => (x.key === r.key ? { ...x, role: e.target.value as Role } : x)))}>
                      {(['signer', 'approver', 'cc'] as Role[]).map((x) => (
                        <option key={x} value={x}>
                          {t(`role.${x}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="button" className="btn btn-sm btn-ghost sg-remove" disabled={roles.length <= 1} onClick={() => setRoles((xs) => xs.filter((x) => x.key !== r.key))} aria-label={t('editor.removeRecipient', { name: r.name || String(i + 1) })}>
                    {t('editor.remove')}
                  </button>
                </li>
              ))}
            </ol>
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={() => setRoles((xs) => [...xs, { key: `r${Date.now().toString(36).slice(-5)}`, name: `${t('role.signer')} ${xs.length + 1}`, role: 'signer', order: xs.length + 1 }])}
            >
              {t('templates.addRole')}
            </button>
          </fieldset>
          <fieldset className="sg-fieldset">
            <legend className="label">{t('editor.order')}</legend>
            <label className="ui-check">
              <input type="radio" name="tpl-order" checked={meta.signingOrder === 'sequential'} onChange={() => setMeta((m) => ({ ...m, signingOrder: 'sequential' }))} />
              <span>{t('editor.sequential')}</span>
            </label>
            <label className="ui-check">
              <input type="radio" name="tpl-order" checked={meta.signingOrder === 'parallel'} onChange={() => setMeta((m) => ({ ...m, signingOrder: 'parallel' }))} />
              <span>{t('editor.parallel')}</span>
            </label>
          </fieldset>
          <label className="ui-field">
            <span className="label">{t('editor.message')}</span>
            <textarea className="textarea" rows={3} maxLength={4000} value={meta.message} onChange={(e) => setMeta((m) => ({ ...m, message: e.target.value }))} />
          </label>
          <div className="ui-fields-2">
            <label className="ui-field">
              <span className="label">{t('editor.expires')}</span>
              <input className="input num" type="number" min={1} max={365} value={meta.expiresDays} onChange={(e) => setMeta((m) => ({ ...m, expiresDays: Number(e.target.value) || 1 }))} />
            </label>
            <label className="ui-field">
              <span className="label">{t('editor.reminders')}</span>
              <input className="input num" type="number" min={0} max={30} value={meta.reminderDays} onChange={(e) => setMeta((m) => ({ ...m, reminderDays: Number(e.target.value) || 0 }))} />
            </label>
          </div>
          <label className="ui-check">
            <input type="checkbox" checked={meta.otpRequired} onChange={(e) => setMeta((m) => ({ ...m, otpRequired: e.target.checked }))} />
            <span>{t('editor.otp')}</span>
          </label>
          <div className="sg-row">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void saveSetup()}>
              {t('common.save')}
            </button>
          </div>
        </div>
      )}

      {tab === 'fields' &&
        (tp.hasDocument ? (
          <>
            <FieldPlacer src={`/api/sign/templates/${tp.id}/document?r=${docVersion}`} pages={tp.pages} parties={parties} fields={fields} onChange={setFields} />
            <div className="sg-row sg-sticky-actions">
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void saveFields()}>
                {t('common.save')}
              </button>
            </div>
          </>
        ) : (
          <p className="ui-help">{t('editor.uploadFirst')}</p>
        ))}

      {tab === 'use' &&
        (tp.hasDocument ? (
          <div className="ui-fields sg-form">
            <label className="ui-field">
              <span className="label">{t('new.envelopeTitle')}</span>
              <input className="input" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={tp.name} />
            </label>
            {tp.roles.map(personFields)}
            <div className="sg-row">
              <button type="button" className="btn btn-outline" disabled={busy} onClick={() => void use(false)}>
                {t('templates.useDraft')}
              </button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void use(true)}>
                {t('editor.send')}
              </button>
            </div>
          </div>
        ) : (
          <p className="ui-help">{t('editor.uploadFirst')}</p>
        ))}

      {tab === 'bulk' &&
        (tp.hasDocument && bulkTarget ? (
          <div className="ui-fields sg-form">
            <p className="ui-help">{t('templates.bulkHelp', { role: bulkTarget.name, max: 1000 })}</p>
            <label className="ui-field">
              <span className="label">{t('templates.csv')}</span>
              <textarea
                className="textarea sg-mono"
                rows={8}
                value={csv}
                onChange={(e) => {
                  bulkIdRef.current = null;
                  setCsv(e.target.value);
                }}
              />
            </label>
            <label className="ui-field">
              <span className="label">{t('templates.csvFile')}</span>
              <input className="input" type="file" accept=".csv,text/csv" onChange={async (e) => setCsv((await e.target.files?.[0]?.text()) ?? csv)} />
            </label>
            {tp.roles.filter((r) => r.key !== bulkTarget.key).map(personFields)}
            {bulkResult && (
              <div role="status" className="sg-summary">
                <p>{t('templates.bulkSent', { n: bulkResult.sent })}</p>
                {bulkResult.errors.length > 0 && (
                  <ul className="sg-plain-list">
                    {bulkResult.errors.map((x) => (
                      <li key={x.row}>{t('templates.bulkRowError', { row: x.row, error: errorText(x.error) })}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <div className="sg-row">
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void bulk()}>
                {busy ? t('common.working') : t('templates.bulkSend')}
              </button>
            </div>
          </div>
        ) : (
          <p className="ui-help">{t('templates.bulkUnavailable')}</p>
        ))}

      <SignDialog open={deleteOpen} title={t('templates.deleteTitle')} onClose={() => setDeleteOpen(false)}>
        <div className="ui-modal-body">
          <p>{t('templates.deleteBody')}</p>
        </div>
        <div className="ui-modal-foot">
          <button type="button" className="btn btn-ghost" onClick={() => setDeleteOpen(false)}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn-danger" onClick={() => void remove()} autoFocus>
            {t('templates.delete')}
          </button>
        </div>
      </SignDialog>
    </div>
  );
}
