'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { BioEditorLink, BioSettings } from '@/lib/link-bio';
import type { LinkStatus } from '@/lib/links';
import FormSection from '@/components/ui/FormSection';
import StatusBadge from './StatusBadge';
import EmptyState from '@/components/ui/EmptyState';
import { NEW_LINK_ROUTES } from '@/lib/link-detail-tabs';
import { parseDbUtc } from '@/lib/utils';
import { BIO_THEMES, type BioTheme } from '@/lib/link-bio-theme';
import BioView from './BioView';

interface Props {
  initial: BioSettings;
  handle: string;
  /** Los elegidos (todos) + los activos más nuevos; el resto se busca. */
  links: BioEditorLink[];
}

interface SearchLink {
  id: string;
  title: string | null;
  url: string;
  short_url: string;
  archived: boolean;
  has_password: boolean;
  expires_at: string | null;
  max_clicks: number | null;
  clicks: number;
}

/** Mismo criterio que linkStatus() del server, sobre el DTO de /api/links. */
function searchStatus(l: SearchLink): LinkStatus {
  if (l.archived) return 'archived';
  if (l.expires_at && parseDbUtc(l.expires_at).getTime() <= Date.now()) return 'expired';
  if (l.max_clicks !== null && l.clicks >= l.max_clicks) return 'limit';
  if (l.has_password) return 'protected';
  return 'active';
}

