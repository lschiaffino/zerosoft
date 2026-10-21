'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { selectionItems, type SceneEl } from '@/lib/board-stickies';
import type { BoardTrackCard } from '@/lib/board-track';
import type { CanvasApi } from './ExcalidrawCanvas';
import NotesIcon from '@/components/notes/NotesIcon';
import { usePopover } from '@/components/notes/usePopover';

interface ProjectOption {
  id: string;
  name: string;
}

/**
 * Stickies seleccionados → issues de Track (uno por sticky, con link a la
 * pizarra). Los que ya tienen issue no se duplican; sus tarjetas en vivo
 * aparecen debajo de cada sticky.
 */
export default function BoardTrackTool({
  boardId,
  api,
  cards,
  onCards,
  openSignal = 0,
  className = '',
}: {
  boardId: string;
  api: CanvasApi | null;
  cards: BoardTrackCard[];
  onCards: (cards: BoardTrackCard[]) => void;
  /** Cada vez que cambia (y no es 0) se abre: lo usa el menú "Más herramientas" de la barra. */
  openSignal?: number;
  className?: string;
}) {
  const t = useTranslations('board.track');
  const locale = useLocale();
  const pop = usePopover();
  const [projects, setProjects] = useState<ProjectOption[] | null>(null);
  const [projectId, setProjectId] = useState('');
  const [items, setItems] = useState<Array<{ elementId: string; text: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<BoardTrackCard[]>([]);

  async function open() {
    if (pop.open) return pop.close();
    setError(null);
    setCreated([]);
    if (api) {
      const sel = (api.getAppState().selectedElementIds ?? {}) as Record<string, boolean>;
      setItems(selectionItems(api.getSceneElements() as SceneEl[], sel));
    }
    pop.setOpen(true);
    if (projects === null) {
      const res = await fetch('/api/track/projects?pageSize=100').catch(() => null);
      if (!res?.ok) {
        setProjects([]);
        return;
      }
      const data = (await res.json()) as { rows: Array<ProjectOption & { status?: string }> };
      const list = data.rows.map((p) => ({ id: p.id, name: p.name }));
      setProjects(list);
      setProjectId((cur) => cur || list[0]?.id || '');
    }
  }

  // El menú de la barra pide abrirlo; si ya está abierto, queda así.
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  });
  useEffect(() => {
    if (openSignal) void openRef.current();
  }, [openSignal]);

  const linked = new Set(cards.map((c) => c.element_id));
  const fresh = items.filter((i) => !linked.has(i.elementId));
  const selectedCards = cards.filter((c) => items.some((i) => i.elementId === c.element_id));

  async function create() {
    if (!projectId || !fresh.length) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/boards/${boardId}/track`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId, items: fresh.slice(0, 50), locale }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { created: BoardTrackCard[]; cards: BoardTrackCard[] };
      onCards(data.cards);
      setCreated(data.created);
    } catch {
      setError(t('error'));
    } finally {
      setBusy(false);
    }
  }

  async function unlink(elementId: string) {
    const res = await fetch(`/api/boards/${boardId}/track?element=${encodeURIComponent(elementId)}`, { method: 'DELETE' }).catch(
      () => null,
    );
    if (!res?.ok) {
      setError(t('error'));
      return;
    }
    onCards(((await res.json()) as { cards: BoardTrackCard[] }).cards);
  }

  return (
    <div className={`board-share-wrap board-tool-wrap ${className}`.trim()} ref={pop.wrapRef}>
      <button
        ref={pop.buttonRef}
        type="button"
        className={`btn btn-sm${pop.open ? ' is-on' : ''}`}
        onClick={() => void open()}
        aria-expanded={pop.open}
        aria-haspopup="dialog"
        title={t('button')}
        disabled={!api}
      >
        <NotesIcon name="track" size={14} />
        <span className="board-bar-label">{t('button')}</span>
        {cards.length > 0 && <span className="board-bar-count">{cards.length}</span>}
      </button>
      {pop.open && (
        <div className="board-pop" role="dialog" aria-label={t('title')}>
          <p className="board-pop-title">{t('title')}</p>
          {items.length === 0 ? (
            <p className="board-pop-hint">{t('selectHint')}</p>
          ) : (
            <>
              <p className="board-pop-hint">
                {fresh.length > 0 ? t('ready', { count: fresh.length }) : t('allLinked')}
                {fresh.length > 0 && items.length > fresh.length ? ` ${t('someLinked', { count: items.length - fresh.length })}` : ''}
              </p>
              {fresh.length > 0 &&
                (projects === null ? (
                  <p className="board-pop-hint" role="status">
                    {t('loading')}
                  </p>
                ) : projects.length === 0 ? (
                  <p className="board-pop-hint">
                    {t('noProjects')} <Link href="/app/track">{t('openTrack')}</Link>
                  </p>
                ) : (
                  <div className="board-share-row">
                    <select className="select" value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label={t('project')}>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <button type="button" className="btn btn-sm btn-primary" aria-busy={busy} disabled={busy || !projectId} onClick={() => void create()}>
                      {t('create', { count: fresh.length })}
                    </button>
                  </div>
                ))}
            </>
          )}
          {created.length > 0 && (
            <p className="board-pop-hint" role="status">
              {t('created', { list: created.map((c) => c.identifier).join(', ') })}
            </p>
          )}
          {selectedCards.length > 0 && (
            <ul className="board-track-list">
              {selectedCards.map((c) => (
                <li key={c.element_id}>
                  <Link href={`/app/track/issues/${c.issue_id}`} target="_blank" className="board-track-list-link">
                    <span className="mono">{c.identifier}</span> {c.title}
                  </Link>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => void unlink(c.element_id)}>
                    {t('unlink')}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {error && (
            <p className="ui-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
