'use client';

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useTranslations } from 'next-intl';
import { createPortal } from 'react-dom';
import { Link } from '@/i18n/navigation';
import {
  defaultBlocks,
  defaultDatabaseColumns,
  type DocsBlock,
  type DocsBlockType,
  type DocsMentionableUser,
  type DocsPage,
} from '@/lib/docs-types';
import {
  getCaretOffset,
  getCaretViewportRect,
  getSelectionOffsets,
  setCaretOffset,
  setSelectionOffsets,
} from '@/lib/docs-caret';
import {
  escapeHtml,
  getLinkAt,
  htmlToFlatText,
  insertTextAtOffset,
  isRangeFullyMarked,
  removeHtmlRange,
  splitHtmlAt,
  toggleMark,
  unwrapLink,
  upgradeToHtml,
  wrapLink,
  type DocsMarkTag,
} from '@/lib/docs-richtext';
import DocsBlockEditor from './DocsBlockEditor';
import MentionPopover from './MentionPopover';
import UserMentionPopover from './UserMentionPopover';
import EmojiPicker from './EmojiPicker';
import DocsGlyph, { type DocsGlyphName } from './DocsGlyphs';

interface DocsEditorProps {
  page: DocsPage;
  ancestors: DocsPage[];
  /** Guarda solo lo que edita el editor (no pisa archived/is_public). */
  onSave: (patch: Partial<DocsPage>) => void;
  saving?: boolean;
  /** El último guardado falló: se muestra en lugar de "Guardado", con reintento. */
  saveError?: 'tooLong' | 'failed' | 'conflict' | null;
  onDuplicate?: () => void;
  onDelete?: () => void;
  onAddComment?: () => void;
  /** Cantidad de comentarios por block_id (para el badge). */
  commentCounts?: Record<string, number>;
  /** Abre el panel de comentarios anclado al bloque. */
  onBlockComment?: (blockId: string) => void;
  /**
   * Modo embebido (lo usa Notes): solo título + bloques. Sin barra de página,
   * portada, ícono ni menciones [[ / @ (que apuntan a páginas y miembros de Docs).
   */
  embedded?: boolean;
  /** Acciones extra en la barra superior (Share, Comments). */
  topActions?: ReactNode;
  /** Items extra del menú "···" (export, versiones). Reciben un cierre del menú. */
  menuExtra?: (close: () => void) => ReactNode;
  /** Muestra los toggles de layout (texto chico / ancho completo); solo el dueño. */
  layoutToggles?: boolean;
}

const BLOCK_COMMANDS: {
  key: string;
  type: DocsBlockType;
  level?: 1 | 2 | 3;
  shortcut?: string;
}[] = [
  { key: 'p', type: 'paragraph' },
  { key: 'h1', type: 'heading', level: 1, shortcut: '#' },
  { key: 'h2', type: 'heading', level: 2, shortcut: '##' },
  { key: 'h3', type: 'heading', level: 3, shortcut: '###' },
  { key: 'bulleted', type: 'bulleted_list_item', shortcut: '-' },
  { key: 'numbered', type: 'numbered_list_item', shortcut: '1.' },
  { key: 'todo', type: 'todo', shortcut: '[ ]' },
  { key: 'quote', type: 'quote', shortcut: '>' },
  { key: 'code', type: 'code', shortcut: '```' },
  { key: 'divider', type: 'divider' },
  { key: 'table', type: 'table' },
  { key: 'database', type: 'database' },
];

/** Keywords extra para matchear el menú `/` (el label traducido no alcanza: "To-do" ≠ "todo"). */
const COMMAND_KEYWORDS: Record<string, string[]> = {
  p: ['text', 'plain', 'paragraph', 'p'],
  h1: ['h1', 'heading', 'heading 1', 'title', '#'],
  h2: ['h2', 'heading', 'heading 2', 'subtitle', '##'],
  h3: ['h3', 'heading', 'heading 3', '###'],
  bulleted: ['bullet', 'bulleted', 'list', 'ul', 'unordered', '-'],
  numbered: ['numbered', 'list', 'ol', 'ordered', '1.', 'number'],
  todo: ['todo', 'to-do', 'task', 'check', 'checkbox', 'checklist', '[]', '[ ]'],
  quote: ['quote', 'blockquote', 'citation', '>'],
  code: ['code', 'snippet', 'pre', '```'],
  divider: ['divider', 'hr', 'line', 'separator', '---'],
  table: ['table', 'grid'],
  database: ['database', 'db', 'table', 'grid', 'view', 'data'],
};

const BLOCK_ICONS: Record<DocsBlockType, DocsGlyphName> = {
  paragraph: 'paragraph',
  heading: 'heading',
  bulleted_list_item: 'bulleted',
  numbered_list_item: 'numbered',
  todo: 'todo',
  quote: 'quote',
  code: 'code',
  divider: 'divider',
  table: 'table',
  database: 'database',
};

const LIST_TYPES: DocsBlockType[] = ['bulleted_list_item', 'numbered_list_item', 'todo'];

/** px antes de activar el drag del bloque (permite click normal en el grip). */
const DRAG_THRESHOLD = 6;

/** Estado del drag de reordenamiento de bloques (pointer events, sin deps). */
interface BlockDragState {
  pointerId: number;
  index: number;
  startX: number;
  startY: number;
  dragging: boolean;
  ghostEl: HTMLElement | null;
  offsetY: number;
  /** Posición de inserción (antes del bloque en ese índice; = length para el final). */
  dropIndex: number;
}

/** Bloques cuyo contenido es texto editable en línea (no divider/table/database). */
function isTextBlockType(type: DocsBlockType): boolean {
  return type !== 'divider' && type !== 'table' && type !== 'database';
}

/**
 * Contenido cargado de la DB → modelo HTML-lite: el texto plano viejo se
 * escapa y lo que ya trae tags del subset se sanitiza (una sola vez por carga).
 * En SSR no hay DOM: se deja tal cual (el primer render cliente lo normaliza).
 */
function upgradeBlocks(list: DocsBlock[]): DocsBlock[] {
  if (typeof window === 'undefined') return list;
  return list.map((b) =>
    isTextBlockType(b.type) && b.content ? { ...b, content: upgradeToHtml(b.content) } : b,
  );
}

/** Atajos markdown al inicio de un párrafo: "# ", "- ", "1. ", "[] ", "> ". */
function matchMarkdownPrefix(text: string): { type: DocsBlockType; level?: 1 | 2 | 3 } | null {
  if (text === '#') return { type: 'heading', level: 1 };
  if (text === '##') return { type: 'heading', level: 2 };
  if (text === '###') return { type: 'heading', level: 3 };
  if (text === '-' || text === '*') return { type: 'bulleted_list_item' };
  if (/^\d+\.$/.test(text)) return { type: 'numbered_list_item' };
  if (text === '[]' || text === '[ ]') return { type: 'todo' };
  if (text === '>') return { type: 'quote' };
  return null;
}

/** Rect del caret (coordenadas de viewport) donde se abrió un trigger (/, [[, @). */
interface CaretMenuPos {
  left: number;
  top: number;
  bottom: number;
}

/**
 * Estilo fijo (viewport) para un menú anclado al caret, estilo Notion: borde
 * izquierdo en la x del caret, debajo de la línea; si no entra, se ancla por
 * `bottom` arriba del caret (así el borde visible queda pegado al caret sin
 * importar la altura real). Siempre dentro del viewport (mobile incluido):
 * `left` y `maxHeight` se clampean a los márgenes disponibles.
 */
function caretMenuStyle(pos: CaretMenuPos, width: number, maxHeight: number): CSSProperties {
  if (typeof window === 'undefined') return { display: 'none' };
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(width, vw - 16);
  const left = Math.max(8, Math.min(pos.left, vw - w - 8));
  const spaceBelow = vh - pos.bottom - 8;
  const spaceAbove = pos.top - 8;
  if (spaceBelow >= maxHeight || spaceBelow >= spaceAbove) {
    return {
      position: 'fixed',
      left,
      top: pos.bottom + 6,
      width: w,
      maxHeight: Math.max(120, spaceBelow - 6),
    };
  }
  return {
    position: 'fixed',
    left,
    bottom: vh - pos.top + 6,
    width: w,
    maxHeight: Math.max(120, spaceAbove - 6),
  };
}

