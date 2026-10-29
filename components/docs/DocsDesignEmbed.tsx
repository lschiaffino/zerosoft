'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import DocsGlyph from './DocsGlyphs';

interface EmbedData {
  id: string;
  name: string;
  width: number;
  height: number;
  pages: number;
  thumb: string | null;
}

const REFRESH_MS = 60_000;

/**
 * Vista previa de un diseño de Design en una página de Docs: miniatura,
 * nombre y link para abrirlo. La pide a /api/design/designs/<id>?embed=1, que
 * solo responde si quien mira puede ver el diseño (y tiene Design); si no, un
 * aviso sin datos.
 */
export function DocsDesignPreview({ designId, onChange }: { designId: string; onChange?: () => void }) {
  const t = useTranslations('docs.editor.design');
  const [data, setData] = useState<EmbedData | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'denied'>('loading');

  const load = useCallback(async () => {
    const res = await fetch(`/api/design/designs/${encodeURIComponent(designId)}?embed=1`).catch(() => null);
    if (res?.ok) {
      setData(((await res.json()) as { design: EmbedData }).design);
      setState('ok');
    } else if (res && (res.status === 404 || res.status === 401 || res.status === 403)) {
      setState('denied');
    }
  }, [designId]);

  useEffect(() => {
    void load();
    const tick = () => {
      if (document.visibilityState === 'visible') void load();
    };
    const h = setInterval(tick, REFRESH_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(h);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [load]);

  if (state === 'denied') {
    return (
      <div className="docs-board-embed is-denied" data-testid="docs-design-denied">
        <span className="docs-board-icon" aria-hidden="true">
          <DocsGlyph name="image" size={18} />
        </span>
        <span className="docs-board-denied">{t('noAccess')}</span>
        {onChange && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={onChange}>
            {t('change')}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="docs-board-embed" aria-busy={state === 'loading'} data-testid="docs-design-preview">
      <Link href={`/app/design/${designId}`} className="docs-board-thumb" aria-label={t('open', { name: data?.name ?? '' })} tabIndex={-1}>
        {/* Miniatura JPEG en data URL generada por el editor. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {data?.thumb ? <img src={data.thumb} alt="" /> : <span className="docs-board-empty" />}
      </Link>
      <div className="docs-board-meta">
        <span className="docs-board-name">{data?.name ?? t('loading')}</span>
        {data && (
          <span className="docs-board-updated">
            {data.width} × {data.height} px · {t('pages', { n: data.pages })}
          </span>
        )}
        <span className="docs-board-actions">
          <Link href={`/app/design/${designId}`} className="btn btn-sm">
            {t('openButton')}
          </Link>
          {onChange && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={onChange}>
              {t('change')}
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

/** Buscador de diseños para un bloque /design recién creado. */
export function DocsDesignPicker({ onPick, autoFocus = true }: { onPick: (id: string) => void; autoFocus?: boolean }) {
  const t = useTranslations('docs.editor.design');
  const [designs, setDesigns] = useState<Array<{ id: string; name: string }> | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetch('/api/design/designs?view=recent&limit=100')
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { designs: Array<{ id: string; name: string }> };
        if (alive) setDesigns(data.designs.map((d) => ({ id: d.id, name: d.name })));
      })
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, []);

  const term = q.trim().toLowerCase();
  const list = (designs ?? []).filter((d) => !term || d.name.toLowerCase().includes(term)).slice(0, 8);

  return (
    <div className="docs-board-picker" data-testid="docs-design-picker">
      <p className="docs-board-picker-title">
        <DocsGlyph name="image" size={16} />
        {t('pick')}
      </p>
      <input
        className="input"
        autoFocus={autoFocus}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && list[0]) {
            e.preventDefault();
            e.stopPropagation();
            onPick(list[0].id);
          }
        }}
        placeholder={t('search')}
        aria-label={t('search')}
      />
      {error ? (
        <p className="ui-error" role="alert">
          {t('error')}
        </p>
      ) : designs === null ? (
        <p className="docs-board-hint" role="status">
          {t('loading')}
        </p>
      ) : !list.length ? (
        <p className="docs-board-hint">
          {designs.length ? t('noMatch') : t('empty')} <Link href="/app/design?new=1">{t('create')}</Link>
        </p>
      ) : (
        <ul className="docs-board-options">
          {list.map((d) => (
            <li key={d.id}>
              <button type="button" className="docs-board-option" onClick={() => onPick(d.id)}>
                {d.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
