'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { BioEditorLink, BioSettings } from '@/lib/link-bio';

interface Props {
  initial: BioSettings;
  handle: string;
  /** Los elegidos (todos) + los activos más nuevos; el resto se busca. */
  links: BioEditorLink[];
}

/** Editor de la página /@handle: perfil, publicación y links (selección + orden). */
export default function BioEditor({ initial, handle, links: initialLinks }: Props) {
  const t = useTranslations('link');
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<'idle' | 'saved' | 'error'>('idle');
  const [links, setLinks] = useState(initialLinks);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);

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
    const res = await fetch(`/api/links?${new URLSearchParams({ q, pageSize: '50' })}`).catch(() => null);
    const data = res?.ok
      ? ((await res.json().catch(() => null)) as { links?: Array<{ id: string; title: string | null; url: string; short_url: string }> } | null)
      : null;
    setSearching(false);
    const found = (data?.links ?? []).map((l) => ({ id: l.id, label: l.title || l.url, short: l.short_url, archived: false }));
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

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch('/api/links/bio', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...values, avatarUrl: values.avatarUrl?.trim() || null }),
    }).catch(() => null);
    setBusy(false);
    setState(res?.ok ? 'saved' : 'error');
  }

  return (
    <form className="link-form bio-editor-form" onSubmit={save}>
      <div className="field">
        <label className="label" htmlFor="bio-title">{t('bio.pageTitle')}</label>
        <input id="bio-title" className="input" maxLength={80} value={values.title} onChange={(e) => setValues((v) => ({ ...v, title: e.target.value }))} />
      </div>
      <div className="field">
        <label className="label" htmlFor="bio-text">{t('bio.bioText')}</label>
        <textarea id="bio-text" className="input textarea" maxLength={300} value={values.bio} onChange={(e) => setValues((v) => ({ ...v, bio: e.target.value }))} />
      </div>
      <div className="field">
        <label className="label" htmlFor="bio-avatar">{t('bio.avatar')}</label>
        <input id="bio-avatar" className="input" type="url" value={values.avatarUrl ?? ''} onChange={(e) => setValues((v) => ({ ...v, avatarUrl: e.target.value }))} placeholder="https://…" />
      </div>

      <div className="field">
        <p className="label">{t('bio.links')}</p>
        <p className="field-hint">{t('bio.linksHint')}</p>
        <div className="bio-editor-search">
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
          <button type="button" className="btn btn-small" onClick={() => void search()} disabled={searching || !query.trim()}>
            {t('bio.search')}
          </button>
        </div>
        {links.length === 0 ? (
          <p className="muted">{t('bio.empty')}</p>
        ) : (
          <ul className="bio-editor-list">
            {ordered.map((l) => {
              const on = values.linkIds.includes(l.id);
              return (
                <li key={l.id} className="bio-editor-item">
                  <input type="checkbox" checked={on} onChange={() => toggle(l.id)} aria-label={l.label} />
                  <span className="grow">{l.label}</span>
                  {l.archived && <span className="badge status-archived">{t('table.statusArchived')}</span>}
                  <span className="mono muted">{l.short.replace(/^https?:\/\//, '')}</span>
                  {on && (
                    <>
                      <button type="button" className="icon-btn" onClick={() => move(l.id, -1)} aria-label={t('bio.up')}>↑</button>
                      <button type="button" className="icon-btn" onClick={() => move(l.id, 1)} aria-label={t('bio.down')}>↓</button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <label className="checkbox-field">
        <input type="checkbox" checked={values.published} onChange={(e) => setValues((v) => ({ ...v, published: e.target.checked }))} />
        <span>{t('bio.published')}</span>
      </label>

      {state === 'error' && <p className="form-error">{t('bio.error')}</p>}
      <div className="form-actions">
        <button type="submit" className="btn btn-solid" disabled={busy}>
          {state === 'saved' ? t('bio.saved') : t('bio.save')}
        </button>
        {values.published && handle && (
          <a className="btn btn-ghost btn-small" href={`/@${handle}`} target="_blank" rel="noreferrer">
            {t('bio.view')}
          </a>
        )}
      </div>
    </form>
  );
}