export default function DocsEditor({
  page,
  ancestors,
  onSave,
  saving,
  saveError,
  onDuplicate,
  onDelete,
  onAddComment,
  commentCounts,
  onBlockComment,
  embedded = false,
  topActions,
  menuExtra,
  layoutToggles = true,
}: DocsEditorProps) {
  const t = useTranslations('docs');
  const [blocks, setBlocks] = useState<DocsBlock[]>(() =>
    upgradeBlocks(page.content.length ? page.content : defaultBlocks()),
  );
  const [title, setTitle] = useState(page.title);
  const [icon, setIcon] = useState(page.icon ?? '');
  const [coverUrl, setCoverUrl] = useState(page.cover_url ?? '');
  const [smallText, setSmallText] = useState(!!page.small_text);
  const [fullWidth, setFullWidth] = useState(!!page.full_width);
  const [focusIndex, setFocusIndex] = useState<number>(0);
  /** Fuerza una corrida del efecto de foco aunque focusIndex/blocks no cambien de referencia. */
  const [focusTick, setFocusTick] = useState(0);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdQuery, setCmdQuery] = useState('');
  const [cmdSel, setCmdSel] = useState(0);
  /** Rango del `/query` tipeado: se borra al aplicar un comando sin tocar el resto del texto. */
  const [slash, setSlash] = useState<{ index: number; start: number; end: number } | null>(null);
  /** Trigger `[[` activo: rango plano [start, end) del `[[query` + query actual. */
  const [mention, setMention] = useState<{
    index: number;
    query: string;
    start: number;
    end: number;
  } | null>(null);
  /** Trigger `@` activo: rango plano [start, end) del `@query` + query actual. */
  const [userMention, setUserMention] = useState<{
    index: number;
    query: string;
    start: number;
    end: number;
  } | null>(null);
  /** Rect del caret donde se abrió el trigger activo (ancla de los menús flotantes). */
  const [caretMenuPos, setCaretMenuPos] = useState<CaretMenuPos | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Guardado pendiente (debounce): se ejecuta ya si el usuario sale de la página. */
  const pendingSave = useRef<(() => void) | null>(null);
  const [dirty, setDirty] = useState(false);
  const blockRefs = useRef<(HTMLDivElement | null)[]>([]);
  const titleRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const coverRef = useRef<HTMLDivElement>(null);
  /** Caret pendiente de aplicar después del próximo render (split/merge/conversión). */
  const pendingCaret = useRef<{ index: number; offset: number } | null>(null);
  /** Último índice enfocado conocido, para no re-mover el caret en cada render. */
  // En el teléfono no se enfoca el primer bloque al abrir: el asa y el "+"
  // aparecen recién cuando la persona toca un bloque.
  const prevFocus = useRef<number>(
    typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches ? 0 : -1,
  );
  /** Índice del bloque con menú contextual abierto (click en el grip ⋮⋮). */
  const [blockMenu, setBlockMenu] = useState<number | null>(null);
  const [turnIntoOpen, setTurnIntoOpen] = useState(false);
  /** Índice del bloque que se está arrastrando (para atenuarlo). */
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  /** Top (px, relativo a .docs-blocks) de la línea indicadora de drop; null si no hay drag. */
  const [dropLine, setDropLine] = useState<number | null>(null);
  const dragRef = useRef<BlockDragState | null>(null);
  /** El click posterior a un drag no debe abrir el menú. */
  const suppressGripClick = useRef(false);
  const blocksWrapRef = useRef<HTMLDivElement | null>(null);
  const blockMenuRef = useRef<HTMLDivElement | null>(null);
  /** Selección pendiente de restaurar tras aplicar formato (toggle de marca). */
  const pendingSelection = useRef<{ index: number; start: number; end: number } | null>(null);
  /** Toolbar flotante de formato: selección no colapsada dentro de un bloque. */
  const [toolbar, setToolbar] = useState<{
    index: number;
    start: number;
    end: number;
    top: number;
    left: number;
  } | null>(null);
  /** Popover de link: offsets de texto plano ya capturados + href de prefill. */
  const [linkDialog, setLinkDialog] = useState<{
    index: number;
    start: number;
    end: number;
    href: string;
    top: number;
    left: number;
  } | null>(null);
  const linkPopoverRef = useRef<HTMLDivElement | null>(null);
  const linkInputRef = useRef<HTMLInputElement | null>(null);
  /** Espejo del estado para el listener de selectionchange (sin re-suscribir). */
  const linkDialogRef = useRef(linkDialog);
  linkDialogRef.current = linkDialog;

  useEffect(() => {
    setBlocks(upgradeBlocks(page.content.length ? page.content : defaultBlocks()));
    setTitle(page.title);
    setIcon(page.icon ?? '');
    setCoverUrl(page.cover_url ?? '');
    setBlockMenu(null);
    setToolbar(null);
    setLinkDialog(null);
    // Solo al cambiar de página: re-sincronizar con cada prop pisaría lo que se está escribiendo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id]);

  // No perder lo último tipeado: al salir de la página (navegación interna,
  // cerrar pestaña) se ejecuta el guardado pendiente en vez de descartarlo.
  useEffect(() => {
    const flush = () => {
      if (saveTimeout.current) clearTimeout(saveTimeout.current);
      pendingSave.current?.();
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [page.id]);

  // Página nueva (sin título): el foco va al título, como en Notion.
  useEffect(() => {
    if (page.title) return;
    const id = requestAnimationFrame(() => titleRef.current?.focus());
    return () => cancelAnimationFrame(id);
    // Solo al abrir la página.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id]);

  // Sincroniza el título (contentEditable) solo cuando cambió por fuera del tipeo.
  useEffect(() => {
    const el = titleRef.current;
    if (el && el.textContent !== title) {
      el.textContent = title;
    }
  }, [title]);

  // Foco/caret: si hay una selección pendiente (formato aplicado por toolbar o
  // atajo) se restaura después de que los hijos sincronizaron innerHTML; si hay
  // un caret pendiente (split, merge, markdown, slash) igual; si no, solo se
  // mueve el caret al final cuando el foco cambió de bloque de verdad (no al
  // tipear, no al hacer click dentro del bloque ya enfocado).
  useLayoutEffect(() => {
    const pendingSel = pendingSelection.current;
    if (pendingSel) {
      pendingSelection.current = null;
      const el = blockRefs.current[pendingSel.index];
      if (el) {
        el.focus();
        setSelectionOffsets(el, pendingSel.start, pendingSel.end);
      }
      prevFocus.current = pendingSel.index;
      return;
    }
    const pending = pendingCaret.current;
    if (pending) {
      pendingCaret.current = null;
      const el = blockRefs.current[pending.index];
      if (el) {
        el.focus();
        setCaretOffset(el, pending.offset);
      }
      prevFocus.current = pending.index;
      return;
    }
    if (prevFocus.current !== focusIndex) {
      prevFocus.current = focusIndex;
      const el = blockRefs.current[focusIndex];
      if (el) {
        el.focus();
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  }, [focusIndex, blocks, focusTick]);

  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
    const onClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [menuOpen]);

  useEffect(() => {
    if (!coverOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!coverRef.current?.contains(e.target as Node)) setCoverOpen(false);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [coverOpen]);

  // Menú contextual de bloque: cierra con Esc o click afuera (el click en otro
  // grip lo maneja el propio grip, que togglea).
  useEffect(() => {
    if (blockMenu === null) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('.docs-block-grip')) return;
      if (blockMenuRef.current?.contains(target)) return;
      setBlockMenu(null);
      setTurnIntoOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setBlockMenu(null);
        setTurnIntoOpen(false);
      }
    };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [blockMenu]);

  // Toolbar flotante de formato: aparece con selección no colapsada dentro de
  // un bloque de texto (nunca en código) y sigue la posición del rango.
  useEffect(() => {
    const update = () => {
      if (linkDialogRef.current) return; // el popover de link tiene el foco
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        setToolbar(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const node = range.commonAncestorContainer;
      const host = (node.nodeType === Node.ELEMENT_NODE
        ? (node as Element)
        : node.parentElement
      )?.closest('.docs-editable');
      if (!host || !blocksWrapRef.current?.contains(host)) {
        setToolbar(null);
        return;
      }
      if (host.classList.contains('docs-code')) {
        setToolbar(null);
        return;
      }
      const indexAttr = host.closest('.docs-block')?.getAttribute('data-index');
      const offsets = getSelectionOffsets(host as HTMLElement);
      if (indexAttr == null || !offsets || offsets.end <= offsets.start) {
        setToolbar(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      const center = rect.left + rect.width / 2;
      const left = Math.max(110, Math.min(window.innerWidth - 110, center));
      const top = rect.top > 64 ? rect.top - 46 : rect.bottom + 8;
      setToolbar({ index: Number(indexAttr), start: offsets.start, end: offsets.end, top, left });
    };
    document.addEventListener('selectionchange', update);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      document.removeEventListener('selectionchange', update);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, []);

  // Popover de link: cierra con click afuera.
  useEffect(() => {
    if (!linkDialog) return;
    const onDown = (e: MouseEvent) => {
      if (linkPopoverRef.current?.contains(e.target as Node)) return;
      setLinkDialog(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [linkDialog]);

  /** Rect del caret actual; si el browser no da rect (bloque vacío), el del bloque. */
  const readCaretMenuPos = useCallback((index: number): CaretMenuPos | null => {
    const rect = getCaretViewportRect();
    if (rect) return rect;
    const el = blockRefs.current[index];
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { left: b.left, top: b.top, bottom: b.bottom };
  }, []);

  // Menús anclados al caret (/, [[, @): siguen al caret al scrollear o
  // redimensionar mientras el foco sigue en un bloque editable.
  const anyCaretMenuOpen = cmdOpen || mention !== null || userMention !== null;
  useEffect(() => {
    if (!anyCaretMenuOpen) return;
    const update = () => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !active.classList.contains('docs-editable')) return;
      const rect = getCaretViewportRect();
      if (rect) setCaretMenuPos(rect);
    };
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [anyCaretMenuOpen]);

  // El item seleccionado del menú `/` queda visible dentro del scroll.
  useEffect(() => {
    if (!cmdOpen) return;
    document
      .querySelector('.docs-command-menu .docs-command-item.sel')
      ?.scrollIntoView({ block: 'nearest' });
  }, [cmdOpen, cmdSel]);

  // Limpieza del DOM de drag si el componente se desmonta a mitad de un drag.
  useEffect(() => {
    return () => {
      dragRef.current?.ghostEl?.remove();
      dragRef.current = null;
    };
  }, []);

  const triggerSave = useCallback(
    (
      nextBlocks?: DocsBlock[],
      nextTitle?: string,
      nextIcon?: string,
      nextCover?: string | null,
    ) => {
      if (saveTimeout.current) clearTimeout(saveTimeout.current);
      const run = () => {
        pendingSave.current = null;
        saveTimeout.current = null;
        setDirty(false);
        onSave({
          title: nextTitle ?? title,
          icon: (nextIcon ?? icon) || null,
          cover_url: nextCover === '' ? null : (nextCover ?? coverUrl),
          content: nextBlocks ?? blocks,
        });
      };
      pendingSave.current = run;
      setDirty(true);
      saveTimeout.current = setTimeout(run, 600);
    },
    [blocks, coverUrl, icon, onSave, title],
  );

  const updateBlock = useCallback(
    (index: number, patch: Partial<DocsBlock>) => {
      setBlocks((prev) => {
        const next = prev.map((b, i) => (i === index ? { ...b, ...patch } : b));
        triggerSave(next);
        return next;
      });
    },
    [triggerSave],
  );

  const insertBlock = useCallback(
    (index: number, type: DocsBlockType, level?: 1 | 2 | 3) => {
      const newBlock: DocsBlock = {
        id: crypto.randomUUID(),
        type,
        content: '',
        level,
      };
      setBlocks((prev) => {
        const next = [...prev.slice(0, index + 1), newBlock, ...prev.slice(index + 1)];
        triggerSave(next);
        return next;
      });
      setCmdOpen(false);
      setCmdQuery('');
      setSlash(null);
      setMention(null);
      setUserMention(null);
      setFocusIndex(index + 1);
    },
    [triggerSave],
  );

  const removeBlock = useCallback(
    (index: number) => {
      setBlocks((prev) => {
        if (prev.length <= 1) return prev;
        const next = prev.filter((_, i) => i !== index);
        triggerSave(next);
        return next;
      });
      setFocusIndex(Math.max(0, index - 1));
    },
    [triggerSave],
  );

  /** Intercambia el bloque con su vecino (dir = -1 arriba, +1 abajo). */
  const moveBlock = useCallback(
    (index: number, dir: -1 | 1) => {
      setBlocks((prev) => {
        const target = index + dir;
        if (index < 0 || index >= prev.length || target < 0 || target >= prev.length) return prev;
        const next = [...prev];
        [next[index], next[target]] = [next[target], next[index]];
        triggerSave(next);
        return next;
      });
    },
    [triggerSave],
  );

  /** Duplica el bloque (id nuevo, filas/columnas copiadas) justo debajo. */
  const duplicateBlock = useCallback(
    (index: number) => {
      setBlocks((prev) => {
        const src = prev[index];
        if (!src) return prev;
        const copy: DocsBlock = {
          ...src,
          id: crypto.randomUUID(),
          rows: src.rows?.map((r) => [...r]),
          columns: src.columns?.map((c) => ({ ...c })),
        };
        const next = [...prev.slice(0, index + 1), copy, ...prev.slice(index + 1)];
        triggerSave(next);
        return next;
      });
    },
    [triggerSave],
  );

  // ---------- Drag & drop de bloques (pointer events, patrón del DealsBoard) ----------

  const cleanupDrag = useCallback((d: BlockDragState | null) => {
    d?.ghostEl?.remove();
    setDragIndex(null);
    setDropLine(null);
  }, []);

  const handleGripPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>, index: number) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const gripEl = e.currentTarget;
    try {
      gripEl.setPointerCapture(e.pointerId);
    } catch {
      return;
    }
    dragRef.current = {
      pointerId: e.pointerId,
      index,
      startX: e.clientX,
      startY: e.clientY,
      dragging: false,
      ghostEl: null,
      offsetY: 0,
      dropIndex: index,
    };
  }, []);

  const startBlockDrag = useCallback(
    (d: BlockDragState, e: ReactPointerEvent<HTMLElement>) => {
      const container = blocksWrapRef.current;
      const outer = container?.querySelectorAll<HTMLElement>(':scope > .docs-block-outer')[
        d.index
      ];
      if (!container || !outer) return;
      d.dragging = true;
      setBlockMenu(null);
      setTurnIntoOpen(false);
      const rect = outer.getBoundingClientRect();
      d.offsetY = e.clientY - rect.top;
      const ghost = outer.cloneNode(true) as HTMLElement;
      ghost.classList.add('docs-drag-ghost');
      ghost.style.width = `${rect.width}px`;
      ghost.style.left = `${rect.left}px`;
      ghost.style.top = `${rect.top}px`;
      document.body.appendChild(ghost);
      d.ghostEl = ghost;
      d.dropIndex = d.index;
      setDragIndex(d.index);
    },
    [],
  );

  const updateBlockDrag = useCallback((d: BlockDragState, e: ReactPointerEvent<HTMLElement>) => {
    if (d.ghostEl) {
      d.ghostEl.style.top = `${e.clientY - d.offsetY}px`;
    }
    const container = blocksWrapRef.current;
    if (!container) return;
    const outers = Array.from(
      container.querySelectorAll<HTMLElement>(':scope > .docs-block-outer'),
    );
    if (!outers.length) return;
    // dropIndex = primer bloque cuyo centro vertical esté por debajo del pointer.
    let dropIndex = outers.length;
    for (let i = 0; i < outers.length; i++) {
      const r = outers[i].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) {
        dropIndex = i;
        break;
      }
    }
    d.dropIndex = dropIndex;
    const top =
      dropIndex < outers.length
        ? outers[dropIndex].offsetTop - 4
        : outers[outers.length - 1].offsetTop + outers[outers.length - 1].offsetHeight + 2;
    setDropLine(top);
  }, []);

  const handleGripPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      if (!d.dragging) {
        if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD) return;
        startBlockDrag(d, e);
        if (!d.dragging) return; // no se encontró el bloque: abortar
      }
      updateBlockDrag(d, e);
    },
    [startBlockDrag, updateBlockDrag],
  );

  const finishBlockDrag = useCallback(
    (d: BlockDragState) => {
      const from = d.index;
      const dropIndex = d.dropIndex;
      // Mismo lugar (antes de sí mismo o del que le seguía): no-op.
      if (dropIndex === from || dropIndex === from + 1) return;
      setBlocks((prev) => {
        if (from < 0 || from >= prev.length) return prev;
        const next = [...prev];
        const [moved] = next.splice(from, 1);
        let insertAt = dropIndex > from ? dropIndex - 1 : dropIndex;
        insertAt = Math.max(0, Math.min(insertAt, next.length));
        next.splice(insertAt, 0, moved);
        triggerSave(next);
        return next;
      });
    },
    [triggerSave],
  );

  const handleGripPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      if (d.dragging) {
        // El click posterior al drag no debe abrir el menú contextual.
        suppressGripClick.current = true;
        finishBlockDrag(d);
      }
      cleanupDrag(d);
      dragRef.current = null;
    },
    [cleanupDrag, finishBlockDrag],
  );

  const handleGripPointerCancel = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      cleanupDrag(d);
      dragRef.current = null;
    },
    [cleanupDrag],
  );

  /** Click simple en el grip (sin drag): toggle del menú contextual del bloque. */
  const handleGripClick = useCallback((index: number) => {
    if (suppressGripClick.current) {
      suppressGripClick.current = false;
      return;
    }
    setTurnIntoOpen(false);
    setBlockMenu((prev) => (prev === index ? null : index));
  }, []);

  const closeBlockMenu = useCallback(() => {
    setBlockMenu(null);
    setTurnIntoOpen(false);
  }, []);

  // ---------- Formato en línea (fase C): toolbar flotante + atajos ----------

  /** Toggle de una marca sobre el rango de texto plano [start, end) del bloque. */
  const applyMark = useCallback(
    (index: number, start: number, end: number, tag: DocsMarkTag) => {
      const block = blocks[index];
      if (!block || block.type === 'code') return;
      const next = toggleMark(block.content, tag, start, end);
      if (next === block.content) return;
      updateBlock(index, { content: next });
      pendingSelection.current = { index, start, end };
      prevFocus.current = index;
      setFocusIndex(index);
      setFocusTick((v) => v + 1);
    },
    [blocks, updateBlock],
  );

  /** Abre el popover de link con la selección actual del bloque enfocado. */
  const openLinkDialog = useCallback(
    (index: number) => {
      const block = blocks[index];
      const el = blockRefs.current[index];
      if (!block || !el || block.type === 'code') return;
      const offsets = getSelectionOffsets(el);
      if (!offsets) return;
      const link = getLinkAt(block.content, offsets.start, offsets.end);
      const start = link?.start ?? offsets.start;
      const end = link?.end ?? offsets.end;
      if (end <= start) return; // nada seleccionado y caret fuera de un link
      const sel = window.getSelection();
      const rect = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).getBoundingClientRect() : null;
      const left = rect
        ? Math.max(140, Math.min(window.innerWidth - 140, rect.left + rect.width / 2))
        : window.innerWidth / 2;
      const top = rect ? (rect.top > 76 ? rect.top - 52 : rect.bottom + 8) : 120;
      setToolbar(null);
      setLinkDialog({ index, start, end, href: link?.href ?? '', top, left });
    },
    [blocks],
  );

  /** Aplica el href del popover al rango capturado (wrapLink sanea el scheme). */
  const applyLink = useCallback(
    (dialog: NonNullable<typeof linkDialog>, rawHref: string) => {
      const block = blocks[dialog.index];
      setLinkDialog(null);
      if (!block) return;
      let href = rawHref.trim();
      if (href && !/^(https?:\/\/|mailto:|tel:|\/|#)/i.test(href)) href = `https://${href}`;
      const next = href ? wrapLink(block.content, dialog.start, dialog.end, href) : block.content;
      if (next !== block.content) updateBlock(dialog.index, { content: next });
      pendingCaret.current = { index: dialog.index, offset: dialog.end };
      setFocusIndex(dialog.index);
      setFocusTick((v) => v + 1);
    },
    [blocks, updateBlock],
  );

  /** Quita el link del rango capturado conservando texto y demás marcas. */
  const removeLink = useCallback(
    (dialog: NonNullable<typeof linkDialog>) => {
      const block = blocks[dialog.index];
      setLinkDialog(null);
      if (!block) return;
      const next = unwrapLink(block.content, dialog.start, dialog.end);
      if (next !== block.content) updateBlock(dialog.index, { content: next });
      pendingCaret.current = { index: dialog.index, offset: dialog.end };
      setFocusIndex(dialog.index);
      setFocusTick((v) => v + 1);
    },
    [blocks, updateBlock],
  );

  /**
   * Convierte el bloque a otro tipo SIN borrar el contenido (salvo que se pase
   * `content` explícito, ej. el texto ya limpio del `/query` o del atajo md).
   */
  const convertBlock = useCallback(
    (index: number, type: DocsBlockType, level?: 1 | 2 | 3, content?: string, caretOffset = 0) => {
      setBlocks((prev) => {
        const next = prev.map((b, i) => {
          if (i !== index) return b;
          const converted: DocsBlock = {
            ...b,
            type,
            level,
            content: content !== undefined ? content : b.content,
          };
          if (type === 'todo') converted.checked = converted.checked ?? false;
          // Code es texto plano (pre-wrap): sin marcas en línea dentro.
          if (type === 'code') converted.content = escapeHtml(htmlToFlatText(converted.content));
          // Database: inicializa columnas tipadas y una fila vacía.
          if (type === 'database' && !converted.columns?.length) {
            converted.columns = defaultDatabaseColumns();
            converted.rows = converted.rows?.length
              ? converted.rows
              : [new Array(converted.columns.length).fill('')];
          }
          return converted;
        });
        triggerSave(next);
        return next;
      });
      setCmdOpen(false);
      setCmdQuery('');
      setCmdSel(0);
      setSlash(null);
      setMention(null);
      setUserMention(null);
      pendingCaret.current = { index, offset: caretOffset };
      setFocusIndex(index);
      setFocusTick((v) => v + 1);
    },
    [triggerSave],
  );

  /** Aplica un comando del menú `/`: borra solo el `/query` tipeado y convierte/inserta. */
  const applyCommand = useCallback(
    (index: number, cmd: { type: DocsBlockType; level?: 1 | 2 | 3 }) => {
      const block = blocks[index];
      if (!block) return;
      const s = slash && slash.index === index ? slash : null;
      const stripped = s ? removeHtmlRange(block.content, s.start, s.end) : block.content;
      const caret = s ? s.start : htmlToFlatText(block.content).length;

      if (cmd.type === 'divider') {
        // El divider no tiene texto: se inserta debajo + un párrafo para seguir escribiendo.
        const dividerBlock: DocsBlock = { id: crypto.randomUUID(), type: 'divider', content: '' };
        const paraBlock: DocsBlock = { id: crypto.randomUUID(), type: 'paragraph', content: '' };
        setBlocks((prev) => {
          const next = prev.map((b, i) => (i === index ? { ...b, content: stripped } : b));
          next.splice(index + 1, 0, dividerBlock, paraBlock);
          triggerSave(next);
          return next;
        });
        setCmdOpen(false);
        setCmdQuery('');
        setCmdSel(0);
        setSlash(null);
        pendingCaret.current = { index: index + 2, offset: 0 };
        setFocusIndex(index + 2);
        setFocusTick((v) => v + 1);
        return;
      }

      convertBlock(index, cmd.type, cmd.level, stripped, caret);
    },
    [blocks, slash, convertBlock, triggerSave],
  );

  const filteredCommands = useMemo(() => {
    const q = cmdQuery.trim().toLowerCase();
    const qn = q.replace(/[^a-z0-9]/g, '');
    return BLOCK_COMMANDS.map((c) => ({ ...c, label: t(`editor.commands.${c.key}`) })).filter(
      (c) => {
        if (!q) return true;
        const label = c.label.toLowerCase();
        if (label.includes(q)) return true;
        // Label normalizado ("to-do" → "todo") para que "/todo" matchee "To-do".
        if (qn && label.replace(/[^a-z0-9]/g, '').includes(qn)) return true;
        return (COMMAND_KEYWORDS[c.key] ?? []).some((k) => {
          const kl = k.toLowerCase();
          return kl.includes(q) || (qn !== '' && kl.replace(/[^a-z0-9]/g, '').includes(qn));
        });
      },
    );
  }, [t, cmdQuery]);

  /** Enter en párrafo/heading/listas/todo: split en el caret o continuación de lista. */
  const splitBlock = useCallback(
    (index: number, caret: number) => {
      const block = blocks[index];
      if (!block) return;

      // Item vacío + Enter: sale de la lista convirtiéndolo en párrafo.
      if (LIST_TYPES.includes(block.type) && block.content === '') {
        convertBlock(index, 'paragraph', undefined, '', 0);
        return;
      }

      const [before, after] = splitHtmlAt(block.content, caret);
      const isList = LIST_TYPES.includes(block.type);
      // Listas/todo continúan el mismo tipo; heading/paragraph crean un párrafo.
      const newType: DocsBlockType = isList ? block.type : 'paragraph';
      const newBlock: DocsBlock = { id: crypto.randomUUID(), type: newType, content: after };
      if (newType === 'todo') newBlock.checked = false;

      setBlocks((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], content: before };
        next.splice(index + 1, 0, newBlock);
        triggerSave(next);
        return next;
      });
      pendingCaret.current = { index: index + 1, offset: 0 };
      setFocusIndex(index + 1);
      setFocusTick((v) => v + 1);
    },
    [blocks, convertBlock, triggerSave],
  );

  /** Inserta un '\n' dentro del bloque en la posición del caret (offset plano). */
  const insertSoftNewline = useCallback(
    (index: number, caret: number) => {
      const block = blocks[index];
      if (!block) return;
      const next = insertTextAtOffset(block.content, caret, '\n');
      updateBlock(index, { content: next });
      pendingCaret.current = { index, offset: caret + 1 };
      setFocusTick((v) => v + 1);
    },
    [blocks, updateBlock],
  );

  /** Enter dentro de code/quote: newline interno; sale con línea vacía o Cmd/Ctrl+Enter. */
  const enterInCodeQuote = useCallback(
    (index: number, caret: number, exit: boolean) => {
      const block = blocks[index];
      if (!block) return;
      const flat = htmlToFlatText(block.content);
      const [before, after] = splitHtmlAt(block.content, caret);

      // Cmd/Ctrl+Enter: sale del bloque; el texto tras el caret va a un párrafo nuevo.
      if (exit) {
        const paraBlock: DocsBlock = { id: crypto.randomUUID(), type: 'paragraph', content: after };
        setBlocks((prev) => {
          const next = [...prev];
          next[index] = { ...next[index], content: before };
          next.splice(index + 1, 0, paraBlock);
          triggerSave(next);
          return next;
        });
        pendingCaret.current = { index: index + 1, offset: 0 };
        setFocusIndex(index + 1);
        setFocusTick((v) => v + 1);
        return;
      }

      // Enter en la última línea vacía (caret al final y línea sin contenido): sale.
      if (caret === flat.length && (flat === '' || flat.endsWith('\n'))) {
        const trimmedFlat = flat.replace(/\n$/, '');
        if (trimmedFlat === '') {
          convertBlock(index, 'paragraph', undefined, '', 0);
          return;
        }
        // Quita solo el '\n' final (puede vivir dentro de una marca en quotes).
        const trimmed = removeHtmlRange(block.content, trimmedFlat.length, flat.length);
        const paraBlock: DocsBlock = { id: crypto.randomUUID(), type: 'paragraph', content: '' };
        setBlocks((prev) => {
          const next = [...prev];
          next[index] = { ...next[index], content: trimmed };
          next.splice(index + 1, 0, paraBlock);
          triggerSave(next);
          return next;
        });
        pendingCaret.current = { index: index + 1, offset: 0 };
        setFocusIndex(index + 1);
        setFocusTick((v) => v + 1);
        return;
      }

      // Caso normal: newline dentro del mismo bloque.
      insertSoftNewline(index, caret);
    },
    [blocks, convertBlock, insertSoftNewline, triggerSave],
  );

  /** Backspace con caret al inicio: fusiona con el bloque anterior (o borra divider). */
  const mergeWithPrevious = useCallback(
    (index: number) => {
      const block = blocks[index];
      if (!block) return false;

      if (index === 0) {
        // Primer bloque: Backspace al inicio solo baja el tipo a párrafo.
        if (block.type !== 'paragraph' && isTextBlockType(block.type)) {
          convertBlock(index, 'paragraph', undefined, block.content, 0);
          return true;
        }
        return false;
      }

      const prev = blocks[index - 1];

      if (prev.type === 'divider') {
        setBlocks((all) => {
          const next = all.filter((_, i) => i !== index - 1);
          triggerSave(next);
          return next;
        });
        pendingCaret.current = { index: index - 1, offset: 0 };
        setFocusIndex(index - 1);
        setFocusTick((v) => v + 1);
        return true;
      }

      if (isTextBlockType(prev.type) && isTextBlockType(block.type)) {
        // Concatenar dos fragmentos HTML-lite saneados es seguro (pueden quedar
        // tags adyacentes iguales: válido, se renderiza igual).
        const join = htmlToFlatText(prev.content).length;
        setBlocks((all) => {
          const next = [...all];
          next[index - 1] = { ...next[index - 1], content: prev.content + block.content };
          next.splice(index, 1);
          triggerSave(next);
          return next;
        });
        pendingCaret.current = { index: index - 1, offset: join };
        setFocusIndex(index - 1);
        setFocusTick((v) => v + 1);
        return true;
      }

      // Anterior es table/database: solo se borra el bloque si está vacío.
      if (block.content === '') {
        removeBlock(index);
        return true;
      }
      return false;
    },
    [blocks, convertBlock, removeBlock, triggerSave],
  );

  const handleKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent<HTMLElement>) => {
      const block = blocks[index];
      if (!block) return;

      if (cmdOpen && slash?.index === index) {
        const filtered = filteredCommands;
        if (e.key === 'Escape') {
          setCmdOpen(false);
          setCmdQuery('');
          setCmdSel(0);
          setSlash(null);
          e.preventDefault();
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          const match = filtered[cmdSel];
          if (match) applyCommand(index, match);
          return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (filtered.length) setCmdSel((s) => (s + 1) % filtered.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (filtered.length) setCmdSel((s) => (s - 1 + filtered.length) % filtered.length);
          return;
        }
        return;
      }

      const el = e.currentTarget as HTMLElement;
      const isEditable = el.isContentEditable;
      const caret = isEditable ? getCaretOffset(el) : 0;
      const collapsed = window.getSelection()?.isCollapsed ?? true;

      // Formato en línea: Cmd/Ctrl+B/I/U (toggle) y Cmd/Ctrl+K (link). El
      // browser aplicaría <b>/<i> con execCommand: se previene y se usa el
      // modelo HTML-lite. Nunca dentro de bloques de código.
      const meta = e.metaKey || e.ctrlKey;
      if (meta && isEditable && block.type !== 'code' && isTextBlockType(block.type)) {
        const key = e.key.toLowerCase();
        if (key === 'b' || key === 'i' || key === 'u') {
          // preventDefault aun con selección colapsada: si no, el browser
          // activa bold/italic por execCommand e inyecta <b>/<i> al tipear.
          e.preventDefault();
          const offsets = getSelectionOffsets(el);
          if (offsets && offsets.end > offsets.start) {
            applyMark(index, offsets.start, offsets.end, key === 'b' ? 'strong' : key === 'i' ? 'em' : 'u');
          }
          return;
        }
        if (key === 'k') {
          e.preventDefault();
          openLinkDialog(index);
          return;
        }
      }

      // Markdown: "# ", "## ", "### ", "- ", "* ", "1. ", "[] ", "[ ] ", "> ".
      if (e.key === ' ' && isEditable && collapsed && block.type === 'paragraph') {
        const flatBefore = htmlToFlatText(block.content).slice(0, caret);
        const md = matchMarkdownPrefix(flatBefore);
        if (md) {
          e.preventDefault();
          convertBlock(index, md.type, md.level, splitHtmlAt(block.content, flatBefore.length)[1], 0);
          return;
        }
      }

      if (e.key === 'Enter') {
        // Shift+Enter: salto de línea suave dentro del bloque de texto.
        if (e.shiftKey) {
          if (isEditable && isTextBlockType(block.type)) {
            e.preventDefault();
            insertSoftNewline(index, caret);
          }
          return;
        }
        e.preventDefault();
        if (block.type === 'code' || block.type === 'quote') {
          enterInCodeQuote(index, caret, e.metaKey || e.ctrlKey);
        } else if (isEditable && isTextBlockType(block.type)) {
          splitBlock(index, caret);
        } else {
          // table/database: Enter crea un párrafo debajo.
          insertBlock(index, 'paragraph');
        }
        return;
      }

      if (e.key === 'Backspace') {
        // Caret al inicio: fusionar con el bloque anterior.
        if (isEditable && collapsed && caret === 0) {
          if (mergeWithPrevious(index)) e.preventDefault();
          return;
        }
        if (!isEditable && block.content === '') {
          // Backspace dentro de una celda de tabla/database edita el texto de
          // la celda: NUNCA borra el bloque entero.
          const target = e.target as HTMLElement;
          if (target.closest('input, textarea, select')) return;
          e.preventDefault();
          removeBlock(index);
          return;
        }
      }
    },
    [
      blocks,
      cmdOpen,
      slash,
      filteredCommands,
      cmdSel,
      applyCommand,
      convertBlock,
      splitBlock,
      enterInCodeQuote,
      insertSoftNewline,
      mergeWithPrevious,
      insertBlock,
      removeBlock,
      applyMark,
      openLinkDialog,
    ],
  );

  const handleInput = useCallback(
    (index: number, text: string) => {
      const block = blocks[index];
      if (!block) return;

      // "```" en un párrafo convierte a bloque de código (al cerrar el 3er backtick).
      if (block.type === 'paragraph' && text === '```') {
        convertBlock(index, 'code', undefined, '', 0);
        return;
      }

      // Los disparadores (/, [[, @) se detectan sobre el TEXTO PLANO ANTES DEL
      // CARET: funcionan en cualquier posición del bloque (no solo al final)
      // y el menú se ancla al caret. El contenido del modelo es HTML-lite y
      // los offsets ignoran los tags. Ninguno aplica dentro de code.
      const flat = htmlToFlatText(text);
      const el = blockRefs.current[index];
      const caret = el ? getCaretOffset(el) : flat.length;
      const beforeCaret = flat.slice(0, caret);
      const isCode = block.type === 'code';

      const closeSlash = () => {
        setSlash(null);
        setCmdOpen(false);
        setCmdQuery('');
        setCmdSel(0);
      };

      // `[[query`: la query no cruza '[' ni ']' (otro '[[' reinicia el trigger).
      const mentionMatch = !isCode && !embedded ? beforeCaret.match(/\[\[([^\][]*)$/) : null;
      if (mentionMatch) {
        const query = mentionMatch[1] ?? '';
        setMention({ index, query, start: caret - mentionMatch[0].length, end: caret });
        setUserMention(null);
        closeSlash();
        const pos = readCaretMenuPos(index);
        if (pos) setCaretMenuPos(pos);
        return;
      }
      setMention(null);

      // @mención: '@' al inicio o tras un espacio, query sin espacios.
      const userMatch = !isCode && !embedded ? beforeCaret.match(/(?:^|\s)@([^\s@]*)$/) : null;
      if (userMatch) {
        const query = userMatch[1] ?? '';
        setUserMention({ index, query, start: caret - query.length - 1, end: caret });
        closeSlash();
        const pos = readCaretMenuPos(index);
        if (pos) setCaretMenuPos(pos);
        return;
      }
      setUserMention(null);

      // Menú `/`: '/' al inicio o tras un espacio, query sin espacios ni '/'.
      const slashMatch = !isCode ? beforeCaret.match(/(?:^|\s)\/([^\s/]*)$/) : null;
      if (slashMatch) {
        const query = slashMatch[1] ?? '';
        setSlash({ index, start: caret - query.length - 1, end: caret });
        setCmdOpen(true);
        setCmdQuery(query);
        setCmdSel(0);
        const pos = readCaretMenuPos(index);
        if (pos) setCaretMenuPos(pos);
      } else {
        closeSlash();
      }
    },
    [blocks, convertBlock, embedded, readCaretMenuPos],
  );

  const handleBlockChange = useCallback(
    (index: number, patch: Partial<DocsBlock>) => {
      updateBlock(index, patch);
      if (patch.content !== undefined) handleInput(index, patch.content);
    },
    [handleInput, updateBlock],
  );

  /** El click del usuario ya posiciona el caret: no hay que re-moverlo en el efecto. */
  const handleFocus = useCallback((index: number) => {
    prevFocus.current = index;
    setFocusIndex(index);
    // El foco llegó a un bloque (click, split, conversión): cualquier menú
    // anclado al caret que haya quedado abierto ya no corresponde.
    setSlash(null);
    setCmdOpen(false);
    setCmdQuery('');
    setCmdSel(0);
    setMention(null);
    setUserMention(null);
  }, []);

  const onSelectMention = useCallback(
    (selected: DocsPage) => {
      if (!mention) return;
      const { index, start, end } = mention;
      const block = blocks[index];
      if (!block) {
        setMention(null);
        return;
      }
      // Se borra el `[[query` tipeado (rango plano capturado al tipear, en
      // cualquier posición del bloque) y se inserta el título como texto
      // escapado en ese punto (insertTextAtOffset escapa).
      const insert = `[${selected.title || t('untitled')}] `;
      const newContent = insertTextAtOffset(
        removeHtmlRange(block.content, start, end),
        start,
        insert,
      );
      setBlocks((prev) => {
        const next = prev.map((b, i) => (i === index ? { ...b, content: newContent } : b));
        triggerSave(next);
        return next;
      });
      setMention(null);
      pendingCaret.current = { index, offset: start + insert.length };
      setFocusIndex(index);
      setFocusTick((v) => v + 1);
    },
    [blocks, mention, triggerSave, t],
  );

  const onSelectUserMention = useCallback(
    (selected: DocsMentionableUser) => {
      if (!userMention) return;
      const { index, start, end } = userMention;
      const name = selected.name ?? selected.email;
      const block = blocks[index];
      if (!block) {
        setUserMention(null);
        return;
      }
      // Igual que [[ : se reemplaza el `@query` capturado por `@Nombre `.
      const insert = `@${name} `;
      const newContent = insertTextAtOffset(
        removeHtmlRange(block.content, start, end),
        start,
        insert,
      );
      setBlocks((prev) => {
        const next = prev.map((b, i) => (i === index ? { ...b, content: newContent } : b));
        triggerSave(next);
        return next;
      });
      setUserMention(null);
      pendingCaret.current = { index, offset: start + insert.length };
      setFocusIndex(index);
      setFocusTick((v) => v + 1);
      // Notificación al mencionado (fire-and-forget; el server valida membresía).
      fetch(`/api/docs/pages/${page.id}/mentions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: selected.id }),
      }).catch(() => {});
    },
    [blocks, page.id, triggerSave, userMention],
  );

  /** Menú "…": flechas entre ítems, Esc cierra y devuelve el foco al botón. */
  const pageMenuKeys = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]'));
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      items[e.key === 'Home' ? 0 : items.length - 1]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setMenuOpen(false);
      menuBtnRef.current?.focus();
    } else if (e.key === 'Tab') setMenuOpen(false);
  };

  const copyLink = () => {
    const url = `${window.location.origin}/app/docs/${page.id}`;
    navigator.clipboard.writeText(url);
    setMenuOpen(false);
  };

  const copyContents = () => {
    const text = blocks.map((b) => htmlToFlatText(b.content)).join('\n');
    navigator.clipboard.writeText(text);
    setMenuOpen(false);
  };

  const addCover = (url: string) => {
    setCoverUrl(url);
    triggerSave(undefined, undefined, undefined, url);
    setCoverOpen(false);
  };

  const removeCover = () => {
    setCoverUrl('');
    triggerSave(undefined, undefined, undefined, null);
  };

  const ancestorChain = ancestors.filter((a) => a.id !== page.id);

  // Estado activo de la toolbar sobre el contenido actual (offsets de texto plano).
  const toolbarBlock = toolbar ? blocks[toolbar.index] : null;
  const markActive = (tag: DocsMarkTag): boolean =>
    toolbar && toolbarBlock
      ? isRangeFullyMarked(toolbarBlock.content, tag, toolbar.start, toolbar.end)
      : false;
  const linkActive =
    toolbar && toolbarBlock
      ? getLinkAt(toolbarBlock.content, toolbar.start, toolbar.end) !== null
      : false;

  /** Abre el popover de link desde la toolbar (expande al <a> que cubre la selección). */
  const openLinkFromToolbar = () => {
    if (!toolbar) return;
    const block = blocks[toolbar.index];
    const link = block ? getLinkAt(block.content, toolbar.start, toolbar.end) : null;
    setLinkDialog({
      index: toolbar.index,
      start: link?.start ?? toolbar.start,
      end: link?.end ?? toolbar.end,
      href: link?.href ?? '',
      top: toolbar.top,
      left: toolbar.left,
    });
    setToolbar(null);
  };

  let numberedIndex = 0;

  return (
    <div className={`docs-editor${smallText ? ' docs-editor-small' : ''}${fullWidth ? ' docs-editor-full' : ''}${embedded ? ' docs-editor-embedded' : ''}`}>
      {!embedded && (
      <div className="docs-top-bar">
        <nav className="docs-breadcrumb" aria-label={t('editor.breadcrumb')}>
          {/* La banda ya dice "Docs / Páginas": acá van solo ancestros y título. */}
          <ol>
            {ancestorChain.map((a) => (
              <li key={a.id} className="docs-breadcrumb-segment">
                <Link href={`/app/docs/${a.id}`} className="docs-breadcrumb-link">
                  {a.icon && <span aria-hidden="true">{a.icon}</span>}
                  <span className="docs-breadcrumb-title">{a.title || t('untitled')}</span>
                </Link>
              </li>
            ))}
            <li className="docs-breadcrumb-segment">
              <span className="docs-breadcrumb-current" aria-current="page">
                {title || t('untitled')}
              </span>
            </li>
          </ol>
        </nav>

        <div className="docs-page-actions">
          <span
            className={`docs-save-status${saveError && !saving && !dirty ? ' is-error' : ''}`}
            aria-live="polite"
          >
            {saving || dirty
              ? t('editor.saving')
              : saveError === 'conflict'
                ? t('editor.saveConflict')
                : saveError
                ? (
                    <>
                      {t(saveError === 'tooLong' ? 'editor.saveTooLong' : 'editor.saveFailed')}{' '}
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => triggerSave()}>
                        {t('editor.retrySave')}
                      </button>
                    </>
                  )
                : t('editor.saved')}
          </span>
          {topActions}
          <div className="docs-action-menu-wrap" ref={menuRef}>
            <button
              type="button"
              ref={menuBtnRef}
              className="btn btn-ghost btn-sm btn-icon docs-action-btn"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label={t('editor.pageOptions')}
              title={t('editor.pageOptions')}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <DocsGlyph name="more" size={16} />
            </button>
            {menuOpen && (
              <div className="docs-menu docs-page-menu" role="menu" aria-label={t('editor.pageOptions')} onKeyDown={pageMenuKeys}>
                <button type="button" role="menuitem" className="docs-menu-item" onClick={copyLink}>
                  {t('editor.copyLink')}
                </button>
                <button type="button" role="menuitem" className="docs-menu-item" onClick={copyContents}>
                  {t('editor.copyContents')}
                </button>
                {onDuplicate && (
                  <button type="button" role="menuitem" className="docs-menu-item" onClick={onDuplicate}>
                    {t('editor.duplicate')}
                  </button>
                )}
                {menuExtra && (
                  <>
                    <hr className="docs-menu-divider" />
                    {menuExtra(() => setMenuOpen(false))}
                  </>
                )}
                {layoutToggles && (<>
                <hr className="docs-menu-divider" />
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={smallText}
                  className="docs-menu-item docs-menu-toggle"
                  onClick={() => {
                    // Se persiste en la página (antes se perdía al recargar).
                    const next = !smallText;
                    setSmallText(next);
                    onSave({ small_text: next });
                    setMenuOpen(false);
                  }}
                >
                  {t('editor.smallText')}
                  <span className={`docs-toggle${smallText ? ' on' : ''}`} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={fullWidth}
                  className="docs-menu-item docs-menu-toggle"
                  onClick={() => {
                    const next = !fullWidth;
                    setFullWidth(next);
                    onSave({ full_width: next });
                    setMenuOpen(false);
                  }}
                >
                  {t('editor.fullWidth')}
                  <span className={`docs-toggle${fullWidth ? ' on' : ''}`} aria-hidden="true" />
                </button>
                </>)}
                {onDelete && <hr className="docs-menu-divider" />}
                {onDelete && (
                  <button
                    type="button"
                    role="menuitem"
                    className="docs-menu-item docs-menu-danger"
                    onClick={onDelete}
                  >
                    {t('editor.moveToTrash')}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      )}

      {embedded ? null : coverUrl ? (
        <div className="docs-cover">
          {/* URL arbitraria del usuario: next/image exigiría allowlist de dominios. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={coverUrl} alt="" className="docs-cover-img" />
          <button type="button" className="btn btn-secondary btn-sm docs-cover-remove" onClick={removeCover}>
            {t('editor.removeCover')}
          </button>
        </div>
      ) : null}

      <div className="docs-page-header">
        {!embedded && icon && (
          <EmojiPicker
            value={icon}
            onChange={(next) => {
              setIcon(next);
              triggerSave(undefined, undefined, next);
            }}
            onRemove={() => {
              setIcon('');
              triggerSave(undefined, undefined, '');
            }}
          >
            <span className="docs-icon">{icon}</span>
          </EmojiPicker>
        )}

        {!embedded && (
          <div className="docs-page-meta">
            {!icon && (
              <EmojiPicker
                value=""
                triggerClassName="btn btn-ghost btn-sm docs-meta-btn"
                triggerLabel={t('editor.addIcon')}
                onChange={(next) => {
                  setIcon(next);
                  triggerSave(undefined, undefined, next);
                }}
              >
                {t('editor.addIcon')}
              </EmojiPicker>
            )}
            {!coverUrl && (
              <div className="docs-cover-anchor">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm docs-meta-btn"
                  onClick={() => setCoverOpen(true)}
                  aria-expanded={coverOpen}
                  aria-haspopup="dialog"
                >
                  {t('editor.addCover')}
                </button>
                {coverOpen && (
                  <div className="docs-menu docs-cover-popover" ref={coverRef}>
                    <input
                      type="url"
                      placeholder={t('editor.coverUrlPlaceholder')}
                      aria-label={t('editor.coverUrlPlaceholder')}
                      className="input docs-cover-input"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') addCover((e.target as HTMLInputElement).value);
                        if (e.key === 'Escape') setCoverOpen(false);
                      }}
                    />
                    <div className="docs-cover-presets">
                      {[
                        'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=1200&q=80',
                        'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=1200&q=80',
                        'https://images.unsplash.com/photo-1447752875215-b2761acb3c5d?w=1200&q=80',
                        'https://images.unsplash.com/photo-1501854140801-50d01698950b?w=1200&q=80',
                      ].map((url) => (
                        <button
                          key={url}
                          type="button"
                          className="docs-cover-preset"
                          style={{ backgroundImage: `url(${url})` }}
                          onClick={() => addCover(url)}
                          aria-label={t('editor.coverPreset')}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            <button type="button" className="btn btn-ghost btn-sm docs-meta-btn" onClick={() => onAddComment?.()}>
              {t('editor.addComment')}
            </button>
          </div>
        )}

        <div
          ref={titleRef}
          className="docs-title"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={t('editor.pageTitle')}
          data-placeholder={t('editor.untitled')}
          onInput={(e) => {
            const next = e.currentTarget.textContent ?? '';
            setTitle(next);
            triggerSave(undefined, next);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              // Enter en el título NO inserta newline: pasa el foco al primer bloque.
              e.preventDefault();
              pendingCaret.current = { index: 0, offset: 0 };
              setFocusIndex(0);
              setFocusTick((v) => v + 1);
            }
          }}
        />
      </div>

      <div className="docs-blocks" ref={blocksWrapRef}>
        {blocks.map((block, index) => {
          if (block.type === 'numbered_list_item') numberedIndex++;
          else numberedIndex = 0;
          const commentCount = commentCounts?.[block.id] ?? 0;
          return (
            <Fragment key={block.id}>
              <div
                className={`docs-block-outer${dragIndex === index ? ' dragging' : ''}${blockMenu === index ? ' menu-open' : ''}`}
              >
                <button
                  type="button"
                  className="docs-block-grip"
                  aria-label={t('editor.blockMenu.dragHandle')}
                  title={t('editor.blockMenu.dragHandle')}
                  data-no-drag
                  onPointerDown={(e) => handleGripPointerDown(e, index)}
                  onPointerMove={handleGripPointerMove}
                  onPointerUp={handleGripPointerUp}
                  onPointerCancel={handleGripPointerCancel}
                  onClick={() => handleGripClick(index)}
                >
                  <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden>
                    <rect x="1" y="1" width="2.4" height="2.4" />
                    <rect x="6.6" y="1" width="2.4" height="2.4" />
                    <rect x="1" y="5.8" width="2.4" height="2.4" />
                    <rect x="6.6" y="5.8" width="2.4" height="2.4" />
                    <rect x="1" y="10.6" width="2.4" height="2.4" />
                    <rect x="6.6" y="10.6" width="2.4" height="2.4" />
                  </svg>
                </button>
                {blockMenu === index && (
                  <div className="docs-block-menu" ref={blockMenuRef} data-no-drag>
                    <div className="docs-bmenu-turninto">
                      <button
                        type="button"
                        className="docs-bmenu-item"
                        onClick={() => setTurnIntoOpen((v) => !v)}
                      >
                        {t('editor.blockMenu.turnInto')}
                        <span className="docs-bmenu-caret" aria-hidden>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M9 6l6 6-6 6" />
                          </svg>
                        </span>
                      </button>
                      {turnIntoOpen && (
                        <div className="docs-bmenu-sub">
                          {BLOCK_COMMANDS.map((cmd) => (
                            <button
                              key={cmd.key}
                              type="button"
                              className="docs-bmenu-item"
                              onClick={() => {
                                closeBlockMenu();
                                convertBlock(index, cmd.type, cmd.level);
                              }}
                            >
                              <span className="docs-command-icon"><DocsGlyph name={BLOCK_ICONS[cmd.type]} size={14} /></span>
                              <span className="docs-command-label">
                                {t(`editor.commands.${cmd.key}`)}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      className="docs-bmenu-item"
                      onClick={() => {
                        closeBlockMenu();
                        duplicateBlock(index);
                      }}
                    >
                      {t('editor.blockMenu.duplicate')}
                    </button>
                    <button
                      type="button"
                      className="docs-bmenu-item"
                      onClick={() => {
                        closeBlockMenu();
                        insertBlock(index, 'paragraph');
                      }}
                    >
                      {t('editor.blockMenu.insertBelow')}
                    </button>
                    {onBlockComment && (
                      <button
                        type="button"
                        className="docs-bmenu-item"
                        onClick={() => {
                          closeBlockMenu();
                          onBlockComment(block.id);
                        }}
                      >
                        {t('editor.blockMenu.comment')}
                      </button>
                    )}
                    <button
                      type="button"
                      className="docs-bmenu-item"
                      disabled={index === 0}
                      onClick={() => {
                        closeBlockMenu();
                        moveBlock(index, -1);
                      }}
                    >
                      {t('editor.blockMenu.moveUp')}
                    </button>
                    <button
                      type="button"
                      className="docs-bmenu-item"
                      disabled={index === blocks.length - 1}
                      onClick={() => {
                        closeBlockMenu();
                        moveBlock(index, 1);
                      }}
                    >
                      {t('editor.blockMenu.moveDown')}
                    </button>
                    <hr className="docs-bmenu-divider" />
                    <button
                      type="button"
                      className="docs-bmenu-item docs-bmenu-danger"
                      disabled={blocks.length <= 1}
                      onClick={() => {
                        closeBlockMenu();
                        removeBlock(index);
                      }}
                    >
                      {t('editor.blockMenu.delete')}
                    </button>
                  </div>
                )}
                {onBlockComment && (
                  <button
                    type="button"
                    className={`docs-block-comment${commentCount > 0 ? ' has-comments' : ''}`}
                    onClick={() => onBlockComment(block.id)}
                    aria-label={t('comments.commentBlock')}
                    title={t('comments.commentBlock')}
                  >
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                    {commentCount > 0 && (
                      <span className="docs-block-comment-count">{commentCount}</span>
                    )}
                  </button>
                )}
                <DocsBlockEditor
                  block={block}
                  index={index}
                  listIndex={numberedIndex || undefined}
                  onChange={handleBlockChange}
                  onKeyDown={handleKeyDown}
                  onFocus={handleFocus}
                  focused={focusIndex === index}
                  ref={(el) => { blockRefs.current[index] = el; }}
                />
              </div>
              <div className="docs-gap">
                <button
                  type="button"
                  className="docs-gap-add"
                  aria-label={t('editor.blockMenu.insertBelow')}
                  title={t('editor.blockMenu.insertBelow')}
                  data-no-drag
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertBlock(index, 'paragraph')}
                >
                  <DocsGlyph name="plus" size={12} />
                </button>
              </div>
            </Fragment>
          );
        })}
        {dropLine !== null && (
          <div className="docs-drop-line" style={{ top: dropLine }} aria-hidden />
        )}
      </div>

      {cmdOpen &&
        slash &&
        focusIndex === slash.index &&
        caretMenuPos &&
        // Portal a body + position: fixed anclado al caret (como la toolbar):
        // un ancestro con transform rompería la posición relativa al bloque.
        createPortal(
        <div
          className="docs-command-menu"
          style={caretMenuStyle(caretMenuPos, 280, 320)}
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="docs-command-title">{t('editor.basicBlocks')}</div>
          {filteredCommands.map((cmd, i) => (
            <button
              key={cmd.key}
              type="button"
              className={`docs-command-item${i === cmdSel ? ' sel' : ''}`}
              onClick={() => applyCommand(slash.index, cmd)}
            >
              <span className="docs-command-icon"><DocsGlyph name={BLOCK_ICONS[cmd.type]} size={14} /></span>
              <span className="docs-command-label">{cmd.label}</span>
              {cmd.shortcut && (
                <span className="docs-command-shortcut">{cmd.shortcut}</span>
              )}
            </button>
          ))}
          {filteredCommands.length === 0 && (
            <div className="docs-command-empty">{t('editor.noCommands')}</div>
          )}
        </div>,
        document.body,
      )}

      {mention &&
        focusIndex === mention.index &&
        caretMenuPos &&
        createPortal(
        <MentionPopover
          query={mention.query}
          style={caretMenuStyle(caretMenuPos, 260, 280)}
          onSelect={onSelectMention}
          onClose={() => setMention(null)}
        />,
        document.body,
      )}

      {userMention &&
        focusIndex === userMention.index &&
        caretMenuPos &&
        createPortal(
        <UserMentionPopover
          query={userMention.query}
          pageId={page.id}
          style={caretMenuStyle(caretMenuPos, 260, 280)}
          onSelect={onSelectUserMention}
          onClose={() => setUserMention(null)}
        />,
        document.body,
      )}

      {toolbar &&
        !linkDialog &&
        // Portal a body: un ancestro con transform (sidebar/reveal) rompería
        // el position: fixed relativo al viewport.
        createPortal(
        <div
          className="docs-format-toolbar"
          style={{ top: toolbar.top, left: toolbar.left }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <button
            type="button"
            className={`docs-format-btn${markActive('strong') ? ' active' : ''}`}
            title={t('editor.format.bold')}
            aria-label={t('editor.format.bold')}
            onClick={() => applyMark(toolbar.index, toolbar.start, toolbar.end, 'strong')}
          >
            <strong>B</strong>
          </button>
          <button
            type="button"
            className={`docs-format-btn${markActive('em') ? ' active' : ''}`}
            title={t('editor.format.italic')}
            aria-label={t('editor.format.italic')}
            onClick={() => applyMark(toolbar.index, toolbar.start, toolbar.end, 'em')}
          >
            <em>I</em>
          </button>
          <button
            type="button"
            className={`docs-format-btn${markActive('u') ? ' active' : ''}`}
            title={t('editor.format.underline')}
            aria-label={t('editor.format.underline')}
            onClick={() => applyMark(toolbar.index, toolbar.start, toolbar.end, 'u')}
          >
            <u>U</u>
          </button>
          <button
            type="button"
            className={`docs-format-btn${markActive('s') ? ' active' : ''}`}
            title={t('editor.format.strikethrough')}
            aria-label={t('editor.format.strikethrough')}
            onClick={() => applyMark(toolbar.index, toolbar.start, toolbar.end, 's')}
          >
            <s>S</s>
          </button>
          <button
            type="button"
            className={`docs-format-btn docs-format-btn-mono${markActive('code') ? ' active' : ''}`}
            title={t('editor.format.code')}
            aria-label={t('editor.format.code')}
            onClick={() => applyMark(toolbar.index, toolbar.start, toolbar.end, 'code')}
          >
            {'</>'}
          </button>
          <span className="docs-format-sep" aria-hidden />
          <button
            type="button"
            className={`docs-format-btn${linkActive ? ' active' : ''}`}
            title={t('editor.format.link')}
            aria-label={t('editor.format.link')}
            onClick={openLinkFromToolbar}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          </button>
        </div>,
        document.body,
      )}

      {linkDialog &&
        createPortal(
        <div
          ref={linkPopoverRef}
          className="docs-link-popover"
          style={{ top: linkDialog.top, left: linkDialog.left }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <input
            key={`${linkDialog.index}:${linkDialog.start}:${linkDialog.end}`}
            ref={linkInputRef}
            type="text"
            className="docs-link-input"
            defaultValue={linkDialog.href}
            placeholder={t('editor.format.linkPlaceholder')}
            autoFocus
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applyLink(linkDialog, (e.target as HTMLInputElement).value);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                const d = linkDialog;
                setLinkDialog(null);
                pendingSelection.current = { index: d.index, start: d.start, end: d.end };
                setFocusIndex(d.index);
                setFocusTick((v) => v + 1);
              }
            }}
          />
          <button
            type="button"
            className="docs-link-btn primary"
            onClick={() => applyLink(linkDialog, linkInputRef.current?.value ?? '')}
          >
            {t('editor.format.addLink')}
          </button>
          {linkDialog.href && (
            <button
              type="button"
              className="docs-link-btn"
              onClick={() => removeLink(linkDialog)}
            >
              {t('editor.format.removeLink')}
            </button>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