/** Editor de la página /@handle: perfil, publicación y links (selección + orden). Un solo Guardar. */
export default function BioEditor({ initial, handle, links: initialLinks }: Props) {
  const t = useTranslations('link');
  const [values, setValues] = useState(initial);
  const [links, setLinks] = useState(initialLinks);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchMiss, setSearchMiss] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Un link externo: se crea como link corto (así sus clicks también cuentan) y queda elegido al final.
  async function addExternal() {
    const url = newUrl.trim();
    if (!url || adding) return;
    setAdding(true);
    setAddError(null);
    const res = await fetch('/api/links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, ...(newTitle.trim() ? { title: newTitle.trim() } : {}) }),
    }).catch(() => null);
    setAdding(false);
    const data = (await res?.json().catch(() => null)) as (SearchLink & { error?: string }) | null;
    if (!res?.ok || !data?.id) {
      const code = data?.error ?? 'generic';
      setAddError(t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'));
      return;
    }
    setLinks((prev) => [...prev, { id: data.id, label: data.title || data.url, short: data.short_url, archived: false, status: 'active' }]);
    setValues((v) => ({ ...v, linkIds: [...v.linkIds, data.id] }));
    setNewUrl('');
    setNewTitle('');
  }

  // Orden: primero los elegidos (en su orden), después el resto.
  const ordered = [
    ...values.linkIds.map((id) => links.find((l) => l.id === id)).filter((l): l is BioEditorLink => Boolean(l)),
    ...links.filter((l) => !values.linkIds.includes(l.id)),
  ];

  // Busca entre todos los links activos (no solo los más nuevos) y los suma a la lista.
  async function search() {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setSearchMiss(false);
    const res = await fetch(`/api/links?${new URLSearchParams({ q, pageSize: '50' })}`).catch(() => null);
    const data = res?.ok
      ? ((await res.json().catch(() => null)) as { links?: SearchLink[] } | null)
      : null;
    setSearching(false);
    const found = (data?.links ?? []).map((l) => ({
      id: l.id,
      label: l.title || l.url,
      short: l.short_url,
      archived: l.archived,
      status: searchStatus(l),
    }));
    setSearchMiss(found.length === 0);
    setLinks((prev) => [...prev, ...found.filter((f) => !prev.some((p) => p.id === f.id))]);
  }

  function toggle(id: string) {
    setValues((v) => ({ ...v, linkIds: v.linkIds.includes(id) ? v.linkIds.filter((x) => x !== id) : [...v.linkIds, id] }));
  }

  function move(id: string, dir: -1 | 1) {
    setValues((v) => {
      const ids = [...v.linkIds];
      const i = ids.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= ids.length) return v;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      return { ...v, linkIds: ids };
    });
  }

  async function save(): Promise<string | void> {
    const res = await fetch('/api/links/bio', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...values, avatarUrl: values.avatarUrl?.trim() || null }),
    }).catch(() => null);
    if (!res?.ok) return t('bio.error');
  }

  const chosen = values.linkIds.length;
  const previewLinks = values.linkIds
    .map((id) => links.find((l) => l.id === id))
    .filter((l): l is BioEditorLink => Boolean(l) && l!.status === 'active')
    .map((l) => ({ id: l.id, title: l.label.replace(/^https?:\/\//, ''), href: l.short }));

  return (
    <div className="lk-bio-layout">
    <FormSection
      title={t('bio.formTitle')}
      description={handle ? t('bio.formDesc', { handle }) : undefined}
      onSubmit={save}
      submitLabel={t('bio.save')}
      note={t('bio.chosen', { n: chosen })}
      className="lk-form"
    >
      <label className="ui-switch">
        <input
          type="checkbox"
          role="switch"
          checked={values.published}
          onChange={(e) => setValues((v) => ({ ...v, published: e.target.checked }))}
        />
        {t('bio.publish')}
      </label>

      <div className="ui-fields-2">
        <div className="ui-field">
          <label className="label" htmlFor="bio-title">
            {t('bio.pageTitle')}
          </label>
          <input id="bio-title" className="input" maxLength={80} value={values.title} onChange={(e) => setValues((v) => ({ ...v, title: e.target.value }))} />
        </div>
        <div className="ui-field">
          <label className="label" htmlFor="bio-avatar">
            {t('bio.avatar')} <span className="ui-optional">{t('common.optional')}</span>
          </label>
          <input
            id="bio-avatar"
            className="input"
            type="url"
            inputMode="url"
            value={values.avatarUrl ?? ''}
            onChange={(e) => setValues((v) => ({ ...v, avatarUrl: e.target.value }))}
            placeholder="https://"
          />
        </div>
      </div>
      <div className="ui-field">
        <label className="label" htmlFor="bio-text">
          {t('bio.bioText')} <span className="ui-optional">{t('common.optional')}</span>
        </label>
        <textarea id="bio-text" className="textarea" maxLength={300} rows={3} value={values.bio} onChange={(e) => setValues((v) => ({ ...v, bio: e.target.value }))} />
      </div>

      <div className="ui-fields-2">
        <div className="ui-field">
          <label className="label" htmlFor="bio-theme">
            {t('bio.theme')}
          </label>
          <select
            id="bio-theme"
            className="select"
            value={values.theme}
            onChange={(e) => setValues((v) => ({ ...v, theme: e.target.value as BioTheme }))}
          >
            {BIO_THEMES.map((th) => (
              <option key={th} value={th}>
                {t(`bio.themes.${th}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="ui-field">
          <span className="label" id="bio-accent-label">
            {t('bio.accent')}
          </span>
          <span className="lk-color">
            <input
              type="color"
              aria-labelledby="bio-accent-label"
              value={values.accent ?? '#0d0d0d'}
              onChange={(e) => setValues((v) => ({ ...v, accent: e.target.value }))}
            />
            {values.accent ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setValues((v) => ({ ...v, accent: null }))}>
                {t('bio.accentClear')}
              </button>
            ) : (
              <span className="ui-help">{t('bio.accentNone')}</span>
            )}
          </span>
        </div>
      </div>

      <fieldset className="lk-fieldset">
        <legend className="label">{t('bio.links')}</legend>
        <p className="ui-help">{t('bio.linksHint')}</p>
        <div className="lk-inline-form">
          <input
            className="input"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void search();
              }
            }}
            placeholder={t('bio.searchPlaceholder')}
            aria-label={t('bio.searchPlaceholder')}
          />
          <button type="button" className="btn" onClick={() => void search()} disabled={!query.trim()} aria-busy={searching || undefined}>
            {t('bio.search')}
          </button>
        </div>
        {searchMiss && <p className="ui-help" role="status">{t('bio.searchEmpty')}</p>}
        <div className="lk-inline-form lk-bio-add">
          <input
            className="input"
            type="text"
            inputMode="url"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void addExternal();
              }
            }}
            placeholder={t('bio.addUrlPlaceholder')}
            aria-label={t('bio.addUrlPlaceholder')}
            data-testid="bio-add-url"
          />
          <input
            className="input"
            type="text"
            maxLength={200}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void addExternal();
              }
            }}
            placeholder={t('bio.addTitlePlaceholder')}
            aria-label={t('bio.addTitlePlaceholder')}
          />
          <button type="button" className="btn" onClick={() => void addExternal()} disabled={!newUrl.trim() || adding} aria-busy={adding || undefined}>
            {t('bio.addUrl')}
          </button>
        </div>
        {addError && (
          <p className="ui-error" role="alert">
            {addError}
          </p>
        )}
        {links.length === 0 ? (
          <EmptyState
            title={t('bio.empty')}
            body={t('bio.emptyBody')}
            action={{ label: t('bio.emptyCta'), href: NEW_LINK_ROUTES.single }}
            quiet
            product="link"
          />
        ) : (
          <ol className="lk-bio-list">
            {ordered.map((l) => {
              const on = values.linkIds.includes(l.id);
              const pos = values.linkIds.indexOf(l.id);
              // La página pública no muestra estos: se pueden quitar, no sumar.
              const hidden = l.status !== 'active';
              return (
                <li key={l.id} className="lk-bio-item" data-on={on || undefined} data-hidden={hidden || undefined}>
                  <label className="ui-check lk-bio-check">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(l.id)}
                      disabled={hidden && !on}
                      aria-label={l.label}
                      aria-describedby={hidden ? `bio-why-${l.id}` : undefined}
                    />
                    <span className="lk-bio-label">{l.label}</span>
                  </label>
                  {hidden && (
                    <span id={`bio-why-${l.id}`} className="lk-bio-why">
                      <StatusBadge status={l.status} />
                      <span className="sr-only">{t('bio.notShown')}</span>
                    </span>
                  )}
                  <span className="data lk-bio-short">{l.short.replace(/^https?:\/\//, '')}</span>
                  {on && (
                    <span className="lk-bio-move">
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost btn-icon"
                        onClick={() => move(l.id, -1)}
                        disabled={pos === 0}
                        aria-label={`${t('bio.up')}: ${l.label}`}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                          <path d="M6 15l6-6 6 6" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost btn-icon"
                        onClick={() => move(l.id, 1)}
                        disabled={pos === chosen - 1}
                        aria-label={`${t('bio.down')}: ${l.label}`}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </fieldset>
    </FormSection>
    <aside className="lk-bio-preview" aria-label={t('bio.preview')} data-testid="bio-preview">
      <p className="label">{t('bio.preview')}</p>
      <BioView
        preview
        title={values.title || handle}
        handle={handle}
        bio={values.bio}
        avatarUrl={values.avatarUrl && /^https:\/\//.test(values.avatarUrl) ? values.avatarUrl : null}
        links={previewLinks}
        theme={values.theme}
        accent={values.accent}
        emptyLabel={t('bio.previewEmpty')}
      />
    </aside>
    </div>
  );
}
