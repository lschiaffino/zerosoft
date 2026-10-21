'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  STICKY_COLORS,
  STICKY_PASTE_MAX,
  cleanStickyTags,
  collectStickyTags,
  isSticky,
  layoutStickies,
  parseBulkStickies,
  stickiesWithTag,
  stickySkeleton,
  stickyTags,
  withFill,
  withStickyTags,
  type SceneEl,
  type StickyColorKey,
} from '@/lib/board-stickies';
import { viewToScene } from '@/lib/board-view';
import type { CanvasApi } from './ExcalidrawCanvas';
import NotesIcon from '@/components/notes/NotesIcon';
import { usePopover } from '@/components/notes/usePopover';

function selectedIds(api: CanvasApi): Set<string> {
  const sel = (api.getAppState().selectedElementIds ?? {}) as Record<string, boolean>;
  return new Set(Object.keys(sel).filter((k) => sel[k]));
}

/** Stickies seleccionados (un texto ligado seleccionado cuenta como su sticky). */
function selectedStickies(api: CanvasApi): SceneEl[] {
  const els = api.getSceneElements() as SceneEl[];
  const ids = selectedIds(api);
  const byId = new Map(els.map((e) => [e.id, e]));
  const out = new Map<string, SceneEl>();
  for (const id of ids) {
    let el = byId.get(id);
    if (el?.type === 'text' && el.containerId) el = byId.get(el.containerId);
    if (el && isSticky(el)) out.set(el.id, el);
  }
  return [...out.values()];
}

/** Centro de lo que se ve del lienzo, en coordenadas de la escena. */
function viewportCenter(api: CanvasApi): { x: number; y: number } {
  const s = api.getAppState();
  const zoom = Number((s.zoom as { value?: number })?.value) || 1;
  return viewToScene(
    { x: (Number(s.width) || 1200) / 2, y: (Number(s.height) || 800) / 2 },
    { scrollX: Number(s.scrollX) || 0, scrollY: Number(s.scrollY) || 0, zoom },
  );
}

/**
 * Herramienta de stickies: color, uno nuevo o una lista pegada (una línea =
 * un sticky, los #tags de cada línea pasan a ser tags), tags y color de los
 * seleccionados, y elegir todos los de un tag.
 */
