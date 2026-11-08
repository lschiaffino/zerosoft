'use client';

import { forwardRef, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { DOCS_COLOR_NAMES, type DocsBlock, type DocsBlockColor, type DocsBlockType } from '@/lib/docs-types';
import type { PageLinkCandidate } from '@/lib/docs-page-links';
import DocsGlyph, { type DocsGlyphName } from './DocsGlyphs';
import DocsPageIcon from './DocsPageIcon';

export interface BlockMenuCommand {
  key: string;
  type: DocsBlockType;
  level?: 1 | 2 | 3;
  toggle?: boolean;
  linked?: boolean;
}

interface Action {
  id: string;
  label: string;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  run: () => void;
}

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD = MAC ? '⌘' : 'Ctrl+';

/** Minúsculas y sin tildes, para buscar en el menú. */
function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Menú del asa de un bloque, como el de Notion: buscador arriba (filtra
 * acciones y "Convertir en"), atajos al costado, color, "Mover a" otra
 * página, duplicar, copiar link, comentar, mover y borrar. ↑/↓ y Enter
 * eligen; Esc cierra.
 */
const DocsBlockMenu = forwardRef<
  HTMLDivElement,
  {
    block: DocsBlock;
    pageId: string | null;
    isText: boolean;
    turnInto: BlockMenuCommand[];
    commandIcon: (type: DocsBlockType) => DocsGlyphName;
    canMoveUp: boolean;
    canMoveDown: boolean;
    canDelete: boolean;
    onClose: () => void;
    onTurnInto: (cmd: BlockMenuCommand) => void;
    onColor: (color: DocsBlockColor | undefined) => void;
    onDuplicate: () => void;
    onCopyLink?: () => void;
    onInsertBelow: () => void;
    onComment?: () => void;
    onMoveUp: () => void;
    onMoveDown: () => void;
    onDelete: () => void;
    /** Mueve el bloque (con sus hijos) al final de otra página; false si no se pudo. */
    onMoveTo?: (page: PageLinkCandidate) => Promise<boolean>;
  }
>(function DocsBlockMenu(p, ref) {
  const t = useTranslations('docs');
  const [q, setQ] = useState('');
  const [sub, setSub] = useState<null | 'turn' | 'color' | 'move'>(null);
  const [active, setActive] = useState(0);
  const searchRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    searchRef.current?.focus({ preventScroll: true });
  }, []);

  const actions: Action[] = useMemo(() => {
    const list: Action[] = [];
    if (p.onMoveTo) list.push({ id: 'move', label: t('editor.blockMenu.moveTo'), hint: '', run: () => setSub('move') });
    list.push({ id: 'duplicate', label: t('editor.blockMenu.duplicate'), hint: `${MOD}D`, run: p.onDuplicate });
    if (p.onCopyLink) list.push({ id: 'copy', label: t('editor.blockMenu.copyLink'), run: p.onCopyLink });
    list.push({ id: 'below', label: t('editor.blockMenu.insertBelow'), run: p.onInsertBelow });
    if (p.onComment) list.push({ id: 'comment', label: t('editor.blockMenu.comment'), hint: `${MOD}⇧M`, run: p.onComment });
    list.push({ id: 'up', label: t('editor.blockMenu.moveUp'), hint: `${MOD}⇧↑`, disabled: !p.canMoveUp, run: p.onMoveUp });
    list.push({ id: 'down', label: t('editor.blockMenu.moveDown'), hint: `${MOD}⇧↓`, disabled: !p.canMoveDown, run: p.onMoveDown });
    list.push({ id: 'delete', label: t('editor.blockMenu.delete'), hint: MAC ? '⌫' : 'Del', danger: true, disabled: !p.canDelete, run: p.onDelete });
    return list;
  }, [p, t]);

  // Con texto en el buscador: lista plana de acciones, "Convertir en …" y colores que coinciden.
  const results: Action[] = useMemo(() => {
    const needle = fold(q.trim());
    if (!needle) return [];
    const out = actions.filter((a) => !a.disabled && fold(a.label).includes(needle));
    for (const c of p.turnInto) {
      const label = t(`editor.commands.${c.key}`);
      if (fold(label).includes(needle) || fold(t('editor.blockMenu.turnInto')).includes(needle))
        out.push({ id: `turn:${c.key}`, label: `${t('editor.blockMenu.turnInto')}: ${label}`, run: () => p.onTurnInto(c) });
    }
    if (p.isText)
      for (const c of DOCS_COLOR_NAMES) {
        const label = t(`editor.colors.${c}`);
        const bg = t(`editor.colors.bg_${c}`);
        if (fold(label).includes(needle) || fold(t('editor.blockMenu.color')).includes(needle)) out.push({ id: `color:${c}`, label: `${t('editor.blockMenu.color')}: ${label}`, run: () => p.onColor(c) });
        if (fold(bg).includes(needle)) out.push({ id: `color:${c}_bg`, label: `${t('editor.blockMenu.color')}: ${bg}`, run: () => p.onColor(`${c}_bg`) });
      }
    return out.slice(0, 30);
  }, [q, actions, p, t]);

  const flat = q.trim() ? results : actions.filter((a) => !a.disabled);
  useEffect(() => setActive(0), [q]);

  const runAction = (a: Action | undefined) => {
    if (!a || a.disabled) return;
    if (a.id === 'move') {
      setSub('move');
      return;
    }
    p.onClose();
    a.run();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (sub === 'move') return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!flat.length) return;
      setActive((n) => (e.key === 'ArrowDown' ? (n + 1) % flat.length : (n - 1 + flat.length) % flat.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runAction(flat[Math.min(active, flat.length - 1)]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (sub) setSub(null);
      else p.onClose();
    }
  };

  const item = (a: Action, i: number, extra?: ReactNode) => (
    <button
      key={a.id}
      type="button"
      role="menuitem"
      className={`docs-bmenu-item${a.danger ? ' docs-bmenu-danger' : ''}${flat[active]?.id === a.id ? ' is-active' : ''}`}
      disabled={a.disabled}
      onMouseEnter={() => setActive(i)}
      onClick={() => runAction(a)}
    >
      <span className="docs-bmenu-label">{a.label}</span>
      {extra}
      {a.hint && <kbd className="docs-bmenu-kbd">{a.hint}</kbd>}
    </button>
  );

  const caret = (
    <span className="docs-bmenu-caret" aria-hidden>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 6l6 6-6 6" />
      </svg>
    </span>
  );

  return (
    <div className="docs-block-menu" ref={ref} data-no-drag role="menu" aria-label={t('editor.blockMenu.title')} onKeyDown={onKey}>
      <input
        ref={searchRef}
        className="docs-bmenu-search"
        value={q}
        placeholder={t('editor.blockMenu.search')}
        aria-label={t('editor.blockMenu.search')}
        onChange={(e) => {
          setQ(e.target.value);
          setSub(null);
        }}
      />
      {q.trim() ? (
        results.length ? results.map((a, i) => item(a, i)) : <p className="docs-bmenu-empty">{t('editor.blockMenu.noResults')}</p>
      ) : (
        <>
          <div className="docs-bmenu-turninto">
            <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={sub === 'turn'} className="docs-bmenu-item" onClick={() => setSub(sub === 'turn' ? null : 'turn')}>
              <span className="docs-bmenu-label">{t('editor.blockMenu.turnInto')}</span>
              {caret}
            </button>
            {sub === 'turn' && (
              <div className="docs-bmenu-sub" role="menu">
                {p.turnInto.map((cmd) => (
                  <button
                    key={cmd.key}
                    type="button"
                    role="menuitem"
                    className="docs-bmenu-item"
                    onClick={() => {
                      p.onClose();
                      p.onTurnInto(cmd);
                    }}
                  >
                    <span className="docs-command-icon">
                      <DocsGlyph name={p.commandIcon(cmd.type)} size={14} />
                    </span>
                    <span className="docs-command-label">{t(`editor.commands.${cmd.key}`)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {p.isText && (
            <div className="docs-bmenu-turninto">
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={sub === 'color'}
                className="docs-bmenu-item"
                data-testid="docs-bmenu-color"
                onClick={() => setSub(sub === 'color' ? null : 'color')}
              >
                <span className="docs-bmenu-label">{t('editor.blockMenu.color')}</span>
                {caret}
              </button>
              {sub === 'color' && (
                <div className="docs-bmenu-sub docs-bmenu-colors" role="menu">
                  <div className="docs-command-title">{t('editor.colors.text')}</div>
                  {[undefined, ...DOCS_COLOR_NAMES].map((c) => (
                    <button
                      key={c ?? 'default'}
                      type="button"
                      role="menuitemradio"
                      aria-checked={(p.block.color ?? undefined) === c}
                      className="docs-bmenu-item"
                      onClick={() => {
                        p.onClose();
                        p.onColor(c);
                      }}
                    >
                      <span className="docs-color-swatch" data-color={c ?? 'default'} aria-hidden>
                        A
                      </span>
                      {t(`editor.colors.${c ?? 'default'}`)}
                    </button>
                  ))}
                  <div className="docs-command-title">{t('editor.colors.background')}</div>
                  {DOCS_COLOR_NAMES.map((c) => (
                    <button
                      key={`${c}_bg`}
                      type="button"
                      role="menuitemradio"
                      aria-checked={p.block.color === `${c}_bg`}
                      className="docs-bmenu-item"
                      onClick={() => {
                        p.onClose();
                        p.onColor(`${c}_bg`);
                      }}
                    >
                      <span className="docs-color-swatch" data-color={`${c}_bg`} aria-hidden>
                        A
                      </span>
                      {t(`editor.colors.bg_${c}`)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {actions.map((a, i) => {
            const idx = flat.findIndex((f) => f.id === a.id);
            const el = item(a, idx === -1 ? i : idx, a.id === 'move' ? caret : undefined);
            return (
              <div key={a.id} className={a.id === 'move' ? 'docs-bmenu-turninto' : 'docs-bmenu-row'}>
                {a.id === 'delete' && <hr className="docs-bmenu-divider" />}
                {el}
                {a.id === 'move' && sub === 'move' && p.onMoveTo && <MoveToPicker pageId={p.pageId} onPick={p.onMoveTo} onClose={p.onClose} />}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
});

export default DocsBlockMenu;

/** Buscador de páginas para "Mover a": sin texto, las recientes. */
function MoveToPicker({ pageId, onPick, onClose }: { pageId: string | null; onPick: (page: PageLinkCandidate) => Promise<boolean>; onClose: () => void }) {
  const t = useTranslations('docs');
  const [q, setQ] = useState('');
  const [pages, setPages] = useState<PageLinkCandidate[] | null>(null);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(() => {
      fetch(q.trim() ? `/api/docs/search?q=${encodeURIComponent(q.trim())}` : '/api/docs/search?recent=1')
        .then((r) => (r.ok ? r.json() : { rows: [] }))
        .then((d: { rows?: PageLinkCandidate[] }) => {
          if (alive) setPages((d.rows ?? []).filter((x) => x.id !== pageId && !x.row_id).slice(0, 8));
        })
        .catch(() => alive && setPages([]));
    }, 120);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [q, pageId]);
  useEffect(() => setActive(0), [q]);
  const pick = async (page: PageLinkCandidate | undefined) => {
    if (!page || busy) return;
    setBusy(true);
    setFailed(false);
    const ok = await onPick(page);
    setBusy(false);
    if (ok) onClose();
    else setFailed(true);
  };
  const list = pages ?? [];
  return (
    <div className="docs-bmenu-sub docs-bmenu-move" role="dialog" aria-label={t('editor.blockMenu.moveTo')}>
      <input
        ref={inputRef}
        className="docs-bmenu-search"
        value={q}
        placeholder={t('editor.blockMenu.moveToSearch')}
        aria-label={t('editor.blockMenu.moveToSearch')}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation();
            if (list.length) setActive((n) => (e.key === 'ArrowDown' ? (n + 1) % list.length : (n - 1 + list.length) % list.length));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            void pick(list[Math.min(active, list.length - 1)]);
          }
        }}
      />
      {pages === null ? (
        <p className="docs-bmenu-empty" aria-busy="true">
          <span className="ui-skeleton ui-skeleton-text" />
        </p>
      ) : list.length === 0 ? (
        <p className="docs-bmenu-empty">{t('mentions.noPages')}</p>
      ) : (
        list.map((page, i) => (
          <button
            key={page.id}
            type="button"
            className={`docs-bmenu-item${i === active ? ' is-active' : ''}`}
            disabled={busy}
            data-testid="docs-move-to-option"
            onMouseEnter={() => setActive(i)}
            onClick={() => void pick(page)}
          >
            <span className="docs-command-icon">{page.icon ? <DocsPageIcon icon={page.icon} pageId={page.id} size={14} /> : <DocsGlyph name="page" size={14} />}</span>
            <span className="docs-bmenu-label">{page.title || t('untitled')}</span>
          </button>
        ))
      )}
      {failed && (
        <p className="docs-bmenu-empty" role="alert">
          {t('editor.blockMenu.moveFailed')}
        </p>
      )}
    </div>
  );
}
