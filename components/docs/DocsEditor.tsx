'use client';

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import {
  defaultBlocks,
  defaultDatabaseColumns,
  type DocsBlock,
  type DocsBlockType,
  type DocsMentionableUser,
  type DocsPage,
} from '@/lib/docs-types';
import { getCaretOffset, setCaretOffset } from '@/lib/docs-caret';
import DocsBlockEditor from './DocsBlockEditor';
import MentionPopover from './MentionPopover';
import UserMentionPopover from './UserMentionPopover';
import EmojiPicker from './EmojiPicker';

interface DocsEditorProps {
  page: DocsPage;
  ancestors: DocsPage[];
  onSave: (page: DocsPage) => void;
  saving?: boolean;
  onDuplicate?: () => void;
  onDelete?: () => void;
  onAddComment?: () => void;
  /** Cantidad de comentarios por block_id (para el badge). */
  commentCounts?: Record<string, number>;
  /** Abre el panel de comentarios anclado al bloque. */
  onBlockComment?: (blockId: string) => void;
}

const BLOCK_COMMANDS: {
  key: string;
  type: DocsBlockType;
  level?: 1 | 2 | 3;
  shortcut?: string;
}[] = [
  { key: 'p', type: 'paragraph', shortcut: 'plain text' },
  { key: 'h1', type: 'heading', level: 1, shortcut: '# heading' },
  { key: 'h2', type: 'heading', level: 2, shortcut: '## heading' },
  { key: 'h3', type: 'heading', level: 3, shortcut: '### heading' },
  { key: 'bulleted', type: 'bulleted_list_item', shortcut: '- list' },
  { key: 'numbered', type: 'numbered_list_item', shortcut: '1. list' },
  { key: 'todo', type: 'todo', shortcut: '[ ] todo' },
  { key: 'quote', type: 'quote', shortcut: '> quote' },
  { key: 'code', type: 'code', shortcut: '``` code' },
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

const BLOCK_ICONS: Record<DocsBlockType, string> = {
  paragraph: 'T',
  heading: 'H',
  bulleted_list_item: '•',
  numbered_list_item: '1.',
  todo: '☐',
  quote: '"',
  code: '</>',
  divider: '—',
  table: '▦',
  database: '▤',
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

export default function DocsEditor({
  page,
  ancestors,
  onSave,
  saving,
  onDuplicate,
  onDelete,
  onAddComment,
  commentCounts,
  onBlockComment,
}: DocsEditorProps) {
  const t = useTranslations('docs');
  const [blocks, setBlocks] = useState<DocsBlock[]>(
    page.content.length ? page.content : defaultBlocks(),
  );
  const [title, setTitle] = useState(page.title);
  const [icon, setIcon] = useState(page.icon ?? '📄');
  const [coverUrl, setCoverUrl] = useState(page.cover_url ?? '');
  const [smallText, setSmallText] = useState(false);
  const [fullWidth, setFullWidth] = useState(false);
  const [focusIndex, setFocusIndex] = useState<number>(0);
  /** Fuerza una corrida del efecto de foco aunque focusIndex/blocks no cambien de referencia. */
  const [focusTick, setFocusTick] = useState(0);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdQuery, setCmdQuery] = useState('');
  const [cmdSel, setCmdSel] = useState(0);
  /** Rango del `/query` tipeado: se borra al aplicar un comando sin tocar el resto del texto. */
  const [slash, setSlash] = useState<{ index: number; start: number; end: number } | null>(null);
  const [mention, setMention] = useState<{ index: number; query: string } | null>(null);
  const [userMention, setUserMention] = useState<{ index: number; query: string } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blockRefs = useRef<(HTMLDivElement | null)[]>([]);
  const titleRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const coverRef = useRef<HTMLDivElement>(null);
  /** Caret pendiente de aplicar después del próximo render (split/merge/conversión). */
  const pendingCaret = useRef<{ index: number; offset: number } | null>(null);
  /** Último índice enfocado conocido, para no re-mover el caret en cada render. */
  const prevFocus = useRef<number>(-1);
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

  useEffect(() => {
    setBlocks(page.content.length ? page.content : defaultBlocks());
    setTitle(page.title);
    setIcon(page.icon ?? '📄');
    setCoverUrl(page.cover_url ?? '');
    setBlockMenu(null);
  }, [page.id]);

  // Sincroniza el título (contentEditable) solo cuando cambió por fuera del tipeo.
  useEffect(() => {
    const el = titleRef.current;
    if (el && el.textContent !== title) {
      el.textContent = title;
    }
  }, [title]);

  // Foco/caret: si hay un caret pendiente (split, merge, markdown, slash) se
  // aplica después de que los hijos sincronizaron textContent; si no, solo se
  // mueve el caret al final cuando el foco cambió de bloque de verdad (no al
  // tipear, no al hacer click dentro del bloque ya enfocado).
  useLayoutEffect(() => {
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
      saveTimeout.current = setTimeout(() => {
        onSave({
          ...page,
          title: nextTitle ?? title,
          icon: nextIcon ?? icon,
          cover_url: nextCover === '' ? null : (nextCover ?? coverUrl),
          content: nextBlocks ?? blocks,
        });
      }, 600);
    },
    [blocks, coverUrl, icon, onSave, page, title],
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
      const stripped = s ? block.content.slice(0, s.start) + block.content.slice(s.end) : block.content;
      const caret = s ? s.start : block.content.length;

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

      const before = block.content.slice(0, caret);
      const after = block.content.slice(caret);
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

  /** Inserta un '\n' dentro del bloque en la posición del caret (texto plano). */
  const insertSoftNewline = useCallback(
    (index: number, caret: number) => {
      const block = blocks[index];
      if (!block) return;
      const next = block.content.slice(0, caret) + '\n' + block.content.slice(caret);
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
      const before = block.content.slice(0, caret);
      const after = block.content.slice(caret);

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
      if (caret === block.content.length && (before === '' || before.endsWith('\n'))) {
        const trimmed = before.replace(/\n$/, '');
        if (trimmed === '') {
          convertBlock(index, 'paragraph', undefined, '', 0);
          return;
        }
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
        const join = prev.content.length;
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

      // Markdown: "# ", "## ", "### ", "- ", "* ", "1. ", "[] ", "[ ] ", "> ".
      if (e.key === ' ' && isEditable && collapsed && block.type === 'paragraph') {
        const before = block.content.slice(0, caret);
        const md = matchMarkdownPrefix(before);
        if (md) {
          e.preventDefault();
          convertBlock(index, md.type, md.level, block.content.slice(before.length), 0);
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

      // Menú `/`: se dispara con '/' al inicio o tras un espacio, query sin espacios.
      // No aplica dentro de bloques de código.
      const el = blockRefs.current[index];
      const caret = el ? getCaretOffset(el) : text.length;
      const beforeCaret = text.slice(0, caret);
      const slashMatch = block.type !== 'code' ? beforeCaret.match(/(?:^|\s)\/([^\s/]*)$/) : null;
      if (slashMatch) {
        const query = slashMatch[1] ?? '';
        const start = caret - query.length - 1;
        setSlash({ index, start, end: caret });
        setCmdOpen(true);
        setCmdQuery(query);
        setCmdSel(0);
      } else {
        setSlash(null);
        setCmdOpen(false);
        setCmdQuery('');
        setCmdSel(0);
      }

      const mentionMatch = text.match(/\[\[([^\]]*)$/);
      if (mentionMatch) {
        setMention({ index, query: mentionMatch[1] ?? '' });
        setUserMention(null);
        return;
      }
      setMention(null);

      // @mención: '@' al inicio o tras un espacio, query sin espacios al final.
      const userMatch = text.match(/(?:^|\s)@([^\s@]*)$/);
      if (userMatch) {
        setUserMention({ index, query: userMatch[1] ?? '' });
      } else {
        setUserMention(null);
      }
    },
    [blocks, convertBlock],
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
  }, []);

  const onSelectMention = useCallback(
    (selected: DocsPage) => {
      if (!mention) return;
      const index = mention.index;
      const block = blocks[index];
      if (!block) {
        setMention(null);
        return;
      }
      const newContent = block.content.replace(
        /\[\[([^\]]*)$/,
        `[${selected.title || t('untitled')}] `,
      );
      setBlocks((prev) => {
        const next = prev.map((b, i) => (i === index ? { ...b, content: newContent } : b));
        triggerSave(next);
        return next;
      });
      setMention(null);
      pendingCaret.current = { index, offset: newContent.length };
      setFocusIndex(index);
      setFocusTick((v) => v + 1);
    },
    [blocks, mention, triggerSave, t],
  );

  const onSelectUserMention = useCallback(
    (selected: DocsMentionableUser) => {
      if (!userMention) return;
      const index = userMention.index;
      const name = selected.name ?? selected.email;
      const block = blocks[index];
      if (!block) {
        setUserMention(null);
        return;
      }
      const newContent = block.content.replace(/@([^\s@]*)$/, `@${name} `);
      setBlocks((prev) => {
        const next = prev.map((b, i) => (i === index ? { ...b, content: newContent } : b));
        triggerSave(next);
        return next;
      });
      setUserMention(null);
      pendingCaret.current = { index, offset: newContent.length };
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

  const copyLink = () => {
    const url = `${window.location.origin}/app/docs/${page.id}`;
    navigator.clipboard.writeText(url);
    setMenuOpen(false);
  };

  const copyContents = () => {
    const text = blocks.map((b) => b.content).join('\n');
    navigator.clipboard.writeText(text);
    setMenuOpen(false);
  };

  const archivePage = () => {
    onSave({ ...page, archived: true });
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

  let numberedIndex = 0;

  return (
    <div className={`docs-editor${smallText ? ' docs-editor-small' : ''}${fullWidth ? ' docs-editor-full' : ''}`}>
      <div className="docs-top-bar">
        {ancestorChain.length > 0 && (
          <nav className="docs-breadcrumb">
            <Link href="/app/docs" className="docs-breadcrumb-root">
              Docs
            </Link>
            {ancestorChain.map((a) => (
              <span key={a.id} className="docs-breadcrumb-segment">
                <span className="docs-breadcrumb-slash">/</span>
                <Link href={`/app/docs/${a.id}`} className="docs-breadcrumb-link">
                  <span className="docs-breadcrumb-icon">{a.icon ?? '📄'}</span>
                  <span className="docs-breadcrumb-title">{a.title || t('untitled')}</span>
                </Link>
              </span>
            ))}
            <span className="docs-breadcrumb-segment">
              <span className="docs-breadcrumb-slash">/</span>
              <span className="docs-breadcrumb-current">{title || t('untitled')}</span>
            </span>
          </nav>
        )}

        <div className="docs-page-actions">
          <div className="docs-action-menu-wrap" ref={menuRef}>
            <button
              type="button"
              className="docs-action-btn"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label={t('editor.pageOptions')}
            >
              ···
            </button>
            {menuOpen && (
              <div className="docs-page-menu">
                <button type="button" className="docs-page-menu-item" onClick={copyLink}>
                  {t('editor.copyLink')}
                </button>
                <button type="button" className="docs-page-menu-item" onClick={copyContents}>
                  {t('editor.copyContents')}
                </button>
                {onDuplicate && (
                  <button type="button" className="docs-page-menu-item" onClick={onDuplicate}>
                    {t('editor.duplicate')}
                  </button>
                )}
                <button type="button" className="docs-page-menu-item" onClick={archivePage}>
                  {t('editor.archive')}
                </button>
                <hr className="docs-page-menu-divider" />
                <button
                  type="button"
                  className="docs-page-menu-item docs-page-menu-toggle"
                  onClick={() => {
                    setSmallText((v) => !v);
                    setMenuOpen(false);
                  }}
                >
                  {t('editor.smallText')}
                  <span className={`docs-toggle${smallText ? ' on' : ''}`} />
                </button>
                <button
                  type="button"
                  className="docs-page-menu-item docs-page-menu-toggle"
                  onClick={() => {
                    setFullWidth((v) => !v);
                    setMenuOpen(false);
                  }}
                >
                  {t('editor.fullWidth')}
                  <span className={`docs-toggle${fullWidth ? ' on' : ''}`} />
                </button>
                <hr className="docs-page-menu-divider" />
                {onDelete && (
                  <button
                    type="button"
                    className="docs-page-menu-item docs-page-menu-danger"
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

      {coverUrl ? (
        <div className="docs-cover">
          <img src={coverUrl} alt="" className="docs-cover-img" />
          <button type="button" className="docs-cover-remove" onClick={removeCover}>
            {t('editor.removeCover')}
          </button>
        </div>
      ) : (
        <div className="docs-cover-placeholder">
          <button type="button" className="docs-cover-add" onClick={() => setCoverOpen(true)}>
            {t('editor.addCover')}
          </button>
          {coverOpen && (
            <div className="docs-cover-popover" ref={coverRef}>
              <input
                type="text"
                placeholder={t('editor.coverUrlPlaceholder')}
                className="docs-cover-input"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addCover((e.target as HTMLInputElement).value);
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

      <div className="docs-page-header">
        <EmojiPicker value={icon} onChange={(next) => {
          setIcon(next);
          triggerSave(undefined, undefined, next);
        }}>
          <span className="docs-icon">{icon}</span>
        </EmojiPicker>
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

      <div className="docs-page-meta">
        <button type="button" className="docs-meta-btn">
          {t('editor.addIcon')}
        </button>
        <button type="button" className="docs-meta-btn" onClick={() => setCoverOpen(true)}>
          {t('editor.addCover')}
        </button>
        <button type="button" className="docs-meta-btn" onClick={() => onAddComment?.()}>
          {t('editor.addComment')}
        </button>
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
                    <circle cx="2" cy="2" r="1.2" />
                    <circle cx="8" cy="2" r="1.2" />
                    <circle cx="2" cy="7" r="1.2" />
                    <circle cx="8" cy="7" r="1.2" />
                    <circle cx="2" cy="12" r="1.2" />
                    <circle cx="8" cy="12" r="1.2" />
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
                          ›
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
                              <span className="docs-command-icon">{BLOCK_ICONS[cmd.type]}</span>
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
                      <span className="docs-block-comment-count mono">{commentCount}</span>
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
              {cmdOpen && focusIndex === index && (
                <div className="docs-command-menu">
                  <div className="docs-command-title">{t('editor.basicBlocks')}</div>
                  {filteredCommands.map((cmd, i) => (
                    <button
                      key={cmd.key}
                      type="button"
                      className={`docs-command-item${i === cmdSel ? ' sel' : ''}`}
                      onClick={() => applyCommand(index, cmd)}
                    >
                      <span className="docs-command-icon">{BLOCK_ICONS[cmd.type]}</span>
                      <span className="docs-command-label">{cmd.label}</span>
                      {cmd.shortcut && (
                        <span className="docs-command-shortcut">{cmd.shortcut}</span>
                      )}
                    </button>
                  ))}
                  {filteredCommands.length === 0 && (
                    <div className="docs-command-empty">{t('editor.noCommands')}</div>
                  )}
                </div>
              )}
              {mention && focusIndex === index && (
                <MentionPopover
                  query={mention.query}
                  onSelect={onSelectMention}
                  onClose={() => setMention(null)}
                />
              )}
              {userMention && focusIndex === index && (
                <UserMentionPopover
                  query={userMention.query}
                  onSelect={onSelectUserMention}
                  onClose={() => setUserMention(null)}
                />
              )}
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
                  +
                </button>
              </div>
            </Fragment>
          );
        })}
        {dropLine !== null && (
          <div className="docs-drop-line" style={{ top: dropLine }} aria-hidden />
        )}
      </div>

      <div className="docs-editor-foot">
        <span className="docs-save-status">{saving ? t('editor.saving') : t('editor.saved')}</span>
      </div>
    </div>
  );
}
