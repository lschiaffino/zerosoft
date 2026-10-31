'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import TitleInput from '@/components/ui/TitleInput';
import type { EnvelopeDto } from '@/lib/sign/core';
import FieldPlacer, { newKey, type PlacedField } from './FieldPlacer';
import { api, SignDialog, useErrorText, useToast } from './ui';

type Step = 'recipients' | 'fields' | 'send';
type Role = 'signer' | 'approver' | 'cc';
interface RecipientDraft {
  key: string;
  id?: string;
  role: Role;
  name: string;
  email: string;
  routingOrder: number;
}

const toPlaced = (e: EnvelopeDto): PlacedField[] =>
  e.fields.map((f) => ({ key: f.id, partyId: f.recipientId, kind: f.kind, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, required: f.required, label: f.label, options: f.options }));

/** Borrador: documento, destinatarios en orden, campos por destinatario, mensaje y ajustes, y enviar. */
export default function EnvelopeEditor({ initial, maxMb }: { initial: EnvelopeDto; maxMb: number }) {
  const t = useTranslations('sign');
  const locale = useLocale();
  const router = useRouter();
  const errorText = useErrorText();
  const [toasts, toast] = useToast();
  const [env, setEnv] = useState(initial);
  const [step, setStep] = useState<Step>(initial.recipients.length ? (initial.fields.length ? 'send' : 'fields') : 'recipients');
  const [title, setTitle] = useState(initial.title);
  const [recipients, setRecipients] = useState<RecipientDraft[]>(() =>
    initial.recipients.map((r) => ({ key: r.id, id: r.id, role: r.role, name: r.name, email: r.email, routingOrder: r.routingOrder })),
  );
  const [fields, setFields] = useState<PlacedField[]>(() => toPlaced(initial));
  const [settings, setSettings] = useState({ message: initial.message, expiresDays: initial.expiresDays, reminderDays: initial.reminderDays, otpRequired: initial.otpRequired, signingOrder: initial.signingOrder });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [docVersion, setDocVersion] = useState(0);

  const parties = useMemo(() => env.recipients.filter((r) => r.role !== 'cc').map((r) => ({ id: r.id, name: r.name })), [env.recipients]);
  const docSrc = `/api/sign/envelopes/${env.id}/document?v=original&r=${docVersion}`;

  const saveTitle = async () => {
    if (title.trim() === env.title || !title.trim()) return;
    const r = await api<{ envelope: EnvelopeDto }>(`/api/sign/envelopes/${env.id}`, { method: 'PATCH', json: { title: title.trim() } });
    if (r.ok) {
      setEnv(r.data.envelope);
      router.refresh();
    } else toast(errorText(r.data.error), 'bad');
  };

  const replaceDocument = async (file: File | null) => {
    if (!file) return;
    if (file.size > maxMb * 1024 * 1024) return toast(errorText('pdf_too_large'), 'bad');
    const fd = new FormData();
    fd.set('file', file);
    setBusy(true);
    const r = await api<{ envelope: EnvelopeDto }>(`/api/sign/envelopes/${env.id}/document`, { method: 'POST', body: fd });
    setBusy(false);
    if (!r.ok) return toast(errorText(r.data.error), 'bad');
    setEnv(r.data.envelope);
    setFields(toPlaced(r.data.envelope));
    setDocVersion((v) => v + 1);
    toast(t('editor.documentReplaced'));
  };

  const saveRecipients = async (): Promise<boolean> => {
    setError('');
    const order = settings.signingOrder;
    if (order !== env.signingOrder) {
      const p = await api(`/api/sign/envelopes/${env.id}`, { method: 'PATCH', json: { signingOrder: order } });
      if (!p.ok) {
        setError(errorText(p.data.error));
        return false;
      }
    }
    const r = await api<{ envelope: EnvelopeDto }>(`/api/sign/envelopes/${env.id}/recipients`, {
      method: 'PUT',
      json: { recipients: recipients.map((x) => ({ id: x.id, role: x.role, name: x.name, email: x.email, routingOrder: order === 'parallel' ? 1 : x.routingOrder })) },
    });
    if (!r.ok) {
      setError(errorText(r.data.error));
      return false;
    }
    setEnv(r.data.envelope);
    setRecipients(r.data.envelope.recipients.map((x) => ({ key: x.id, id: x.id, role: x.role, name: x.name, email: x.email, routingOrder: x.routingOrder })));
    setFields(toPlaced(r.data.envelope));
    return true;
  };

  const saveFields = async (): Promise<boolean> => {
    setError('');
    const r = await api<{ envelope: EnvelopeDto }>(`/api/sign/envelopes/${env.id}/fields`, {
      method: 'PUT',
      json: { fields: fields.map((f) => ({ recipientId: f.partyId, kind: f.kind, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, required: f.required, label: f.label, options: f.options.filter((o) => o.trim()) })) },
    });
    if (!r.ok) {
      setError(errorText(r.data.error));
      return false;
    }
    setEnv(r.data.envelope);
    setFields(toPlaced(r.data.envelope));
    return true;
  };

  const saveSettings = async (): Promise<boolean> => {
    const r = await api<{ envelope: EnvelopeDto }>(`/api/sign/envelopes/${env.id}`, {
      method: 'PATCH',
      json: { message: settings.message, expiresDays: settings.expiresDays, reminderDays: settings.reminderDays, otpRequired: settings.otpRequired },
    });
    if (!r.ok) {
      setError(errorText(r.data.error));
      return false;
    }
    setEnv(r.data.envelope);
    return true;
  };

  const goTo = async (next: Step) => {
    setBusy(true);
    try {
      if (step === 'recipients' && !(await saveRecipients())) return;
      if (step === 'fields' && !(await saveFields())) return;
      if (step === 'send' && !(await saveSettings())) return;
      setStep(next);
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    setBusy(true);
    setProblems([]);
    try {
      if (!(await saveSettings())) return;
      const r = await api<{ envelope: EnvelopeDto; problems?: string[] }>(`/api/sign/envelopes/${env.id}/actions`, { method: 'POST', json: { action: 'send' } });
      if (!r.ok) {
        if (r.data.problems) setProblems(r.data.problems);
        setError(errorText(r.data.error));
        return;
      }
      toast(t('editor.sent'));
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const r = await api(`/api/sign/envelopes/${env.id}`, { method: 'DELETE' });
    if (!r.ok) return toast(errorText(r.data.error), 'bad');
    router.push('/app/sign');
    router.refresh();
  };

  const problemText = (p: string) => {
    const [code, rid] = p.split(':');
    const who = env.recipients.find((r) => r.id === rid)?.name ?? '';
    return t.has(`problems.${code}`) ? t(`problems.${code}`, { name: who }) : code;
  };

  return (
    <div className="app-page ui-page sg-page">
      {toasts}
      <PageHeader
        back={{ href: '/app/sign', label: t('nav.envelopes') }}
        title={
          <TitleInput
            className="sg-title-input"
            aria-label={t('editor.titleLabel')}
            value={title}
            maxLength={200}
            onValueChange={setTitle}
            onBlur={saveTitle}
          />
        }
        description={t('editor.draftDesc')}
        actions={
          <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(true)}>
            {t('editor.deleteDraft')}
          </button>
        }
      />

      <section className="sg-doc-bar" aria-label={t('editor.document')}>
        <span className="sg-rowtitle">{env.documentName || t('editor.noDocument')}</span>
        <span className="sg-rowmeta num">{env.pages.length ? t('editor.pages', { n: env.pages.length }) : ''}</span>
        <label className="btn btn-sm btn-outline sg-file-btn">
          {env.hasDocument ? t('editor.replace') : t('editor.upload')}
          <input type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(e) => void replaceDocument(e.target.files?.[0] ?? null)} disabled={busy} />
        </label>
      </section>

      <div className="ui-tabs" role="tablist" aria-label={t('editor.steps')}>
        {(['recipients', 'fields', 'send'] as Step[]).map((s, i) => (
          <button key={s} type="button" role="tab" className="ui-tab" aria-selected={step === s} disabled={busy} onClick={() => step !== s && void goTo(s)}>
            {i + 1}. {t(`editor.step.${s}`)}
          </button>
        ))}
      </div>

      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}

      {step === 'recipients' && (
        <div className="ui-fields sg-form">
          <fieldset className="sg-fieldset">
            <legend className="label">{t('editor.order')}</legend>
            <label className="ui-check">
              <input type="radio" name="order" checked={settings.signingOrder === 'sequential'} onChange={() => setSettings((s) => ({ ...s, signingOrder: 'sequential' }))} />
              <span>{t('editor.sequential')}</span>
            </label>
            <label className="ui-check">
              <input type="radio" name="order" checked={settings.signingOrder === 'parallel'} onChange={() => setSettings((s) => ({ ...s, signingOrder: 'parallel' }))} />
              <span>{t('editor.parallel')}</span>
            </label>
          </fieldset>
          <ol className="sg-recipients">
            {recipients.map((r, i) => (
              <li key={r.key} className="sg-recipient">
                {settings.signingOrder === 'sequential' && (
                  <label className="ui-field sg-order">
                    <span className="label">{t('editor.orderShort')}</span>
                    <input className="input num" type="number" min={1} max={50} value={r.routingOrder} onChange={(e) => setRecipients((xs) => xs.map((x) => (x.key === r.key ? { ...x, routingOrder: Number(e.target.value) || 1 } : x)))} />
                  </label>
                )}
                <label className="ui-field">
                  <span className="label">{t('editor.name')}</span>
                  <input className="input" name={`name-${i}`} maxLength={120} value={r.name} onChange={(e) => setRecipients((xs) => xs.map((x) => (x.key === r.key ? { ...x, name: e.target.value } : x)))} />
                </label>
                <label className="ui-field">
                  <span className="label">{t('editor.email')}</span>
                  <input className="input" type="email" name={`email-${i}`} maxLength={254} value={r.email} onChange={(e) => setRecipients((xs) => xs.map((x) => (x.key === r.key ? { ...x, email: e.target.value } : x)))} />
                </label>
                <label className="ui-field">
                  <span className="label">{t('editor.role')}</span>
                  <select className="select" value={r.role} onChange={(e) => setRecipients((xs) => xs.map((x) => (x.key === r.key ? { ...x, role: e.target.value as Role } : x)))}>
                    {(['signer', 'approver', 'cc'] as Role[]).map((x) => (
                      <option key={x} value={x}>
                        {t(`role.${x}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" className="btn btn-sm btn-ghost sg-remove" aria-label={t('editor.removeRecipient', { name: r.name || String(i + 1) })} onClick={() => setRecipients((xs) => xs.filter((x) => x.key !== r.key))}>
                  {t('editor.remove')}
                </button>
              </li>
            ))}
          </ol>
          <div className="sg-row">
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => setRecipients((xs) => [...xs, { key: newKey(), role: 'signer', name: '', email: '', routingOrder: xs.length ? Math.max(...xs.map((x) => x.routingOrder)) + 1 : 1 }])}
            >
              {t('editor.addRecipient')}
            </button>
            <button type="button" className="btn btn-primary" disabled={busy || !recipients.length} onClick={() => void goTo('fields')}>
              {t('editor.next')}
            </button>
          </div>
          <p className="ui-help">{t('editor.rolesHelp')}</p>
        </div>
      )}

      {step === 'fields' &&
        (env.hasDocument ? (
          <>
            <FieldPlacer src={docSrc} pages={env.pages} parties={parties} fields={fields} onChange={setFields} />
            <div className="sg-row sg-sticky-actions">
              <button type="button" className="btn btn-outline" disabled={busy} onClick={() => void goTo('recipients')}>
                {t('editor.back')}
              </button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void goTo('send')}>
                {t('editor.next')}
              </button>
            </div>
          </>
        ) : (
          <p className="ui-help">{t('editor.uploadFirst')}</p>
        ))}

      {step === 'send' && (
        <div className="ui-fields sg-form">
          <label className="ui-field">
            <span className="label">{t('editor.message')}</span>
            <textarea className="textarea" rows={4} maxLength={4000} value={settings.message} onChange={(e) => setSettings((s) => ({ ...s, message: e.target.value }))} placeholder={t('editor.messagePlaceholder')} />
          </label>
          <div className="ui-fields-2">
            <label className="ui-field">
              <span className="label">{t('editor.expires')}</span>
              <input className="input num" type="number" min={1} max={365} value={settings.expiresDays} onChange={(e) => setSettings((s) => ({ ...s, expiresDays: Number(e.target.value) || 1 }))} />
            </label>
            <label className="ui-field">
              <span className="label">{t('editor.reminders')}</span>
              <input className="input num" type="number" min={0} max={30} value={settings.reminderDays} onChange={(e) => setSettings((s) => ({ ...s, reminderDays: Number(e.target.value) || 0 }))} />
              <span className="ui-help">{t('editor.remindersHint')}</span>
            </label>
          </div>
          <label className="ui-check">
            <input type="checkbox" checked={settings.otpRequired} onChange={(e) => setSettings((s) => ({ ...s, otpRequired: e.target.checked }))} />
            <span>{t('editor.otp')}</span>
          </label>
          <section className="sg-summary" aria-label={t('editor.summary')}>
            <h3 className="sg-side-title">{t('editor.summary')}</h3>
            <ol className="sg-summary-list">
              {env.recipients.map((r) => (
                <li key={r.id}>
                  <span className="num">{env.signingOrder === 'sequential' ? `${r.routingOrder}. ` : ''}</span>
                  {r.name} &lt;{r.email}&gt; · {t(`role.${r.role}`)} · {t('editor.fieldCount', { n: env.fields.filter((f) => f.recipientId === r.id).length })}
                </li>
              ))}
            </ol>
            <p className="ui-help">{t('editor.immutable')}</p>
            <p className="ui-help">{t('legal.short')}</p>
          </section>
          {problems.length > 0 && (
            <ul className="ui-error sg-problems" role="alert">
              {problems.map((p) => (
                <li key={p}>{problemText(p)}</li>
              ))}
            </ul>
          )}
          <div className="sg-row">
            <button type="button" className="btn btn-outline" disabled={busy} onClick={() => void goTo('fields')}>
              {t('editor.back')}
            </button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void send()} data-locale={locale}>
              {busy ? t('common.working') : t('editor.send')}
            </button>
          </div>
        </div>
      )}

      <SignDialog open={confirmDelete} title={t('editor.deleteTitle')} onClose={() => setConfirmDelete(false)}>
        <div className="ui-modal-body">
          <p>{t('editor.deleteBody')}</p>
        </div>
        <div className="ui-modal-foot">
          <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn-danger" onClick={() => void remove()} autoFocus>
            {t('editor.deleteDraft')}
          </button>
        </div>
      </SignDialog>
    </div>
  );
}
