'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import { DESIGN_PRESETS, type DesignDoc } from '@/lib/design-model';
import type { DesignSummary } from '@/lib/design';
import PageSvg from './PageSvg';
import { notifyDesignChanged } from './ui';

interface BuiltIn {
  id: string;
  preset: string;
  name: string;
  doc: DesignDoc;
}

/** Galería de plantillas: elegir una crea un diseño nuevo con sus páginas. */
export default function DesignTemplates({ builtIn, workspace }: { builtIn: BuiltIn[]; workspace: DesignSummary[] }) {
  const t = useTranslations('design.templates');
  const tp = useTranslations('design.presets');
  const locale = useLocale();
  const router = useRouter();
  const [filter, setFilter] = useState<string>('all');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = useMemo(
    () => builtIn.filter((b) => (filter === 'all' || b.preset === filter) && b.name.toLowerCase().includes(q.trim().toLowerCase())),
    [builtIn, filter, q],
  );
  const shownWs = workspace.filter((w) => w.name.toLowerCase().includes(q.trim().toLowerCase()));

  const use = async (template: string) => {
    setBusy(template);
    setError(null);
    try {
      const r = await fetch('/api/design/designs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ template, locale }) });
      if (!r.ok) throw new Error('create');
      const d = (await r.json()) as { design: { id: string } };
      notifyDesignChanged();
      router.push(`/app/design/${d.design.id}`);
    } catch {
      setError(t('error'));
      setBusy(null);
    }
  };

  return (
    <div className="app-page ui-page dz-home" data-testid="design-templates">
      <PageHeader title={t('title')} description={t('lead')} back={{ href: '/app/design', label: 'Design' }} />
      <div className="dz-home-bar">
        <nav className="dz-tabs" aria-label={t('filter')}>
          <button type="button" className={`dz-tab${filter === 'all' ? ' is-active' : ''}`} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
            {t('all')}
          </button>
          {DESIGN_PRESETS.filter((p) => builtIn.some((b) => b.preset === p.key)).map((p) => (
            <button key={p.key} type="button" className={`dz-tab${filter === p.key ? ' is-active' : ''}`} aria-pressed={filter === p.key} onClick={() => setFilter(p.key)}>
              {tp(`${p.key}.name`)}
            </button>
          ))}
        </nav>
        <input className="input dz-search" type="search" placeholder={t('search')} aria-label={t('search')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}

      <section aria-labelledby="dz-ws-templates" className="dz-tpl-section">
        <h2 id="dz-ws-templates" className="dz-h2">
          {t('workspace')}
        </h2>
        {shownWs.length ? (
          <ul className="dz-cards">
            {shownWs.map((w) => (
              <li key={w.id} className="dz-card">
                <button type="button" className="dz-card-thumb" onClick={() => void use(`w:${w.id}`)} disabled={!!busy} aria-label={t('use', { name: w.name })}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {w.thumb ? <img src={w.thumb} alt="" /> : <span className="dz-card-ph" style={{ aspectRatio: `${w.width} / ${w.height}` }} />}
                </button>
                <div className="dz-card-meta">
                  <div className="dz-card-text">
                    <span className="dz-card-name">{w.name}</span>
                    <span className="dz-card-sub">
                      {w.width} × {w.height} · {w.ownerName}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState compact quiet body={t('workspaceEmpty')} />
        )}
      </section>

      <section aria-labelledby="dz-builtin" className="dz-tpl-section">
        <h2 id="dz-builtin" className="dz-h2">
          {t('builtIn')}
        </h2>
        {shown.length ? (
          <ul className="dz-cards" data-testid="design-template-list">
            {shown.map((b) => (
              <li key={b.id} className="dz-card">
                <button type="button" className="dz-card-thumb dz-card-thumb-svg" onClick={() => void use(b.id)} disabled={!!busy} aria-label={t('use', { name: b.name })} data-testid={`design-template-${b.id}`}>
                  <PageSvg doc={b.doc} page={b.doc.pages[0]} displayWidth={240} className="dz-tpl-preview" />
                </button>
                <div className="dz-card-meta">
                  <div className="dz-card-text">
                    <span className="dz-card-name">{b.name}</span>
                    <span className="dz-card-sub">
                      {tp(`${b.preset}.name`)}
                      {b.doc.pages.length > 1 ? ` · ${t('pages', { n: b.doc.pages.length })}` : ''}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState compact quiet body={t('empty')} />
        )}
      </section>
      {busy && (
        <p className="muted" role="status">
          {t('creating')}
        </p>
      )}
    </div>
  );
}
