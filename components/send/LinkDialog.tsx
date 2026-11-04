'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import type { LinkDto } from '@/lib/send/core';
import { cleanAccessList, entriesFromCsv, MAX_ACCESS_CSV_BYTES, MAX_ACCESS_ENTRIES } from '@/lib/send/access-list';
import { api, SendDialog, useErrorText } from './ui';

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Crear o editar un link, con todas sus reglas. */
export default function LinkDialog({
  open,
  link,
  createUrl,
  templates,
  onClose,
  onSaved,
}: {
  open: boolean;
  link: LinkDto | null;
  createUrl: string;
  templates: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSaved: (link: LinkDto, created: boolean) => void;
}) {
  const t = useTranslations('send.link');
  return (
    <SendDialog open={open} title={link ? t('editTitle') : t('newTitle')} onClose={onClose}>
      {open && <LinkForm key={link?.id ?? 'new'} link={link} createUrl={createUrl} templates={templates} onClose={onClose} onSaved={onSaved} />}
    </SendDialog>
  );
}

function LinkForm({ link, createUrl, templates, onClose, onSaved }: { link: LinkDto | null; createUrl: string; templates: Array<{ id: string; name: string }>; onClose: () => void; onSaved: (link: LinkDto, created: boolean) => void }) {
  const t = useTranslations('send.link');
  const tc = useTranslations('send.common');
  const errorText = useErrorText();
  const [name, setName] = useState(link?.name ?? '');
  const [recipient, setRecipient] = useState(link?.recipientEmail ?? '');
  const [requireEmail, setRequireEmail] = useState(link?.requireEmail ?? false);
  const [verifyEmail, setVerifyEmail] = useState(link?.verifyEmail ?? false);
  const [usePasscode, setUsePasscode] = useState(link?.hasPasscode ?? false);
  const [passcode, setPasscode] = useState('');
  const [hasExpiry, setHasExpiry] = useState(!!link?.expiresAt);
  const [expiresAt, setExpiresAt] = useState(toLocalInput(link?.expiresAt ?? null));
  const [allowDownload, setAllowDownload] = useState(link?.allowDownload ?? false);
  const [accessMode, setAccessMode] = useState(link?.accessMode ?? 'none');
  const [accessText, setAccessText] = useState((link?.accessList ?? []).join('\n'));
  const [watermark, setWatermark] = useState(link?.watermark ?? false);
  const [nda, setNda] = useState(link?.ndaTemplateId ?? '');
  const [message, setMessage] = useState(link?.message ?? '');
  const [notify, setNotify] = useState(link?.notify ?? true);
  const [useBranding, setUseBranding] = useState(link?.useBranding ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [csvNote, setCsvNote] = useState('');

  // Emails y dominios de cualquier celda del CSV, sumados a lo que ya está en la lista.
  const importCsv = async (file: File | undefined) => {
    setCsvNote('');
    if (!file) return;
    if (file.size > MAX_ACCESS_CSV_BYTES) return setCsvNote(errorText('csv_too_large'));
    const { entries, skipped } = entriesFromCsv(await file.text());
    const before = cleanAccessList([accessText]).entries;
    const merged = [...new Set([...before, ...entries])];
    setAccessText(merged.join('\n'));
    const added = merged.length - before.length;
    setCsvNote(
      [t('csvAdded', { count: added }), skipped ? t('csvSkipped', { count: skipped }) : '', merged.length > MAX_ACCESS_ENTRIES ? t('csvTooMany', { max: MAX_ACCESS_ENTRIES }) : ''].filter(Boolean).join(' '),
    );
  };
  const accessCount = cleanAccessList([accessText]).entries.length;

  // Lo que estas reglas piden aunque no se tilde: se muestra y queda tildado.
  const emailForced = watermark || !!nda || accessMode !== 'none' || verifyEmail;
  const verifyForced = accessMode === 'allow' || !!nda;
  const emailOn = requireEmail || emailForced;
  const verifyOn = verifyEmail || verifyForced;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (usePasscode && !link?.hasPasscode && passcode.trim().length < 6) return setError(errorText('invalid_passcode'));
    if (hasExpiry && !expiresAt) return setError(errorText('invalid_expiry'));
    setBusy(true);
    const body = {
      name: name.trim(),
      recipientEmail: recipient.trim() || null,
      requireEmail: emailOn,
      verifyEmail: verifyOn,
      ...(usePasscode ? (passcode.trim() ? { passcode: passcode.trim() } : {}) : { passcode: null }),
      expiresAt: hasExpiry && expiresAt ? new Date(expiresAt).toISOString() : null,
      allowDownload,
      accessMode,
      accessList: accessMode === 'none' ? [] : accessText.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean),
      watermark,
      ndaTemplateId: nda || null,
      message,
      notify,
      useBranding,
    };
    const r = link ? await api<{ link: LinkDto }>(`/api/send/links/${link.id}`, { method: 'PATCH', json: body }) : await api<{ link: LinkDto }>(createUrl, { method: 'POST', json: body });
    setBusy(false);
    if (!r.ok) return setError(errorText(r.data.error));
    onSaved(r.data.link, !link);
  };

  return (
    <form onSubmit={submit} className="sd-link-form">
      <div className="ui-modal-body sd-link-body">
        <div className="sd-field">
          <label htmlFor="sl-name">{t('name')}</label>
          <input id="sl-name" className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder={t('namePlaceholder')} data-testid="link-name" autoFocus />
          <p className="sd-help">{t('nameHelp')}</p>
        </div>
        <div className="sd-field">
          <label htmlFor="sl-recipient">{t('recipient')}</label>
          <input id="sl-recipient" className="input" type="email" value={recipient} maxLength={254} onChange={(e) => setRecipient(e.target.value)} placeholder="ana@acme.com" data-testid="link-recipient" />
          <p className="sd-help">{t('recipientHelp')}</p>
        </div>

        <fieldset className="sd-fieldset">
          <legend>{t('accessTitle')}</legend>
          <label className="sd-check">
            <input type="checkbox" checked={emailOn} disabled={emailForced} onChange={(e) => setRequireEmail(e.target.checked)} data-testid="link-require-email" />
            <span>
              {t('requireEmail')}
              <small>{emailForced ? t('requireEmailForced') : t('requireEmailHelp')}</small>
            </span>
          </label>
          <label className="sd-check">
            <input type="checkbox" checked={verifyOn} disabled={verifyForced} onChange={(e) => setVerifyEmail(e.target.checked)} data-testid="link-verify" />
            <span>
              {t('verifyEmail')}
              <small>{verifyForced ? (nda ? t('verifyForcedNda') : t('verifyForced')) : t('verifyHelp')}</small>
            </span>
          </label>
          <label className="sd-check">
            <input type="checkbox" checked={usePasscode} onChange={(e) => setUsePasscode(e.target.checked)} data-testid="link-use-passcode" />
            <span>{t('passcode')}</span>
          </label>
          {usePasscode && (
            <div className="sd-sub">
              <input className="input" type="text" autoComplete="off" value={passcode} maxLength={100} onChange={(e) => setPasscode(e.target.value)} placeholder={link?.hasPasscode ? t('passcodeKeep') : t('passcodeNew')} aria-label={t('passcode')} data-testid="link-passcode" />
            </div>
          )}
          <label className="sd-check">
            <input type="checkbox" checked={hasExpiry} onChange={(e) => setHasExpiry(e.target.checked)} data-testid="link-use-expiry" />
            <span>{t('expiry')}</span>
          </label>
          {hasExpiry && (
            <div className="sd-sub">
              <input className="input" type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} aria-label={t('expiry')} data-testid="link-expiry" />
            </div>
          )}
          <div className="sd-field">
            <label htmlFor="sl-mode">{t('accessList')}</label>
            <select id="sl-mode" className="input" value={accessMode} onChange={(e) => setAccessMode(e.target.value as typeof accessMode)} data-testid="link-access-mode">
              <option value="none">{t('accessNone')}</option>
              <option value="allow">{t('accessAllow')}</option>
              <option value="block">{t('accessBlock')}</option>
            </select>
          </div>
          {accessMode !== 'none' && (
            <div className="sd-sub">
              <textarea className="input" rows={3} value={accessText} onChange={(e) => setAccessText(e.target.value)} placeholder={'ana@acme.com\nacme.com'} aria-label={t('accessList')} data-testid="link-access-list" />
              <div className="sd-csv">
                <label className="btn btn-secondary btn-sm">
                  {t('csvImport')}
                  <input
                    className="sr-only"
                    type="file"
                    accept=".csv,.txt,text/csv,text/plain"
                    data-testid="link-access-csv"
                    onChange={(e) => {
                      void importCsv(e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                </label>
                <span className="sd-rowmeta num" data-testid="link-access-count">
                  {t('accessCount', { count: accessCount, max: MAX_ACCESS_ENTRIES })}
                </span>
              </div>
              {csvNote && (
                <p className="sd-help" role="status" data-testid="link-access-csv-note">
                  {csvNote}
                </p>
              )}
              <p className="sd-help">{accessMode === 'allow' ? t('accessAllowHelp') : t('accessBlockHelp')}</p>
            </div>
          )}
        </fieldset>

        <fieldset className="sd-fieldset">
          <legend>{t('protectTitle')}</legend>
          <label className="sd-check">
            <input type="checkbox" checked={allowDownload} onChange={(e) => setAllowDownload(e.target.checked)} data-testid="link-download" />
            <span>
              {t('download')}
              <small>{allowDownload ? t('downloadOn') : t('downloadOff')}</small>
            </span>
          </label>
          <label className="sd-check">
            <input type="checkbox" checked={watermark} onChange={(e) => setWatermark(e.target.checked)} data-testid="link-watermark" />
            <span>
              {t('watermark')}
              <small>{t('watermarkHelp')}</small>
            </span>
          </label>
          {templates.length > 0 ? (
            <div className="sd-field">
              <label htmlFor="sl-nda">{t('nda')}</label>
              <select id="sl-nda" className="input" value={nda} onChange={(e) => setNda(e.target.value)} data-testid="link-nda">
                <option value="">{t('ndaNone')}</option>
                {templates.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
              <p className="sd-help">{t('ndaHelp')}</p>
            </div>
          ) : (
            <p className="sd-help">{t('ndaEmpty')}</p>
          )}
        </fieldset>

        <fieldset className="sd-fieldset">
          <legend>{t('moreTitle')}</legend>
          <div className="sd-field">
            <label htmlFor="sl-message">{t('message')}</label>
            <textarea id="sl-message" className="input" rows={2} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} />
          </div>
          <label className="sd-check">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} data-testid="link-notify" />
            <span>{t('notify')}</span>
          </label>
          <label className="sd-check">
            <input type="checkbox" checked={useBranding} onChange={(e) => setUseBranding(e.target.checked)} />
            <span>{t('branding')}</span>
          </label>
        </fieldset>
        {error && (
          <p className="sd-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="ui-modal-foot">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          {tc('cancel')}
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy} data-testid="link-save">
          {link ? tc('save') : t('create')}
        </button>
      </div>
    </form>
  );
}
