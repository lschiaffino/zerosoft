'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import type { BoardThreadView } from '@/lib/board-comments';
import type { MentionMember } from '@/lib/board-mentions';
import { sceneToView, viewToScene, type CanvasView } from '@/lib/board-view';
import type { CanvasApi } from './ExcalidrawCanvas';
import MentionTextarea from './MentionTextarea';
import NotesIcon from '@/components/notes/NotesIcon';
import { parseDbUtc } from '@/lib/utils';

const POP_W = 320;
/** Movimiento mínimo (px) para que soltar un pin cuente como moverlo y no como abrirlo. */
const DRAG_PX = 4;

/**
 * Comentarios anclados al lienzo: pins sobre la escena (siguen el scroll y el
 * zoom de Excalidraw), el hilo en un popover y la lista en un panel lateral.
 * `placing` = el próximo clic en el lienzo crea un hilo ahí.
 */
export default function CanvasComments({
  boardId,
  api,
  panelOpen,
  onClosePanel,
  placing,
  onPlaced,
  initialThreadId,
  onCountChange,
}: {
  boardId: string;
  api: CanvasApi | null;
  panelOpen: boolean;
  onClosePanel: () => void;
  placing: boolean;
  onPlaced: () => void;
  initialThreadId: string | null;
  onCountChange: (open: number) => void;
}) {
  const t = useTranslations('board.comments');
  const format = useFormatter();
  const [threads, setThreads] = useState<BoardThreadView[]>([]);
  const [members, setMembers] = useState<MentionMember[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [view, setView] = useState<CanvasView>({ scrollX: 0, scrollY: 0, zoom: 1 });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ x: number; y: number } | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1200, height: 800 });
  const openedInitial = useRef(false);
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;

  // Tamaño del lienzo: el popover se acomoda para no salirse.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setSize({ width: el.clientWidth || 1200, height: el.clientHeight || 800 });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const load = useCallback(async () => {
    const res = await fetch(`/api/boards/${boardId}/comments`).catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { threads: BoardThreadView[]; members: MentionMember[]; me: string };
    setThreads(data.threads);
    setMembers(data.members);
    setMe(data.me);
  }, [boardId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    onCountChange(threads.filter((th) => !th.resolved_at).length);
  }, [threads, onCountChange]);

  // Los pins siguen el scroll y el zoom del lienzo.
  useEffect(() => {
    if (!api) return;
    const s = api.getAppState();
    setView({ scrollX: Number(s.scrollX) || 0, scrollY: Number(s.scrollY) || 0, zoom: Number((s.zoom as { value?: number })?.value) || 1 });
    return api.onScrollChange((scrollX, scrollY, zoom) => setView({ scrollX, scrollY, zoom: zoom.value }));
  }, [api]);

  const numbered = useMemo(() => threads.map((th, i) => ({ ...th, n: i + 1 })), [threads]);
  const visible = numbered.filter((th) => showResolved || !th.resolved_at || th.id === activeId);
  const active = numbered.find((th) => th.id === activeId) ?? null;

  /** Centra el lienzo en un hilo y lo abre. */
  const focusThread = useCallback(
    (th: { id: string; x: number; y: number }) => {
      if (api) {
        const next = { scrollX: size.width / 2 / view.zoom - th.x, scrollY: size.height / 2 / view.zoom - th.y };
        api.updateScene({ appState: next });
        setView((v) => ({ ...v, ...next }));
      }
      setDraft(null);
      setActiveId(th.id);
      setText('');
    },
    [api, view.zoom, size],
  );

  // ?comment=<hilo> (link de la notificación): se abre una vez, cuando ya hay hilos y lienzo.
  useEffect(() => {
    if (openedInitial.current || !initialThreadId || !api) return;
    const th = threads.find((x) => x.id === initialThreadId);
    if (!th) return;
    openedInitial.current = true;
    if (th.resolved_at) setShowResolved(true);
    focusThread(th);
  }, [initialThreadId, threads, api, focusThread]);

  useEffect(() => {
    if (!activeId && !draft) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setActiveId(null);
        setDraft(null);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [activeId, draft]);

  // Esc cancela el modo "agregar comentario".
  useEffect(() => {
    if (!placing) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onPlaced();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [placing, onPlaced]);

  function place(e: React.MouseEvent<HTMLDivElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    setDraft(viewToScene({ x: e.clientX - box.left, y: e.clientY - box.top }, view));
    setActiveId(null);
    setText('');
    setError(false);
    onPlaced();
  }

  async function send(url: string, method: string, body: unknown): Promise<BoardThreadView | null> {
    setBusy(true);
    setError(false);
    try {
      const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as BoardThreadView;
    } catch {
      setError(true);
      return null;
    } finally {
      setBusy(false);
    }
  }

  /** Abre (o cierra) un hilo; el texto a medio escribir es del hilo anterior y se descarta. */
  function openThread(id: string | null) {
    setActiveId(id);
    setText('');
    setError(false);
  }

  function upsert(th: BoardThreadView) {
    setThreads((list) => (list.some((x) => x.id === th.id) ? list.map((x) => (x.id === th.id ? th : x)) : [...list, th]));
  }

  async function submit() {
    const body = text.trim();
    if (!body || busy) return;
    if (draft) {
      const th = await send(`/api/boards/${boardId}/comments`, 'POST', { x: draft.x, y: draft.y, body });
      if (th) {
        upsert(th);
        setDraft(null);
        setActiveId(th.id);
        setText('');
      }
    } else if (active) {
      const th = await send(`/api/boards/${boardId}/comments/${active.id}`, 'POST', { body });
      if (th) {
        upsert(th);
        setText('');
      }
    }
  }

  async function setResolved(th: BoardThreadView, resolved: boolean) {
    const next = await send(`/api/boards/${boardId}/comments/${th.id}`, 'PATCH', { resolved });
    if (!next) return;
    upsert(next);
    if (resolved && !showResolved) setActiveId(null);
  }

  async function removeComment(th: BoardThreadView, commentId: string) {
    if (!confirm(t('confirmDelete'))) return;
    const res = await fetch(`/api/boards/${boardId}/comments/${th.id}/${commentId}`, { method: 'DELETE' }).catch(() => null);
    if (!res?.ok) {
      setError(true);
      return;
    }
    const data = (await res.json()) as { threadDeleted: boolean };
    if (data.threadDeleted) {
      setThreads((list) => list.filter((x) => x.id !== th.id));
      setActiveId(null);
    } else {
      setThreads((list) =>
        list.map((x) => (x.id === th.id ? { ...x, comments: x.comments.filter((c) => c.id !== commentId) } : x)),
      );
    }
  }

  /** Arrastrar un pin lo mueve; un clic sin moverse lo abre. */
  function onPinPointerDown(e: React.PointerEvent<HTMLButtonElement>, th: BoardThreadView) {
    if (e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const origin = { x: th.x, y: th.y };
    let moved = false;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    function onMove(ev: PointerEvent) {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < DRAG_PX) return;
      moved = true;
      setDrag({ id: th.id, x: origin.x + dx / view.zoom, y: origin.y + dy / view.zoom });
    }
    function onUp(ev: PointerEvent) {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      if (!moved) {
        setDraft(null);
        openThread(activeIdRef.current === th.id ? null : th.id);
        return;
      }
      const x = origin.x + (ev.clientX - startX) / view.zoom;
      const y = origin.y + (ev.clientY - startY) / view.zoom;
      setThreads((list) => list.map((p) => (p.id === th.id ? { ...p, x, y } : p)));
      setDrag(null);
      void send(`/api/boards/${boardId}/comments/${th.id}`, 'PATCH', { x, y });
    }
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
  }

  function popStyle(sx: number, sy: number): React.CSSProperties {
    const p = sceneToView({ x: sx, y: sy }, view);
    const { width, height } = size;
    const left = p.x + 24 + POP_W > width - (panelOpen ? 340 : 0) ? Math.max(8, p.x - POP_W - 16) : p.x + 24;
    const top = Math.min(Math.max(8, p.y - 16), Math.max(8, height - 360));
    return { left, top, width: Math.min(POP_W, width - 16) };
  }

  const panelThreads = numbered.filter((th) => showResolved || !th.resolved_at);

  return (
    <div ref={wrapRef} className="board-comments-layer">
      {placing && (
        <div className="board-comments-placing" onClick={place} role="presentation">
          <span className="board-comments-placing-hint">{t('placeHint')}</span>
        </div>
      )}

      {visible.map((th) => {
        const pos = drag?.id === th.id ? drag : th;
        const p = sceneToView(pos, view);
        return (
          <button
            key={th.id}
            type="button"
            className={`board-pin${th.resolved_at ? ' is-resolved' : ''}${th.id === activeId ? ' is-active' : ''}`}
            style={{ left: p.x, top: p.y }}
            onPointerDown={(e) => onPinPointerDown(e, th)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openThread(activeId === th.id ? null : th.id);
              }
            }}
            aria-label={t('pinLabel', { n: th.n, count: th.comments.length })}
            aria-expanded={th.id === activeId}
          >
            {th.n}
          </button>
        );
      })}

      {draft && (
        <>
          <span className="board-pin is-draft" style={{ left: sceneToView(draft, view).x, top: sceneToView(draft, view).y }} aria-hidden="true" />
          <div className="board-thread" style={popStyle(draft.x, draft.y)} role="dialog" aria-label={t('newThread')}>
            <MentionTextarea
              value={text}
              onChange={setText}
              onSubmit={() => void submit()}
              members={members}
              placeholder={t('placeholder')}
              label={t('newThread')}
              autoFocus
            />
            {error && <p className="ui-error" role="alert">{t('error')}</p>}
            <div className="board-thread-actions">
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDraft(null)}>
                {t('cancel')}
              </button>
              <button type="button" className="btn btn-sm btn-primary" disabled={!text.trim()} aria-busy={busy} onClick={() => void submit()}>
                {t('post')}
              </button>
            </div>
          </div>
        </>
      )}

      {active && !draft && (
        <div className="board-thread" style={popStyle(active.x, active.y)} role="dialog" aria-label={t('threadLabel', { n: active.n })}>
          <div className="board-thread-head">
            <span className="board-thread-title">{t('threadLabel', { n: active.n })}</span>
            <button
              type="button"
              className="btn btn-sm"
              aria-busy={busy}
              onClick={() => void setResolved(active, !active.resolved_at)}
            >
              {active.resolved_at ? t('reopen') : t('resolve')}
            </button>
            <button type="button" className="btn btn-sm btn-ghost board-thread-close" aria-label={t('close')} onClick={() => setActiveId(null)}>
              <NotesIcon name="close" size={14} />
            </button>
          </div>
          {active.resolved_at && (
            <p className="board-thread-resolved">
              {active.resolved_by_name ? t('resolvedBy', { name: active.resolved_by_name }) : t('resolved')}
            </p>
          )}
          <ol className="board-thread-list">
            {active.comments.map((c) => (
              <li key={c.id} className="board-comment">
                <div className="board-comment-meta">
                  <span className="board-comment-author">{c.author_name ?? t('someone')}</span>
                  <time dateTime={c.created_at}>{format.relativeTime(parseDbUtc(c.created_at))}</time>
                  {c.author_id === me && (
                    <button type="button" className="board-comment-delete" onClick={() => void removeComment(active, c.id)} aria-label={t('delete')}>
                      <NotesIcon name="trash" size={13} />
                    </button>
                  )}
                </div>
                {/* renderTrackMarkdown escapa el HTML crudo y filtra los links: es seguro para innerHTML. */}
                <div className="board-comment-body" dangerouslySetInnerHTML={{ __html: c.body_html }} />
              </li>
            ))}
          </ol>
          <MentionTextarea
            value={text}
            onChange={setText}
            onSubmit={() => void submit()}
            members={members}
            placeholder={t('replyPlaceholder')}
            label={t('reply')}
          />
          {error && <p className="ui-error" role="alert">{t('error')}</p>}
          <div className="board-thread-actions">
            <button type="button" className="btn btn-sm btn-primary" disabled={!text.trim()} aria-busy={busy} onClick={() => void submit()}>
              {t('reply')}
            </button>
          </div>
        </div>
      )}

      {panelOpen && (
        <aside className="board-comments-panel" aria-label={t('title')}>
          <div className="board-comments-panel-head">
            <h2>{t('title')}</h2>
            <button type="button" className="btn btn-sm btn-ghost" aria-label={t('close')} onClick={onClosePanel}>
              <NotesIcon name="close" size={14} />
            </button>
          </div>
          <label className="board-comments-filter">
            <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
            {t('showResolved')}
          </label>
          {panelThreads.length === 0 ? (
            <p className="board-comments-empty">{t('empty')}</p>
          ) : (
            <ul className="board-comments-items">
              {panelThreads.map((th) => {
                const first = th.comments[0];
                return (
                  <li key={th.id}>
                    <button
                      type="button"
                      className={`board-comments-item${th.id === activeId ? ' is-active' : ''}${th.resolved_at ? ' is-resolved' : ''}`}
                      onClick={() => focusThread(th)}
                    >
                      <span className="board-comments-item-n">{th.n}</span>
                      <span className="board-comments-item-body">
                        <span className="board-comments-item-text">{first ? first.body.slice(0, 160) : ''}</span>
                        <span className="board-comments-item-meta">
                          {first?.author_name ?? t('someone')}
                          {' · '}
                          {t('replies', { count: Math.max(0, th.comments.length - 1) })}
                          {th.resolved_at ? ` · ${t('resolved')}` : ''}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>
      )}
    </div>
  );
}
