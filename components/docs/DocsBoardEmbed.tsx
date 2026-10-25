'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import DocsGlyph from './DocsGlyphs';
import { parseDbUtc } from '@/lib/utils';

interface EmbedData {
  id: string;
  name: string;
  thumbnail: string | null;
  updated_at: string;
}

/** La vista previa se refresca sola mientras la página está abierta (y al volver a la pestaña). */
const REFRESH_MS = 60_000;

/**
 * Vista previa de solo lectura de una pizarra en una página de Docs: nombre,
 * miniatura y link para abrirla. La pide a /api/boards/<id>/embed, que solo
 * responde si quien mira puede ver la pizarra; si no, un aviso sin datos.
 */
export function DocsBoardPreview({ boardId, onChange }: { boardId: string; onChange?: () => void }) {
  const t = useTranslations('docs.editor.board');
  const format = useFormatter();
  const [data, setData] = useState<EmbedData | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'denied'>('loading');

  const load = useCallback(async () => {
    const res = await fetch(`/api/boards/${encodeURIComponent(boardId)}/embed`).catch(() => null);
    if (res?.ok) {
      setData((await res.json()) as EmbedData);
      setState('ok');
    } else if (res && (res.status === 404 || res.status === 401)) {
      setState('denied');
    }
  }, [boardId]);

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

  const thumb = useMemo(
    () => (data?.thumbnail ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data.thumbnail)}` : null),
    [data?.thumbnail],
  );

  if (state === 'denied') {
    return (
      <div className="docs-board-embed is-denied">
        <span className="docs-board-icon" aria-hidden="true">
          <DocsGlyph name="board" size={18} />
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
    <div className="docs-board-embed" aria-busy={state === 'loading'}>
      <Link href={`/app/board/${boardId}`} className="docs-board-thumb" aria-label={t('open', { name: data?.name ?? '' })} tabIndex={-1}>
        {/* Miniatura SVG filtrada en el servidor; como <img> no ejecuta nada. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {thumb ? <img src={thumb} alt="" /> : <span className="docs-board-empty">{state === 'ok' ? t('empty') : ''}</span>}
      </Link>
      <div className="docs-board-meta">
        <span className="docs-board-name">{data?.name ?? t('loading')}</span>
        {data && (
          <span className="docs-board-updated">{t('updated', { when: format.relativeTime(parseDbUtc(data.updated_at)) })}</span>
        )}
        <span className="docs-board-actions">
          <Link href={`/app/board/${boardId}`} className="btn btn-sm">
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

interface BoardOption {
  id: string;
  name: string;
}

/** Buscador de pizarras del workspace para un bloque /board recién creado. */
/**
 * `autoFocus`: solo cuando el bloque se acaba de insertar con el foco (un
 * bloque copiado o movido con la selección de bloques no se roba el foco).
 */
export function DocsBoardPicker({ onPick, autoFocus = true }: { onPick: (id: string) => void; autoFocus?: boolean }) {
  const t = useTranslations('docs.editor.board');
  const [boards, setBoards] = useState<BoardOption[] | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetch('/api/boards')
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { boards: BoardOption[] };
        if (alive) setBoards(data.boards.map((b) => ({ id: b.id, name: b.name })));
      })
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, []);

  const term = q.trim().toLowerCase();
  const list = (boards ?? []).filter((b) => !term || b.name.toLowerCase().includes(term)).slice(0, 8);

  return (
    <div className="docs-board-picker">
      <p className="docs-board-picker-title">
        <DocsGlyph name="board" size={16} />
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
          {t('loadError')}
        </p>
      ) : boards === null ? (
        <p className="docs-board-hint" role="status">
          {t('loading')}
        </p>
      ) : list.length === 0 ? (
        <p className="docs-board-hint">
          {boards.length === 0 ? t('none') : t('noMatch')} <Link href="/app/board?new=1">{t('create')}</Link>
        </p>
      ) : (
        <ul className="docs-board-options">
          {list.map((b) => (
            <li key={b.id}>
              <button type="button" className="docs-board-option" onClick={() => onPick(b.id)}>
                {b.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
