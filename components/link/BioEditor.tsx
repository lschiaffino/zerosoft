'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { BioSettings } from '@/lib/link-bio';

interface Props {
  initial: BioSettings;
  handle: string;
  links: Array<{ id: string; label: string; short: string }>;
}

/** Editor de la página /@handle: perfil, publicación y links (selección + orden). */
export default function BioEditor({ initial, handle, links }: Props) {
  const t = useTranslations('link');
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<'idle' | 'saved' | 'error'>('idle');

  // Orden: primero los elegidos (en su orden), después el resto.
  const ordered = [
    ...values.linkIds.map((id) => links.find((l) => l.id === id)).filter((l): l is Props['links'][number] => Boolean(l)),
    ...links.filter((l) => !values.linkIds.includes(l.id)),
  ];

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
    <form className="link-form" onSubmit={save}>
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
