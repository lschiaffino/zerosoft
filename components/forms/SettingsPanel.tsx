'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { FormDto } from '@/lib/forms/core';
import type { FormSettings } from '@/lib/forms/types';
import type { BuilderState } from './FormBuilder';
import { Field } from './BuildPanel';

interface Person {
  id: string;
  name: string;
  email: string;
  role: string;
}

function toLocalInput(iso: string): string {
  if (!iso || Number.isNaN(Date.parse(iso))) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Cierre, límites, anti-spam, parciales, avisos, retención, CRM, webhook, acceso, duplicar y borrar. */
export default function SettingsPanel({
  form,
  state,
  setSettings,
  update,
  canShare,
  crmApp,
}: {
  form: FormDto;
  state: BuilderState;
  setSettings: (p: Partial<FormSettings>) => void;
  update: <K extends keyof BuilderState>(k: K, v: BuilderState[K]) => void;
  canShare: boolean;
  crmApp: boolean;
}) {
  const t = useTranslations('forms.builder.settings');
  const router = useRouter();
  const s = state.settings;
  const def = state.definition;
  const [people, setPeople] = useState<Person[]>([]);
  const [emails, setEmails] = useState(s.notifyEmails.join(', '));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    fetch('/api/forms/people')
      .then((r) => r.json())
      .then((d: { people?: Person[] }) => {
        if (alive) setPeople(d.people ?? []);
      })
      .catch(() => null);
    return () => {
      alive = false;
    };
  }, []);

  const textQs = def.questions.filter((q) => ['short_text', 'email', 'phone', 'long_text'].includes(q.type));
  const qSelect = (key: 'email' | 'name' | 'phone' | 'company', types: string[]) => (
    <Field label={t(`crm.${key}`)} id={`fm-crm-${key}`}>
      <select id={`fm-crm-${key}`} className="select" value={s.crm[key]} onChange={(e) => setSettings({ crm: { ...s.crm, [key]: e.target.value } })}>
        <option value="">{t('crm.none')}</option>
        {textQs
          .filter((q) => types.includes(q.type))
          .map((q) => (
            <option key={q.id} value={q.id}>
              {q.title || q.ref}
            </option>
          ))}
      </select>
    </Field>
  );

  async function duplicate() {
    setBusy(true);
    const res = await fetch(`/api/forms/${form.id}/duplicate`, { method: 'POST' }).catch(() => null);
    const data = res ? ((await res.json().catch(() => null)) as { form?: { id: string } } | null) : null;
    setBusy(false);
    if (data?.form) router.push(`/app/forms/${data.form.id}`);
    else setError(t('error'));
  }

  async function remove() {
    setBusy(true);
    const res = await fetch(`/api/forms/${form.id}`, { method: 'DELETE' }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      router.push('/app/forms');
      router.refresh();
    } else setError(t('error'));
  }

  return (
    <div className="ui-fields fm-settings">
      <h2 className="fm-h2">{t('responses')}</h2>
      <div className="ui-fields-2">
        <Field label={t('closeAt')} id="fm-close-at" help={t('closeAtHelp')}>
          <input id="fm-close-at" className="input" type="datetime-local" value={toLocalInput(s.closeAt)} onChange={(e) => setSettings({ closeAt: e.target.value ? new Date(e.target.value).toISOString() : '' })} />
        </Field>
        <Field label={t('limit')} id="fm-limit" help={t('limitHelp', { n: form.responseCount })}>
          <input id="fm-limit" className="input" type="number" min={0} value={s.responseLimit || ''} placeholder="0" onChange={(e) => setSettings({ responseLimit: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
        </Field>
      </div>
      <Field label={t('closedMessage')} id="fm-closed-msg">
        <input id="fm-closed-msg" className="input" value={s.closedMessage} maxLength={500} onChange={(e) => setSettings({ closedMessage: e.target.value })} placeholder={t('closedMessagePh')} />
      </Field>
      <Field label={t('perIp')} id="fm-per-ip" help={t('perIpHelp')}>
        <input id="fm-per-ip" className="input" type="number" min={0} value={s.perIpLimit || ''} placeholder="0" onChange={(e) => setSettings({ perIpLimit: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
      </Field>
      <label className="ui-check">
        <input type="checkbox" checked={s.resume} onChange={(e) => setSettings({ resume: e.target.checked })} />
        <span>{t('resume')}</span>
      </label>
      <label className="ui-check">
        <input type="checkbox" checked={s.partials} onChange={(e) => setSettings({ partials: e.target.checked })} />
        <span>{t('partials')}</span>
      </label>
      <p className="ui-help">{t('spamHelp')}</p>

      <h2 className="fm-h2">{t('notifications')}</h2>
      <fieldset className="fm-people">
        <legend className="label">{t('notifyPeople')}</legend>
        {people.map((p) => (
          <label key={p.id} className="ui-check">
            <input type="checkbox" checked={s.notifyPeople.includes(p.id)} onChange={(e) => setSettings({ notifyPeople: e.target.checked ? [...s.notifyPeople, p.id] : s.notifyPeople.filter((x) => x !== p.id) })} />
            <span>
              {p.name} <span className="fm-dim">{p.email}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <Field label={t('notifyEmails')} id="fm-emails" help={t('notifyEmailsHelp')}>
        <input
          id="fm-emails"
          className="input"
          value={emails}
          onChange={(e) => {
            setEmails(e.target.value);
            setSettings({ notifyEmails: e.target.value.split(/[,\s]+/).map((x) => x.trim()).filter((x) => /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(x)).slice(0, 10) });
          }}
        />
      </Field>

      <h2 className="fm-h2">{t('privacy')}</h2>
      <Field label={t('retention')} id="fm-retention" help={t('retentionHelp')}>
        <select id="fm-retention" className="select" value={s.retentionDays} onChange={(e) => setSettings({ retentionDays: Number(e.target.value) })}>
          {[0, 30, 90, 180, 365, 730].map((d) => (
            <option key={d} value={d}>
              {d === 0 ? t('retentionForever') : t('retentionDays', { n: d })}
            </option>
          ))}
        </select>
      </Field>
      <fieldset className="fm-radio-row">
        <legend className="label">{t('access')}</legend>
        {(['workspace', 'people'] as const).map((v) => (
          <label key={v} className="ui-check">
            <input type="radio" name="fm-sharing" checked={state.sharing === v} disabled={!canShare} onChange={() => update('sharing', v)} />
            <span>{t(`sharing.${v}`)}</span>
          </label>
        ))}
        {!canShare && <p className="ui-help">{t('accessOwnerOnly')}</p>}
      </fieldset>
      {state.sharing === 'people' && (
        <fieldset className="fm-people">
          <legend className="label">{t('accessPeople')}</legend>
          {people
            .filter((p) => p.role !== 'owner' && p.role !== 'admin' && p.id !== form.createdBy)
            .map((p) => (
              <label key={p.id} className="ui-check">
                <input type="checkbox" disabled={!canShare} checked={state.members.includes(p.id)} onChange={(e) => update('members', e.target.checked ? [...state.members, p.id] : state.members.filter((x) => x !== p.id))} />
                <span>
                  {p.name} <span className="fm-dim">{p.email}</span>
                </span>
              </label>
            ))}
          <p className="ui-help">{t('accessHelp')}</p>
        </fieldset>
      )}

      <h2 className="fm-h2">{t('integrations')}</h2>
      <label className="ui-check">
        <input type="checkbox" checked={s.crm.enabled} disabled={!crmApp && !s.crm.enabled} onChange={(e) => setSettings({ crm: { ...s.crm, enabled: e.target.checked } })} />
        <span>{t('crm.on')}</span>
      </label>
      {!crmApp && <p className="ui-help">{t('crm.noApp')}</p>}
      {s.crm.enabled && (
        <>
          <p className="ui-help">{t('crm.help')}</p>
          <div className="ui-fields-2">
            {qSelect('email', ['email', 'short_text'])}
            {qSelect('name', ['short_text'])}
            {qSelect('phone', ['phone', 'short_text'])}
            {qSelect('company', ['short_text'])}
          </div>
        </>
      )}
      <Field label={t('webhook')} id="fm-webhook" help={t('webhookHelp')}>
        <input id="fm-webhook" className="input" type="url" placeholder="https://" value={s.webhookUrl} maxLength={2000} onChange={(e) => setSettings({ webhookUrl: e.target.value.trim() })} />
      </Field>
      {form.webhookSecret && s.webhookUrl && (
        <p className="ui-help">
          {t('webhookSecret')} <code className="fm-code-inline">{form.webhookSecret}</code>
        </p>
      )}
      <p className="ui-help">{t('flowHelp')}</p>

      <h2 className="fm-h2">{t('danger')}</h2>
      <div className="fm-row">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void duplicate()} disabled={busy}>
          {t('duplicate')}
        </button>
        {form.canDelete && (
          <button type="button" className="btn btn-danger btn-sm" onClick={() => setConfirmDelete(true)} disabled={busy}>
            {t('delete')}
          </button>
        )}
      </div>
      {error && (
        <p className="fm-error" role="alert">
          {error}
        </p>
      )}
      <ConfirmDialog
        open={confirmDelete}
        title={t('deleteTitle', { name: form.name })}
        body={t('deleteBody', { n: form.responseCount })}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        danger
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
