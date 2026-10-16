'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { BioEditorLink, BioSettings } from '@/lib/link-bio';
import FormSection from '@/components/ui/FormSection';
import EmptyState from '@/components/ui/EmptyState';
import { NEW_LINK_ROUTES } from '@/lib/link-detail-tabs';

interface Props {
  initial: BioSettings;
  handle: string;
  /** Los elegidos (todos) + los activos más nuevos; el resto se busca. */
  links: BioEditorLink[];
}

/** Editor de la página /@handle: perfil, publicación y links (selección + orden). Un solo Guardar. */
export default function BioEditor({ initial, handle, links: initialLinks }: Props) {
  const t = useTranslations('link');
  const [values, setValues] = useState(initial);
  const [links, setLinks] = useState(initialLinks);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchMiss, setSearchMiss] = useState(false);

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
      ? ((await res.json().catch(() => null)) as { links?: Array<{ id: string; title: string | null; url: string; short_url: string }> } | null)
      : null;
    setSearching(false);
    const found = (data?.links ?? []).map((l) => ({ id: l.id, label: l.title || l.url, short: l.short_url, archived: false }));
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

  return (
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
        {t('bio.published')}
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
              return (
                <li key={l.id} className="lk-bio-item" data-on={on || undefined}>
                  <label className="ui-check lk-bio-check">
                    <input type="checkbox" checked={on} onChange={() => toggle(l.id)} aria-label={l.label} />
                    <span className="lk-bio-label">{l.label}</span>
                  </label>
                  {l.archived && <span className="badge">{t('table.statusArchived')}</span>}
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
  );
}
