'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import FormSection from '@/components/ui/FormSection';
import { WORKSPACE_SIZES_LIST } from '@/lib/workspace-mode';

export interface WorkspaceFormDto {
  id: string;
  name: string;
  slug: string | null;
  logoUrl: string | null;
  mode: 'personal' | 'team';
  size: string | null;
  allowedDomains: string[];
  ownerEmail: string;
}

function initial(name: string): string {
  return (name.trim().charAt(0) || 'W').toUpperCase();
}

/**
 * Ajustes › Workspace: nombre, logo, identificador, modo (personal o equipo),
 * tamaño y dominios que se suman sin invitación. Cada bloque se guarda solo;
 * el nombre y el logo nuevos se ven en el switcher sin recargar.
 */
export default function WorkspacePanel({ initial: init, canEdit }: { initial: WorkspaceFormDto; canEdit: boolean }) {
  const t = useTranslations('settings.workspaceForm');
  const router = useRouter();
  const [ws, setWs] = useState(init);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function patch(body: Record<string, unknown>): Promise<string | void> {
    const res = await fetch('/api/teams/workspace', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (!res) return t('errors.network');
    const data = (await res.json().catch(() => ({}))) as Partial<WorkspaceFormDto> & { error?: string };
    if (!res.ok) return data.error && t.has(`errors.${data.error}`) ? t(`errors.${data.error}`) : t('errors.save');
    setWs((prev) => ({ ...prev, ...data }));
    router.refresh();
  }

  async function uploadLogo(file: File) {
    setLogoBusy(true);
    setLogoError(null);
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/teams/workspace/logo', { method: 'POST', body: fd }).catch(() => null);
    setLogoBusy(false);
    const data = res ? ((await res.json().catch(() => ({}))) as { logoUrl?: string; error?: string }) : {};
    if (!res?.ok) {
      setLogoError(data.error && t.has(`errors.${data.error}`) ? t(`errors.${data.error}`) : t('errors.logo'));
      return;
    }
    setWs((p) => ({ ...p, logoUrl: data.logoUrl ?? null }));
    router.refresh();
  }

  async function removeLogo() {
    setLogoBusy(true);
    await fetch('/api/teams/workspace/logo', { method: 'DELETE' }).catch(() => null);
    setLogoBusy(false);
    setWs((p) => ({ ...p, logoUrl: null }));
    router.refresh();
  }

  return (
    <>
      <FormSection
        title={t('detailsTitle')}
        description={t('detailsDesc')}
        disabled={!canEdit}
        note={canEdit ? undefined : t('readOnly')}
        onSubmit={canEdit ? (fd) => patch({ name: String(fd.get('name') ?? ''), slug: String(fd.get('slug') ?? '') || null, size: String(fd.get('size') ?? '') || null }) : undefined}
        footer={canEdit ? undefined : <p className="ui-section-note">{t('readOnly')}</p>}
      >
        <div className="ws-logo-row">
          {ws.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={ws.logoUrl} alt="" width={48} height={48} className="ws-logo" />
          ) : (
            <span className="ws-logo ws-logo-initial" aria-hidden="true">
              {initial(ws.name)}
            </span>
          )}
          {canEdit && (
            <div className="ws-logo-actions">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="sr-only"
                id="ws-logo-file"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadLogo(f);
                  e.target.value = '';
                }}
              />
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()} disabled={logoBusy} aria-busy={logoBusy || undefined}>
                {ws.logoUrl ? t('changeLogo') : t('uploadLogo')}
              </button>
              {ws.logoUrl && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void removeLogo()} disabled={logoBusy}>
                  {t('removeLogo')}
                </button>
              )}
              <p className="ui-help">{t('logoHelp')}</p>
              {logoError && (
                <p className="ui-error" role="alert">
                  {logoError}
                </p>
              )}
            </div>
          )}
        </div>
        <div className="ui-fields ui-fields-2">
          <div className="ui-field">
            <label className="label" htmlFor="ws-name">
              {t('name')}
            </label>
            <input id="ws-name" name="name" className="input" defaultValue={ws.name} maxLength={80} required disabled={!canEdit} />
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="ws-slug">
              {t('slug')}
            </label>
            <input
              id="ws-slug"
              name="slug"
              className="input data"
              defaultValue={ws.slug ?? ''}
              maxLength={40}
              pattern="[a-z0-9][a-z0-9-]*[a-z0-9]"
              placeholder={t('slugPlaceholder')}
              disabled={!canEdit}
            />
            <p className="ui-help">{t('slugHelp')}</p>
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="ws-size">
              {t('size')}
            </label>
            <select id="ws-size" name="size" className="select" defaultValue={ws.size ?? ''} disabled={!canEdit}>
              <option value="">{t('sizeUnset')}</option>
              {WORKSPACE_SIZES_LIST.map((s) => (
                <option key={s} value={s}>
                  {t(`sizes.${s}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="ui-field">
            <span className="label">{t('owner')}</span>
            <p className="data ws-owner">{ws.ownerEmail}</p>
          </div>
        </div>
      </FormSection>

      <FormSection
        title={t('modeTitle')}
        description={t('modeDesc')}
        disabled={!canEdit}
        onSubmit={canEdit ? (fd) => patch({ mode: fd.get('mode') === 'personal' ? 'personal' : 'team' }) : undefined}
        footer={canEdit ? undefined : <p className="ui-section-note">{t('readOnly')}</p>}
      >
        <div className="ws-choice-list" role="radiogroup" aria-label={t('modeTitle')}>
          {(['team', 'personal'] as const).map((m) => (
            <label key={m} className="ws-choice">
              <input type="radio" name="mode" value={m} defaultChecked={ws.mode === m} disabled={!canEdit} />
              <span className="ws-choice-text">
                <span className="st-strong">{t(`modes.${m}.title`)}</span>
                <span className="ui-help">{t(`modes.${m}.desc`)}</span>
              </span>
            </label>
          ))}
        </div>
      </FormSection>

      <FormSection
        title={t('domainsTitle')}
        description={t('domainsDesc')}
        disabled={!canEdit}
        onSubmit={
          canEdit
            ? (fd) =>
                patch({
                  allowedDomains: String(fd.get('domains') ?? '')
                    .split(/[\s,;]+/)
                    .map((d) => d.trim())
                    .filter(Boolean),
                })
            : undefined
        }
        footer={canEdit ? undefined : <p className="ui-section-note">{t('readOnly')}</p>}
      >
        <div className="ui-field">
          <label className="label" htmlFor="ws-domains">
            {t('domains')}
          </label>
          <input
            id="ws-domains"
            name="domains"
            className="input data"
            defaultValue={ws.allowedDomains.join(', ')}
            placeholder={t('domainsPlaceholder')}
            disabled={!canEdit}
          />
          <p className="ui-help">{t('domainsHelp')}</p>
        </div>
      </FormSection>
    </>
  );
}