export default function BoardStickyTool({ api }: { api: CanvasApi | null }) {
  const t = useTranslations('board.stickies');
  const pop = usePopover();
  const [color, setColor] = useState<StickyColorKey>('yellow');
  const [bulk, setBulk] = useState('');
  const [bulkTags, setBulkTags] = useState('');
  const [selection, setSelection] = useState<SceneEl[]>([]);
  const [boardTags, setBoardTags] = useState<Array<{ tag: string; count: number }>>([]);
  const [tagDraft, setTagDraft] = useState('');

  function refresh() {
    if (!api) return;
    setSelection(selectedStickies(api));
    setBoardTags(collectStickyTags(api.getSceneElements() as SceneEl[]));
  }

  function toggle() {
    if (!pop.open) refresh();
    pop.toggle();
  }

  const fill = STICKY_COLORS.find((c) => c.key === color)?.fill ?? STICKY_COLORS[0].fill;
  const drafts = parseBulkStickies(bulk, bulkTags.split(/[,\s]+/));

  async function add(list: Array<{ text: string; tags: string[] }>) {
    if (!api || !list.length) return;
    const { skeletonsToElements, UNDOABLE } = await import('./ExcalidrawCanvas');
    const positions = layoutStickies(list.length, viewportCenter(api));
    const created = skeletonsToElements(list.map((d, i) => stickySkeleton(d, positions[i], fill))) as SceneEl[];
    const ids = Object.fromEntries(created.filter((e) => e.customData?.sticky).map((e) => [e.id, true]));
    api.updateScene({
      elements: [...api.getSceneElementsIncludingDeleted(), ...created],
      appState: { selectedElementIds: ids },
      captureUpdate: UNDOABLE,
    });
    setBulk('');
    pop.close();
  }

  /** Reemplaza los stickies seleccionados con `change` aplicado (entra al deshacer). */
  async function updateSelected(change: (el: SceneEl) => SceneEl) {
    if (!api) return;
    const { UNDOABLE } = await import('./ExcalidrawCanvas');
    const ids = new Set(selection.map((e) => e.id));
    const next = (api.getSceneElementsIncludingDeleted() as SceneEl[]).map((el) => (ids.has(el.id) ? change(el) : el));
    api.updateScene({ elements: next, captureUpdate: UNDOABLE });
    refresh();
  }

  const selectionTags = cleanStickyTags(selection.flatMap((el) => stickyTags(el)));

  function addTag(raw: string) {
    const [tag] = cleanStickyTags([raw]);
    setTagDraft('');
    if (!tag) return;
    void updateSelected((el) => withStickyTags(el, [...stickyTags(el), tag]));
  }

  function selectTag(tag: string) {
    if (!api) return;
    const ids = stickiesWithTag(api.getSceneElements() as SceneEl[], tag);
    api.updateScene({ appState: { selectedElementIds: Object.fromEntries(ids.map((id) => [id, true])) } });
    const els = (api.getSceneElements() as SceneEl[]).filter((e) => ids.includes(e.id));
    if (els.length) api.scrollToContent(els, { fitToContent: true, animate: true });
    pop.close();
  }

  return (
    <div className="board-share-wrap board-tool-wrap" ref={pop.wrapRef}>
      <button
        ref={pop.buttonRef}
        type="button"
        className={`btn btn-sm${pop.open ? ' is-on' : ''}`}
        onClick={toggle}
        aria-expanded={pop.open}
        aria-haspopup="dialog"
        disabled={!api}
      >
        <NotesIcon name="sticky" size={14} />
        <span className="board-bar-label">{t('button')}</span>
      </button>
      {pop.open && (
        <div className="board-pop board-sticky-pop" role="dialog" aria-label={t('title')}>
          <p className="board-pop-title">{t('title')}</p>
          <div className="board-swatches" role="radiogroup" aria-label={t('color')}>
            {STICKY_COLORS.map((c) => (
              <button
                key={c.key}
                type="button"
                role="radio"
                aria-checked={color === c.key}
                className={`board-swatch${color === c.key ? ' is-on' : ''}`}
                style={{ background: c.fill }}
                aria-label={t(`colors.${c.key}`)}
                title={t(`colors.${c.key}`)}
                onClick={() => setColor(c.key)}
              />
            ))}
          </div>
          <button type="button" className="btn btn-sm btn-primary board-pop-start" onClick={() => void add([{ text: t('newText'), tags: [] }])}>
            <NotesIcon name="plus" size={14} />
            {t('add')}
          </button>

          {selection.length > 0 && (
            <div className="board-pop-section">
              <p className="board-pop-label">{t('selected', { count: selection.length })}</p>
              <div className="board-pop-actions">
                <button type="button" className="btn btn-sm" onClick={() => void updateSelected((el) => withFill(el, fill))}>
                  {t('applyColor')}
                </button>
              </div>
              <div className="board-tag-edit">
                {selectionTags.map((tg) => (
                  <span key={tg} className="board-tag is-edit">
                    #{tg}
                    <button
                      type="button"
                      onClick={() => void updateSelected((el) => withStickyTags(el, stickyTags(el).filter((x) => x !== tg)))}
                      aria-label={t('removeTag', { tag: tg })}
                    >
                      <NotesIcon name="close" size={11} />
                    </button>
                  </span>
                ))}
                <input
                  className="input board-tag-input"
                  value={tagDraft}
                  maxLength={40}
                  placeholder={t('addTag')}
                  aria-label={t('addTag')}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      addTag(tagDraft);
                    }
                  }}
                />
              </div>
            </div>
          )}

          <div className="board-pop-section">
            <label className="board-pop-label" htmlFor="board-sticky-bulk">
              {t('bulkTitle')}
            </label>
            <p className="board-pop-hint">{t('bulkHint', { max: STICKY_PASTE_MAX })}</p>
            <textarea
              id="board-sticky-bulk"
              className="input board-bulk"
              rows={4}
              value={bulk}
              onChange={(e) => setBulk(e.target.value)}
              placeholder={t('bulkPlaceholder')}
            />
            <input
              className="input"
              value={bulkTags}
              onChange={(e) => setBulkTags(e.target.value)}
              placeholder={t('bulkTags')}
              aria-label={t('bulkTags')}
              maxLength={200}
            />
            <button type="button" className="btn btn-sm board-pop-start" disabled={drafts.length === 0} onClick={() => void add(drafts)}>
              {t('bulkAdd', { count: drafts.length })}
            </button>
          </div>

          {boardTags.length > 0 && (
            <div className="board-pop-section">
              <p className="board-pop-label">{t('boardTags')}</p>
              <div className="board-tag-edit">
                {boardTags.map(({ tag, count }) => (
                  <button key={tag} type="button" className="board-tag is-pick" onClick={() => selectTag(tag)} title={t('selectTag', { tag })}>
                    #{tag} <span className="num">{count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
