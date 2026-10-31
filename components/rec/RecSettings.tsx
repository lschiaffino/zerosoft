'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { RecContentOwner, RecSettingsDto } from '@/lib/rec-admin';
import { REC_RETENTION_GRACE_DAYS, REC_RETENTION_OPTIONS } from '@/lib/rec-schema';
import { parseDbUtc } from '@/lib/utils';

interface Data {
  settings: RecSettingsDto;
  admin: boolean;
  owners?: RecContentOwner[];
  people?: Array<{ id: string; name: string; email: string }>;
}

/**
 * Ajustes de Rec: privacidad y descargas por defecto de los videos nuevos, marca
 * en la página compartida, retención y traspaso de contenido. Los cambia un admin;
 * el resto los ve.
 */
export default function RecSettings() {
  const t = useTranslations('rec.settings');
  const tc = useTranslations('rec.common');
  const locale = useLocale();
  const [data, setData] = useState<Data | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [privacy, setPrivacy] = useState<'link' | 'workspace'>('link');
  const [download, setDownload] = useState(true);
  const [brandName, setBrandName] = useState('');
  const [brandColor, setBrandColor] = useState('');
  const [retention, setRetention] = useState('');
  const [preview, setPreview] = useState<{ days: number; count: number } | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const logoRef = useRef<HTMLInputElement>(null);

  const adopt = (s: RecSettingsDto) => {
    setPrivacy(s.defaultPrivacy);
    setDownload(s.defaultAllowDownload);
    setBrandName(s.brandName);
    setBrandColor(s.brandColor ?? '');
    setRetention(s.retentionDays === null ? '' : String(s.retentionDays));
  };

  async function load() {
    const res = await fetch('/api/rec/settings').catch(() => null);
    if (!res?.ok) {
      setLoadFailed(true);
      return;
    }
    const d = (await res.json()) as Data;
    setData(d);
    adopt(d.settings);
  }

  useEffect(() => {
    void load();
    // Solo al abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const fail = async (res: Response | null) => {
    const code = ((await res?.json().catch(() => null)) as { error?: string } | null)?.error ?? 'generic';
    setError(tc.has(`errors.${code}`) ? tc(`errors.${code}`) : tc('errors.generic'));
  };

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/rec/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return fail(res);
    const { settings } = (await res.json()) as { settings: RecSettingsDto };
    setData((d) => (d ? { ...d, settings } : d));
    // Solo lo que se guardó: guardar una sección no pisa lo que se está escribiendo en otra.
    if ('brandName' in body) setBrandName(settings.brandName);
    if ('brandColor' in body) setBrandColor(settings.brandColor ?? '');
    if ('retentionDays' in body) setRetention(settings.retentionDays === null ? '' : String(settings.retentionDays));
    setToast(t('saved'));
  }

  async function uploadLogo(file: File | undefined) {
    if (logoRef.current) logoRef.current.value = '';
    if (!file) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set('file', file);
    const res = await fetch('/api/rec/settings/logo', { method: 'POST', body: form }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return fail(res);
    const { settings } = (await res.json()) as { settings: RecSettingsDto };
    setData((d) => (d ? { ...d, settings } : d));
    setToast(t('saved'));
  }

  async function removeLogo() {
    setBusy(true);
    const res = await fetch('/api/rec/settings/logo', { method: 'DELETE' }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return fail(res);
    const { settings } = (await res.json()) as { settings: RecSettingsDto };
    setData((d) => (d ? { ...d, settings } : d));
  }

  /** Prender o acortar la retención se confirma, con cuántos videos entran hoy. */
  async function saveRetention() {
    const days = retention ? Number(retention) : null;
    if (days === null) return patch({ retentionDays: null });
    const cur = data?.settings.retentionDays ?? null;
    if (cur !== null && days >= cur) return patch({ retentionDays: days });
    setBusy(true);
    const res = await fetch(`/api/rec/settings?previewDays=${days}`).catch(() => null);
    setBusy(false);
    if (!res?.ok) return fail(res);
    const d = (await res.json()) as { preview: number };
    setPreview({ days, count: d.preview });
  }

  async function transfer() {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/rec/settings/transfer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from, to }) }).catch(() => null);
    setBusy(false);
    setTransferring(false);
    if (!res?.ok) return fail(res);
    const d = (await res.json()) as { videos: number; folders: number };
    setToast(t('transferDone', { videos: d.videos, folders: d.folders }));
    setFrom('');
    setTo('');
    void load();
  }

  if (loadFailed) {
    return (
      <p className="ui-error" role="alert">
        {tc('errors.generic')}
      </p>
    );
  }
  if (!data) return <div className="ui-skeleton-text" aria-busy="true" data-testid="rec-settings-loading" />;
  const ro = !data.admin;
  const s = data.settings;
  const owner = data.owners?.find((o) => o.userId === from);
  const target = data.people?.find((p) => p.id === to);
  const dateFmt = (d: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(parseDbUtc(d));

  return (
    <div className="rec-settings st-stack" data-testid="rec-settings">
      {ro && <p className="ui-help">{t('readOnly')}</p>}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      <section className="rec-edit-block">
        <h2 className="rec-h">{t('defaults')}</h2>
        <p className="ui-help">{t('defaultsHelp')}</p>
        <fieldset className="rec-share-group" disabled={ro}>
          <legend className="label">{t('defaultPrivacy')}</legend>
          <label className="ui-check">
            <input type="radio" name="rec-def-p" checked={privacy === 'link'} onChange={() => setPrivacy('link')} />
            <span>{t('privacyLink')}</span>
          </label>
          <label className="ui-check">
            <input type="radio" name="rec-def-p" checked={privacy === 'workspace'} onChange={() => setPrivacy('workspace')} data-testid="rec-default-workspace" />
            <span>{t('privacyWorkspace')}</span>
          </label>
        </fieldset>
        <label className="ui-check">
          <input type="checkbox" checked={download} disabled={ro} onChange={(e) => setDownload(e.target.checked)} data-testid="rec-default-download" />
          <span>{t('defaultDownload')}</span>
        </label>
        {!ro && (
          <div className="rec-pane-foot">
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void patch({ defaultPrivacy: privacy, defaultAllowDownload: download })} data-testid="rec-defaults-save">
              {tc('save')}
            </button>
          </div>
        )}
      </section>
      <section className="rec-edit-block">
        <h2 className="rec-h">{t('brand')}</h2>
        <p className="ui-help">{t('brandHelp')}</p>
        <div className="ui-fields ui-fields-2">
          <div className="ui-field">
            <label className="label" htmlFor="rec-brand-name">
              {t('brandName')}
            </label>
            <input id="rec-brand-name" className="input" value={brandName} readOnly={ro} maxLength={80} onChange={(e) => setBrandName(e.target.value)} data-testid="rec-brand-name" />
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="rec-brand-color">
              {t('brandColor')}
            </label>
            <div className="ui-input-group">
              <input id="rec-brand-color" className="input data" value={brandColor} readOnly={ro} placeholder="#e11d48" maxLength={7} onChange={(e) => setBrandColor(e.target.value)} data-testid="rec-brand-color" />
              <input type="color" className="rec-color-pick" aria-label={t('brandColor')} disabled={ro} value={/^#[0-9a-f]{6}$/i.test(brandColor) ? brandColor : '#e11d48'} onChange={(e) => setBrandColor(e.target.value)} />
            </div>
          </div>
        </div>
        <p className="ui-help">{s.hasLogo ? t('logoSet') : t('logoNone')}</p>
        {!ro && (
          <div className="rec-pane-foot">
            <input ref={logoRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} aria-hidden="true" data-testid="rec-logo-file" onChange={(e) => void uploadLogo(e.target.files?.[0])} />
            {s.hasLogo && (
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void removeLogo()}>
                {t('logoRemove')}
              </button>
            )}
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => logoRef.current?.click()}>
              {t('logoUpload')}
            </button>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void patch({ brandName, brandColor: brandColor.trim() || null })} data-testid="rec-brand-save">
              {tc('save')}
            </button>
          </div>
        )}
      </section>
      <section className="rec-edit-block">
        <h2 className="rec-h">{t('retention')}</h2>
        <p className="ui-help">{t('retentionHelp', { days: REC_RETENTION_GRACE_DAYS })}</p>
        <div className="ui-field">
          <label className="label" htmlFor="rec-retention">
            {t('retentionKeep')}
          </label>
          <select id="rec-retention" className="input" value={retention} disabled={ro} onChange={(e) => setRetention(e.target.value)} data-testid="rec-retention">
            <option value="">{t('retentionOff')}</option>
            {REC_RETENTION_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {t('retentionDays', { days: d })}
              </option>
            ))}
          </select>
        </div>
        {s.retentionDays !== null && s.retentionStartsAt && (
          <p className="ui-help" data-testid="rec-retention-status">
            {t('retentionOn', { date: dateFmt(s.retentionStartsAt), deleted: s.retentionDeleted })}
          </p>
        )}
        {!ro && (
          <div className="rec-pane-foot">
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void saveRetention()} data-testid="rec-retention-save">
              {tc('save')}
            </button>
          </div>
        )}
      </section>
      {data.admin && (
        <section className="rec-edit-block">
          <h2 className="rec-h">{t('transfer')}</h2>
          <p className="ui-help">{t('transferHelp')}</p>
          <div className="ui-fields ui-fields-2">
            <div className="ui-field">
              <label className="label" htmlFor="rec-tr-from">
                {t('transferFrom')}
              </label>
              <select id="rec-tr-from" className="input" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="rec-transfer-from">
                <option value="">{t('transferPick')}</option>
                {data.owners?.map((o) => (
                  <option key={o.userId} value={o.userId}>
                    {t('transferOwner', { name: o.name || o.userId, videos: o.videos, folders: o.folders })}
                  </option>
                ))}
              </select>
            </div>
            <div className="ui-field">
              <label className="label" htmlFor="rec-tr-to">
                {t('transferTo')}
              </label>
              <select id="rec-tr-to" className="input" value={to} onChange={(e) => setTo(e.target.value)} data-testid="rec-transfer-to">
                <option value="">{t('transferPick')}</option>
                {data.people?.filter((p) => p.id !== from).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="rec-pane-foot">
            <button type="button" className="btn btn-primary btn-sm" disabled={busy || !from || !to} onClick={() => setTransferring(true)} data-testid="rec-transfer-go">
              {t('transferGo')}
            </button>
          </div>
        </section>
      )}
      {toast && (
        <div className="ui-toasts" aria-live="polite">
          <div className="ui-toast" role="status" data-testid="rec-settings-toast">
            {toast}
          </div>
        </div>
      )}
      <ConfirmDialog
        open={preview !== null}
        title={t('retentionConfirmTitle', { days: preview?.days ?? 0 })}
        body={t('retentionConfirmBody', { count: preview?.count ?? 0, grace: REC_RETENTION_GRACE_DAYS })}
        confirmLabel={t('retentionConfirm')}
        cancelLabel={tc('cancel')}
        danger
        busy={busy}
        onConfirm={() => {
          const days = preview?.days ?? null;
          setPreview(null);
          void patch({ retentionDays: days });
        }}
        onCancel={() => setPreview(null)}
      />
      <ConfirmDialog
        open={transferring}
        title={t('transferConfirmTitle')}
        body={t('transferConfirmBody', { videos: owner?.videos ?? 0, folders: owner?.folders ?? 0, from: owner?.name ?? '', to: target?.name ?? '' })}
        confirmLabel={t('transferGo')}
        cancelLabel={tc('cancel')}
        danger
        busy={busy}
        onConfirm={() => void transfer()}
        onCancel={() => setTransferring(false)}
      />
    </div>
  );
}
