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
  type MutableRefObject,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { createPortal } from 'react-dom';
import { Link } from '@/i18n/navigation';
import {
  defaultBlocks,
  type DocsBlock,
  type DocsButtonConfig,
  type DocsDatabase,
  type DocsBlockType,
  type DocsMentionableUser,
  type DocsPage,
} from '@/lib/docs-types';
import {
  findVerticalTarget,
  getCaretOffset,
  getCaretViewportRect,
  getSelectionOffsets,
  isCaretOnEdgeLine,
  placeCaretAtX,
  setCaretOffset,
  setSelectionOffsets,
} from '@/lib/docs-caret';
import {
  acceptFor,
  ICON_IMAGE_PREFIX,
  iconImageUrl,
  pageImageHref,
  fileBlockFromUpload,
  fileKindForRequest,
  isFileBlockType,
  docsFileHref,
  formatFileSize,
  type DocsFileKind,
  type DocsFileSource,
} from '@/lib/docs-files';
import { DocsUploadError, uploadDocsFile, uploadLimit } from '@/lib/docs-upload-client';
import {
  containerOf,
  columnRatio,
  columnsIn,
  dropBeside,
  isStructuralBlock,
  makeColumnList,
  normalizeStructure,
  resizeRatios,
  scopeBaseIndent,
  visualIndent,
  MAX_COLUMNS,
} from '@/lib/docs-columns';
import { embedFor, pastedUrl } from '@/lib/docs-embeds';
import { commandMatches } from '@/lib/docs-blocks';
import { dateLabel, dateMentionHtml, dateSuggestions, localInstant } from '@/lib/docs-dates';
import { buildToc } from '@/lib/docs-toc';
import { markdownToBlocks } from '@/lib/docs-import';
import { sanitizeHtml as sanitizeRichHtml } from '@/lib/docs-richtext';
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
import { pageLinkHref, pageLinkHtml, type PageLinkCandidate, type PageLinkSource } from '@/lib/docs-page-links';
import { databasePatch, defaultDatabase, normalizeDatabase } from '@/lib/docs-database';
import {
  blockIndent,
  deleteRange,
  duplicateRange,
  expandRange,
  hiddenBlocks,
  indentRange,
  insertionPoint,
  isToggleBlock,
  listNumbers,
  moveRange,
  nextVisible,
  normalizeIndents,
  setIndent,
  subtreeEnd,
} from '@/lib/docs-blocks';
import { blocksToMarkdown } from '@/lib/docs-markdown';
import {
  emptyHistory,
  firstChangedBlock,
  historyShortcut,
  recordChange,
  redoStep,
  undoStep,
  type DocsHistory,
  type DocsSnapshot,
} from '@/lib/docs-history';
import { DOCS_IMPORT_MAX_BYTES, docsImportKind } from '@/lib/docs-import';
import DocsBlockEditor from './DocsBlockEditor';
import { useDocsCollab, type DocsEditorApi, type DocsEditorMode } from './useDocsCollab';
import MentionPopover from './MentionPopover';
import UserMentionPopover, { type DateMentionOption } from './UserMentionPopover';
import { fetchLinkPreview } from './DocsLinkBlocks';
import { InlineEquationEditor } from './DocsAdvancedBlocks';
import DocsPageIcon from './DocsPageIcon';
import DocsCoverPicker, { DocsCover } from './DocsCoverPicker';
import DocsTemplateGallery from './DocsTemplateGallery';
import type { DocTemplate } from '@/lib/docs-templates';
import EmojiPicker from './EmojiPicker';
import DocsGlyph, { type DocsGlyphName } from './DocsGlyphs';
import DbRowPanel, { type DbRowPanelMode } from './database/DbRowPanel';
import { rememberUploadPreview, uploadPreview } from './DocsEditorImage';
import DocsEditorPlugins, { type DocsPluginApi, type DocsPluginHandle } from './DocsEditorPlugins';

/** Lo que el servidor fusionó (una automatización, una base, otra pestaña): se suma a lo que hay en pantalla. */
export interface DocsRemoteMerge {
  seq: number;
  /** Lo que mandó este editor (o la última versión del servidor que vio). */
  sent: DocsBlock[];
  /** Lo que quedó guardado. */
  merged: DocsBlock[];
  sentTitle?: string;
  title?: string;
}

interface DocsEditorProps {
  page: DocsPage;
  remoteMerge?: DocsRemoteMerge | null;
  /** Ya se sumó a la pantalla (con el resultado: título y bloques). */
  onRemoteApplied?: (seq: number, merged: DocsSnapshot) => void;
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
   * portada, ícono ni menciones @ (miembros de Docs). Los links [[ y los
   * archivos solo si se pasan `pageLinks` / `files` (con sus propias rutas).
   */
  embedded?: boolean;
  /** Links [[ a otra cosa que páginas de Docs (Notes: a otras notas). */
  pageLinks?: PageLinkSource;
  /** Rutas propias de subida y descarga de archivos (Notes). */
  files?: DocsFileSource;
  /** Acciones extra en la barra superior (Share, Comments). */
  topActions?: ReactNode;
  /** Items extra del menú "···" (export, versiones). Reciben un cierre del menú. */
  menuExtra?: (close: () => void) => ReactNode;
  /** Muestra los toggles de layout (texto chico / ancho completo); solo el dueño. */
  layoutToggles?: boolean;
  /** Debajo del título (p. ej. "Enlazada desde"). */
  belowTitle?: ReactNode;
  /** Ruta que convierte un .md/.docx en bloques (menú "···" › Importar). Sin ella no hay importación. */
  importUrl?: string;
  /** Placeholder del título (Notes: "Nota sin título"). */
  titlePlaceholder?: string;
  /** Ofrecer el bloque base de datos (no en el cuerpo de una fila: no se anidan bases). */
  allowDatabase?: boolean;
  /**
   * Colaboración (Docs): 'suggest' = lo que se escribe queda como sugerencia;
   * 'readonly' = solo leer y comentar sobre el texto (página bloqueada o
   * permiso de comentar). Default 'edit'.
   */
  mode?: DocsEditorMode;
  /** Acceso imperativo para fusionar cambios en vivo, comentar y resolver sugerencias. */
  apiRef?: MutableRefObject<DocsEditorApi | null>;
  /** Quien escribe (firma de las sugerencias). */
  currentUserId?: string | null;
  /** Botón "Comentar" de la toolbar de selección. */
  onInlineComment?: (sel: { blockId: string; start: number; end: number; quote: string }) => void;
}

/** Acciones del menú `/` que no son "convertir este bloque en otro tipo". */
type CommandSpecial = 'columns' | 'date' | 'reminder' | 'inlineEquation' | 'ai' | 'syncedDatabase';

const BLOCK_COMMANDS: {
  key: string;
  type: DocsBlockType;
  level?: 1 | 2 | 3;
  /** Heading con toggle. */
  toggle?: boolean;
  /** Base: vista vinculada de otra base. */
  linked?: boolean;
  shortcut?: string;
  special?: CommandSpecial;
  /** Columnas: cuántas. */
  count?: number;
  /** Sección del menú `/`. */
  group?: 'basic' | 'media' | 'advanced' | 'inline';
}[] = [
  { key: 'p', type: 'paragraph' },
  { key: 'h1', type: 'heading', level: 1, shortcut: '#' },
  { key: 'h2', type: 'heading', level: 2, shortcut: '##' },
  { key: 'h3', type: 'heading', level: 3, shortcut: '###' },
  { key: 'bulleted', type: 'bulleted_list_item', shortcut: '-' },
  { key: 'numbered', type: 'numbered_list_item', shortcut: '1.' },
  { key: 'todo', type: 'todo', shortcut: '[ ]' },
  { key: 'toggle', type: 'toggle', shortcut: '>>' },
  { key: 'th1', type: 'heading', level: 1, toggle: true },
  { key: 'th2', type: 'heading', level: 2, toggle: true },
  { key: 'th3', type: 'heading', level: 3, toggle: true },
  { key: 'callout', type: 'callout' },
  { key: 'quote', type: 'quote', shortcut: '>' },
  { key: 'code', type: 'code', shortcut: '```' },
  { key: 'divider', type: 'divider' },
  { key: 'table', type: 'table' },
  { key: 'database', type: 'database' },
  { key: 'linkedDatabase', type: 'database', linked: true },
  { key: 'image', type: 'image', group: 'media' },
  { key: 'video', type: 'video', group: 'media' },
  { key: 'audio', type: 'audio', group: 'media' },
  { key: 'pdf', type: 'pdf', group: 'media' },
  { key: 'file', type: 'file', group: 'media' },
  { key: 'bookmark', type: 'bookmark', group: 'media' },
  { key: 'embed', type: 'embed', group: 'media' },
  { key: 'board', type: 'board', group: 'media' },
  // Tanda D4: IA, notas de reunión y bases sincronizadas (components/docs/DocsEditorPlugins.tsx).
  { key: 'ai', type: 'paragraph', special: 'ai', group: 'advanced' },
  { key: 'meeting', type: 'meeting', group: 'advanced' },
  { key: 'syncedDatabase', type: 'database', special: 'syncedDatabase', group: 'advanced' },
  { key: 'col2', type: 'columns', special: 'columns', count: 2, group: 'advanced' },
  { key: 'col3', type: 'columns', special: 'columns', count: 3, group: 'advanced' },
  { key: 'col4', type: 'columns', special: 'columns', count: 4, group: 'advanced' },
  { key: 'col5', type: 'columns', special: 'columns', count: 5, group: 'advanced' },
  { key: 'synced', type: 'synced', group: 'advanced' },
  { key: 'equation', type: 'equation', group: 'advanced' },
  { key: 'toc', type: 'toc', group: 'advanced' },
  { key: 'button', type: 'button', group: 'advanced' },
  { key: 'breadcrumb', type: 'breadcrumb', group: 'advanced' },
  { key: 'date', type: 'paragraph', special: 'date', group: 'inline' },
  { key: 'reminder', type: 'paragraph', special: 'reminder', group: 'inline' },
  { key: 'inlineEquation', type: 'equation', special: 'inlineEquation', group: 'inline' },
];

/** Bloques atómicos (se enfocan enteros): archivos, links, pizarra y los avanzados. */
const CARD_TYPES = new Set<DocsBlockType>(['board', 'bookmark', 'embed', 'equation', 'toc', 'button', 'breadcrumb', 'meeting']);
function isCardBlockType(type: DocsBlockType): boolean {
  return isFileBlockType(type) || CARD_TYPES.has(type);
}

/** Bloques que se crean enteros (no se convierte un texto en ellos): van debajo con un párrafo. */
const INSERT_TYPES = new Set<DocsBlockType>(['board', 'bookmark', 'embed', 'equation', 'toc', 'button', 'breadcrumb', 'meeting']);

/** "Convertir en": los bloques de archivo, link, contenedores y avanzados no salen de un texto. */
const TURN_INTO_COMMANDS = BLOCK_COMMANDS.filter(
  (c) => !isCardBlockType(c.type) && !c.special && c.type !== 'synced' && c.type !== 'columns',
);

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
  toggle: ['toggle', 'collapse', 'details', 'fold', 'desplegable', 'alternar', 'recolher'],
  th1: ['toggle heading', 'toggle h1', 'heading toggle', 'th1'],
  th2: ['toggle heading', 'toggle h2', 'heading toggle', 'th2'],
  th3: ['toggle heading', 'toggle h3', 'heading toggle', 'th3'],
  callout: ['callout', 'note', 'tip', 'warning', 'info', 'aviso', 'nota', 'destaque'],
  code: ['code', 'snippet', 'pre', '```'],
  divider: ['divider', 'hr', 'line', 'separator', '---'],
  table: ['table', 'grid'],
  database: ['database', 'db', 'table', 'grid', 'view', 'data'],
  linkedDatabase: ['linked', 'linked view', 'view of database', 'vista vinculada', 'visualização vinculada', 'database view'],
  image: ['image', 'picture', 'photo', 'img', 'upload', 'imagen', 'foto', 'imagem'],
  file: ['file', 'attachment', 'upload', 'pdf', 'document', 'archivo', 'adjunto', 'arquivo', 'anexo'],
  board: ['board', 'whiteboard', 'canvas', 'excalidraw', 'pizarra', 'quadro', 'lousa'],
  video: ['video', 'movie', 'mp4', 'vídeo'],
  audio: ['audio', 'sound', 'music', 'mp3', 'podcast', 'sonido', 'áudio'],
  pdf: ['pdf', 'document', 'documento'],
  bookmark: ['bookmark', 'link', 'url', 'preview', 'marcador', 'enlace'],
  embed: ['embed', 'iframe', 'youtube', 'vimeo', 'loom', 'figma', 'maps', 'codepen', 'twitter', 'gist', 'spotify', 'miro', 'incrustar', 'incorporar'],
  col2: ['columns', 'column', '2', 'layout', 'columnas', 'colunas'],
  col3: ['columns', 'column', '3', 'layout', 'columnas', 'colunas'],
  col4: ['columns', 'column', '4', 'layout', 'columnas', 'colunas'],
  col5: ['columns', 'column', '5', 'layout', 'columnas', 'colunas'],
  synced: ['synced', 'sync', 'sincronizado', 'sincronizar'],
  equation: ['equation', 'math', 'latex', 'katex', 'formula', 'ecuación', 'equação', 'tex'],
  toc: ['toc', 'table of contents', 'contents', 'índice', 'indice', 'sumário', 'sumario'],
  button: ['button', 'botón', 'boton', 'botão', 'action'],
  breadcrumb: ['breadcrumb', 'path', 'ruta', 'migas', 'caminho'],
  date: ['date', 'today', 'tomorrow', 'fecha', 'hoy', 'data', 'hoje', '@'],
  reminder: ['remind', 'reminder', 'recordatorio', 'recordar', 'lembrete', 'alarm'],
  inlineEquation: ['inline equation', 'math', 'latex', 'ecuación en línea', 'equação em linha', '$$'],
  ai: ['ai', 'ask ai', 'ia', 'write', 'summarize', 'translate', 'escribir', 'resumir', 'traducir', 'escrever', 'traduzir'],
  meeting: ['meeting', 'meet', 'notes', 'transcribe', 'record', 'reunión', 'reunion', 'notas', 'grabar', 'transcribir', 'reunião', 'gravar'],
  syncedDatabase: ['synced database', 'sync', 'github', 'jira', 'salesforce', 'crm', 'base sincronizada', 'banco sincronizado', 'issues'],
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
  image: 'image',
  file: 'file',
  toggle: 'toggle',
  callout: 'callout',
  board: 'board',
  video: 'video',
  audio: 'audio',
  pdf: 'pdf',
  columns: 'columns',
  column: 'columns',
  bookmark: 'bookmark',
  embed: 'embed',
  synced: 'synced',
  equation: 'equation',
  toc: 'toc',
  button: 'button',
  breadcrumb: 'breadcrumb',
  meeting: 'meeting',
};

/** Ícono de un comando del menú `/` (los especiales tienen el suyo). */
function commandIcon(cmd: { type: DocsBlockType; special?: CommandSpecial }): DocsGlyphName {
  if (cmd.special === 'date') return 'calendar';
  if (cmd.special === 'reminder') return 'bell';
  if (cmd.special === 'ai') return 'sparkle';
  if (cmd.special === 'syncedDatabase') return 'sync';
  return BLOCK_ICONS[cmd.type];
}

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
  /** Nivel con que entra (dentro de una columna o un sincronizado); sin esto, el del bloque de arriba. */
  dropIndent?: number;
  /** Soltar al costado de un bloque: crea columnas. */
  side?: { target: number; side: 'left' | 'right' } | null;
}

/** Línea indicadora de drop (px relativos a .docs-blocks); vertical = al costado (columnas). */
interface DropLine {
  top: number;
  left: number;
  width: number;
  height?: number;
  vertical?: boolean;
}

/** Dónde caería un bloque arrastrado (o un archivo soltado) en ese punto. */
interface DropTarget {
  index: number;
  indent?: number;
  side: { target: number; side: 'left' | 'right' } | null;
  line: DropLine;
}

/** Bloques cuyo contenido es texto editable en línea (no divider/table/database/archivos/contenedores). */
function isTextBlockType(type: DocsBlockType): boolean {
  return (
    type !== 'divider' &&
    type !== 'table' &&
    type !== 'database' &&
    !isCardBlockType(type) &&
    !isStructuralBlock({ type }) &&
    type !== 'synced'
  );
}

const newId = () => crypto.randomUUID();

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

/** Atajos markdown al inicio de un párrafo: "# ", "- ", "1. ", "[] ", "> ", ">> " (toggle). */
function matchMarkdownPrefix(text: string): { type: DocsBlockType; level?: 1 | 2 | 3 } | null {
  if (text === '#') return { type: 'heading', level: 1 };
  if (text === '##') return { type: 'heading', level: 2 };
  if (text === '###') return { type: 'heading', level: 3 };
  if (text === '-' || text === '*') return { type: 'bulleted_list_item' };
  if (/^\d+\.$/.test(text)) return { type: 'numbered_list_item' };
  if (text === '[]' || text === '[ ]') return { type: 'todo' };
  if (text === '>') return { type: 'quote' };
  if (text === '>>') return { type: 'toggle' };
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
  remoteMerge = null,
  onRemoteApplied,
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
  pageLinks,
  files,
  belowTitle,
  topActions,
  menuExtra,
  layoutToggles = true,
  importUrl,
  titlePlaceholder,
  allowDatabase = true,
  mode = 'edit',
  apiRef,
  currentUserId = null,
  onInlineComment,
}: DocsEditorProps) {
  const t = useTranslations('docs');
  const locale = useLocale();
  const searchParams = useSearchParams();
  const [blocks, setBlocksRaw] = useState<DocsBlock[]>(() =>
    normalizeStructure(upgradeBlocks(page.content.length ? page.content : defaultBlocks()), newId),
  );
  /**
   * Toda escritura de bloques pasa por acá: columnas y bloques sincronizados
   * quedan siempre válidos (una columna vacía se va, una fila de una sola
   * columna se deshace). El servidor aplica lo mismo al guardar.
   */
  const setBlocks = useCallback((update: DocsBlock[] | ((prev: DocsBlock[]) => DocsBlock[])) => {
    setBlocksRaw((prev) => normalizeStructure(typeof update === 'function' ? update(prev) : update, newId));
  }, []);
  const [title, setTitle] = useState(page.title);
  /** IA del editor y bases sincronizadas (components/docs/DocsEditorPlugins.tsx). */
  const pluginRef = useRef<DocsPluginHandle | null>(null);
  const [icon, setIcon] = useState(page.icon ?? '');
  const [coverUrl, setCoverUrl] = useState(page.cover_url ?? '');
  const [coverPosition, setCoverPosition] = useState(page.cover_position ?? 50);
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
  /** Caret pendiente de aplicar después del próximo render (split/merge/conversión). */
  const pendingCaret = useRef<{ index: number; offset: number } | null>(null);
  /** Párrafo que recibe el foco cuando termina una subida (ver uploadFiles). */
  const pendingFocusId = useRef<string | null>(null);
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
  const [dropLine, setDropLine] = useState<DropLine | null>(null);
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
  /** Editor de una ecuación en línea: rango plano [start, start+length) del span (0 = nueva). */
  const [eqPopover, setEqPopover] = useState<{ index: number; start: number; length: number; tex: string; top: number; left: number } | null>(null);
  /** Link pegado solo: ofrecer mención, bookmark o embed (como Notion). */
  const [pastePrompt, setPastePrompt] = useState<{ index: number; blockId: string; url: string; start: number; end: number; top: number; left: number; embeddable: boolean } | null>(null);
  const linkPopoverRef = useRef<HTMLDivElement | null>(null);
  const linkInputRef = useRef<HTMLInputElement | null>(null);
  /** Espejo del estado para el listener de selectionchange (sin re-suscribir). */
  const linkDialogRef = useRef(linkDialog);
  linkDialogRef.current = linkDialog;
  /** Imágenes y archivos (menú `/`, pegar, soltar): en Docs, o embebido con rutas propias (Notes). */
  const uploadsEnabled = !embedded || Boolean(files);
  const uploadUrl = files?.uploadUrl ?? `/api/docs/pages/${page.id}/files`;
  const fileSourceHref = files?.href;
  const fileHref = useCallback(
    (blockId: string, opts?: { download?: boolean }) =>
      fileSourceHref ? fileSourceHref(blockId, opts) : docsFileHref(page.id, blockId, opts),
    [fileSourceHref, page.id],
  );
  /** Links `[[`: páginas de Docs, o lo que diga `pageLinks` cuando está embebido. */
  const pageLinksEnabled = !embedded || Boolean(pageLinks);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  /** Destino del selector de archivos abierto desde el menú `/`. */
  const uploadTarget = useRef<{ anchorId: string | null; replaceId: string | null; kind: DocsFileKind } | null>(null);
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  /** Línea de drop (px, relativa a .docs-blocks) al arrastrar archivos del sistema. */
  const [fileDropLine, setFileDropLine] = useState<DropLine | null>(null);
  /**
   * Selección de bloques (Esc, o Shift+↑/↓ en el borde del bloque): rango de
   * índices con ancla y foco. Mientras hay selección el foco está en el
   * contenedor de bloques y su teclado mueve, duplica, borra o anida.
   */
  const [blockSel, setBlockSel] = useState<{ anchor: number; focus: number } | null>(null);
  const selMin = blockSel ? Math.min(blockSel.anchor, blockSel.focus) : -1;
  const selMax = blockSel ? Math.max(blockSel.anchor, blockSel.focus) : -1;
  /** Bloques dentro de un toggle plegado: no se muestran ni reciben foco. */
  const hidden = useMemo(() => hiddenBlocks(blocks), [blocks]);
  const numbers = useMemo(() => listNumbers(blocks), [blocks]);
  /** Bloques adentro de un sincronizado que quien mira no puede editar (no edita su origen). */
  const noEdit = useMemo(() => {
    const out = new Array<boolean>(blocks.length).fill(false);
    blocks.forEach((b, i) => {
      if (b.type !== 'synced' || !b.no_edit) return;
      for (let j = i + 1; j <= subtreeEnd(blocks, i); j++) out[j] = true;
    });
    return out;
  }, [blocks]);
  const noEditRef = useRef(noEdit);
  noEditRef.current = noEdit;
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);
  /**
   * Deshacer / rehacer propio (lib/docs-history.ts): el undo nativo del
   * contentEditable nunca corre. `lastSnap` es la última foto registrada;
   * `live` es el estado del render actual.
   */
  const historyRef = useRef<DocsHistory>(emptyHistory());
  const lastSnap = useRef<DocsSnapshot | null>(null);
  const live = useRef<DocsSnapshot>({ title, blocks });
  live.current = { title, blocks };
  /** Bloques recién cargados (al abrir o cambiar de página): hasta pintarlos no se registra nada. */
  const pendingLoad = useRef<DocsBlock[] | null>(null);

  useEffect(() => {
    const loaded = normalizeStructure(upgradeBlocks(page.content.length ? page.content : defaultBlocks()), newId);
    // Página nueva: el historial arranca de cero cuando se pinta lo cargado.
    pendingLoad.current = loaded;
    setBlocksRaw(loaded);
    setTitle(page.title);
    setIcon(page.icon ?? '');
    setCoverUrl(page.cover_url ?? '');
    setCoverPosition(page.cover_position ?? 50);
    setBlockMenu(null);
    setToolbar(null);
    setLinkDialog(null);
    // Solo al cambiar de página: re-sincronizar con cada prop pisaría lo que se está escribiendo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id]);

  /** Fusión remota en curso (useDocsCollab): no es un paso propio del historial. */
  const consumeRemoteRef = useRef<(next: DocsSnapshot) => boolean>(() => false);

  // Cada cambio de título o bloques (tipeo, Enter, borrar, mover, pegar,
  // subir un archivo…) deja un paso en el historial; el tipeo se agrupa.
  useEffect(() => {
    const next = { title, blocks };
    if (pendingLoad.current) {
      if (blocks === pendingLoad.current) {
        pendingLoad.current = null;
        historyRef.current = emptyHistory();
      }
      lastSnap.current = next;
      return;
    }
    if (consumeRemoteRef.current(next)) return;
    if (lastSnap.current) {
      historyRef.current = recordChange(historyRef.current, lastSnap.current, next, Date.now());
    }
    lastSnap.current = next;
  }, [title, blocks]);

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
      // El foco ya está adentro del bloque (leyenda, campo de un link o de una ecuación): no se lo saca.
      const active = document.activeElement;
      if (el && active && active !== el && el.contains(active)) return;
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

  // Al terminar una subida: el cursor a la línea de abajo del bloque (como
  // Notion), si la persona no se fue a otro lado mientras subía.
  useLayoutEffect(() => {
    const id = pendingFocusId.current;
    if (!id) return;
    const i = blocks.findIndex((b) => b.id === id);
    if (i === -1) return;
    pendingFocusId.current = null;
    const active = document.activeElement;
    const root = rootRef.current;
    if (active && active !== document.body && !(root && root.contains(active)) && active.tagName !== 'INPUT') return;
    const el = blockRefs.current[i];
    if (!el) return;
    el.focus();
    setCaretOffset(el, 0);
    prevFocus.current = i;
    setFocusIndex(i);
  }, [blocks]);

  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
    const onClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [menuOpen]);


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

  /** Última versión de triggerSave para callbacks async (subidas): no guardar un título viejo. */
  const triggerSaveRef = useRef(triggerSave);
  triggerSaveRef.current = triggerSave;

  // Agregados de la tanda D4: leen el estado actual y escriben como cualquier edición (deshacer incluido).
  const blocksNow = useRef(blocks);
  blocksNow.current = blocks;
  const titleNow = useRef(title);
  titleNow.current = title;
  const pluginApi = useMemo<DocsPluginApi>(
    () => ({
      pageId: page.id,
      getTitle: () => titleNow.current,
      getBlocks: () => blocksNow.current,
      insertBlocks: (index, created, opts) => {
        const prev = blocksNow.current;
        const target = prev[index];
        const empty = Boolean(opts?.replaceEmpty && target?.type === 'paragraph' && !htmlToFlatText(target.content ?? '').trim());
        const base = target ? blockIndent(target) : 0;
        const placed = created.map((b) => setIndent({ ...b, id: b.id || newId() }, blockIndent(b) + base));
        if (!placed.length) return;
        const at = !target ? prev.length : empty ? index : subtreeEnd(prev, index) + 1;
        const next = [...prev];
        next.splice(at, empty ? 1 : 0, ...placed);
        setBlocks(next);
        triggerSaveRef.current(next);
        // El cursor queda al final de lo insertado (como al aceptar en Notion).
        const last = at + placed.length - 1;
        pendingCaret.current = { index: last, offset: htmlToFlatText(placed[placed.length - 1].content ?? '').length };
        setFocusIndex(last);
        setFocusTick((v) => v + 1);
      },
      focusBlock: (index) => {
        const b = blocksNow.current[index];
        if (!b) return;
        pendingCaret.current = { index, offset: htmlToFlatText(b.content ?? '').length };
        setFocusIndex(index);
        setFocusTick((v) => v + 1);
      },
      replaceSelection: (index, start, end, created) => {
        const prev = blocksNow.current;
        const target = prev[index];
        if (!target || !created.length) return;
        const [before, rest] = splitHtmlAt(target.content, start);
        const after = splitHtmlAt(rest, Math.max(0, end - start))[1];
        let next: DocsBlock[];
        let caret: { index: number; offset: number };
        if (created.length === 1 && created[0].type === 'paragraph') {
          next = prev.map((b, i) => (i === index ? { ...b, content: `${before}${created[0].content}${after}` } : b));
          caret = { index, offset: htmlToFlatText(`${before}${created[0].content}`).length };
        } else {
          const placed = created.map((b) => setIndent({ ...b }, blockIndent(b) + blockIndent(target)));
          next = [...prev];
          if (!`${htmlToFlatText(before)}${htmlToFlatText(after)}`.trim()) {
            next.splice(index, 1, ...placed);
            caret = { index: index + placed.length - 1, offset: htmlToFlatText(placed[placed.length - 1].content ?? '').length };
          } else {
            next[index] = { ...target, content: `${before}${after}` };
            next.splice(index + 1, 0, ...placed);
            caret = { index: index + placed.length, offset: htmlToFlatText(placed[placed.length - 1].content ?? '').length };
          }
        }
        setBlocks(next);
        triggerSaveRef.current(next);
        pendingCaret.current = caret;
        setFocusIndex(caret.index);
        setFocusTick((v) => v + 1);
      },
    }),
    [page.id, setBlocks],
  );

  /**
   * Deshacer (dir -1) o rehacer (+1): vuelve a la foto, la guarda y deja el
   * caret al final del primer bloque que cambió (o en el título).
   */
  const stepHistory = useCallback((dir: -1 | 1) => {
    // Lo último tipeado que todavía no llegó al efecto entra antes de deshacer.
    const base = lastSnap.current ?? live.current;
    historyRef.current = recordChange(historyRef.current, base, live.current, Date.now());
    const current = live.current;
    const res = dir === -1 ? undoStep(historyRef.current, current) : redoStep(historyRef.current, current);
    if (!res) return;
    historyRef.current = res.history;
    const snap = res.snapshot;
    lastSnap.current = snap;
    setBlocks(snap.blocks);
    setTitle(snap.title);
    triggerSaveRef.current(snap.blocks, snap.title);
    setBlockSel(null);
    setBlockMenu(null);
    setTurnIntoOpen(false);
    setToolbar(null);
    setLinkDialog(null);
    setCmdOpen(false);
    setSlash(null);
    setMention(null);
    setUserMention(null);
    const i = firstChangedBlock(current.blocks, snap.blocks);
    if (i === -1) {
      if (snap.title !== current.title) {
        const el = titleRef.current;
        if (el) {
          el.textContent = snap.title;
          el.focus();
          setCaretOffset(el, snap.title.length);
        }
      }
      return;
    }
    const b = snap.blocks[i];
    if (b && isTextBlockType(b.type)) {
      pendingCaret.current = { index: i, offset: htmlToFlatText(b.content).length };
      setFocusIndex(i);
      setFocusTick((v) => v + 1);
    } else {
      requestAnimationFrame(() => blockRefs.current[i]?.focus());
    }
  }, [, setBlocks]);

  // Cmd/Ctrl+Z con el foco fuera de todo (después de un click en el fondo):
  // también deshace en el editor. Con el foco adentro lo atrapa onKeyDownCapture.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = historyShortcut(e);
      if (!action) return;
      const active = document.activeElement;
      if (active && active !== document.body) return;
      if (document.querySelector('dialog[open]')) return;
      e.preventDefault();
      stepHistory(action === 'undo' ? -1 : 1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [stepHistory]);

  /** Atajos de historial dentro del editor (bloques, título, selección de bloques). */
  const handleHistoryKeys = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const action = historyShortcut(e);
    if (!action) return;
    const target = e.target as HTMLElement;
    // Campos de formulario (celdas, lenguaje del código, link): su propio undo.
    if (!target.isContentEditable && target.closest('input, textarea, select')) return;
    e.preventDefault();
    e.stopPropagation();
    stepHistory(action === 'undo' ? -1 : 1);
  };

  // Deshacer desde el menú del navegador (Edición › Deshacer): mismo historial.
  // beforeinput nativo (el onBeforeInput de React no trae inputType).
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onBeforeInput = (e: InputEvent) => {
      if (e.inputType !== 'historyUndo' && e.inputType !== 'historyRedo') return;
      e.preventDefault();
      stepHistory(e.inputType === 'historyUndo' ? -1 : 1);
    };
    root.addEventListener('beforeinput', onBeforeInput);
    return () => root.removeEventListener('beforeinput', onBeforeInput);
  }, [stepHistory]);

  const modeRef = useRef(mode);
  modeRef.current = mode;
  const collab = useDocsCollab({
    mode,
    userId: currentUserId,
    newId,
    live,
    lastSnap,
    historyRef,
    blockRefs,
    setBlocksRaw,
    setTitle,
    normalize: (list) => normalizeStructure(list, newId),
    triggerSave: (b, ti) => triggerSaveRef.current(b, ti),
    saveTimeout,
    pendingSave,
    setDirty,
    apiRef,
    rootRef,
    titleRef,
  });
  consumeRemoteRef.current = collab.consumeRemote;

  // Lo que cambió en el servidor (la respuesta fusionada de un guardado, la
  // versión de otra persona que trae el pulso en vivo, una automatización):
  // entra sin pisar lo que se editó acá desde entonces (lib/docs-merge.ts).
  const appliedMerge = useRef(0);
  const applyRemote = collab.api.applyRemote;
  useEffect(() => {
    if (!remoteMerge || remoteMerge.seq <= appliedMerge.current) return;
    appliedMerge.current = remoteMerge.seq;
    const cur = live.current;
    const baseTitle = remoteMerge.sentTitle ?? cur.title;
    const res = applyRemote({ title: baseTitle, blocks: remoteMerge.sent }, { title: remoteMerge.title ?? baseTitle, blocks: remoteMerge.merged });
    // Un guardado pendiente se armó con lo de antes: va con lo fusionado.
    if (res.changed && pendingSave.current) triggerSaveRef.current(res.merged.blocks, res.merged.title);
    onRemoteApplied?.(remoteMerge.seq, res.merged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteMerge, onRemoteApplied]);
  const { suggestChange, onCompositionEnd, composing } = collab;
  /** Teclas del modo sugerir (se define más abajo, junto al cambio de bloque). */
  const suggestKeyDownRef = useRef<(index: number, e: React.KeyboardEvent<HTMLElement>) => boolean>(() => false);

  /**
   * Sube archivos y crea un bloque image/file por cada uno, después de
   * `anchorId` (null = al principio). `replaceId`: párrafo vacío que se
   * reemplaza por el primer bloque (ej. "/imagen" en una línea vacía). Se
   * ubica por id: mientras sube, la persona puede seguir editando.
   */
  const uploadFiles = useCallback(
    async (
      files: File[],
      anchorId: string | null,
      opts: { replaceId?: string | null; kind?: DocsFileKind; indent?: number } = {},
    ) => {
      if (!uploadsEnabled || files.length === 0) return;
      setUploadError(null);
      let anchor = anchorId;
      let replaceId = opts.replaceId ?? null;
      let placedAny = false;
      const max = await uploadLimit(uploadUrl);
      for (const file of files) {
        if (file.size > max) {
          setUploadError(t('editor.upload.tooLarge', { name: file.name, max: formatFileSize(max) }));
          continue;
        }
        setUploading((n) => n + 1);
        try {
          const up = await uploadDocsFile(file, { uploadUrl });
          rememberUploadPreview(up.url, file);
          // "/imagen" (o video, PDF) con algo que no se muestra así: queda con el tipo que le corresponde.
          const kind = fileKindForRequest(opts.kind, up.mime);
          const newBlock = fileBlockFromUpload(up, kind);
          const rid = replaceId;
          const aid = anchor;
          setBlocks((prev) => {
            const next = [...prev];
            const ri = rid ? next.findIndex((b) => b.id === rid) : -1;
            if (ri !== -1 && next[ri].type === 'paragraph' && next[ri].content === '') {
              next[ri] = setIndent(newBlock, blockIndent(next[ri]));
            } else {
              const ai = aid ? next.findIndex((b) => b.id === aid) : -1;
              // Ancla borrada mientras subía: al final. Toma el nivel pedido o el
              // del ancla (adentro de una columna o un sincronizado si el ancla es el contenedor).
              const anchorBlock = ai === -1 ? null : next[ai];
              const level =
                opts.indent ??
                (anchorBlock ? blockIndent(anchorBlock) + (anchorBlock.type === 'column' || anchorBlock.type === 'synced' ? 1 : 0) : 0);
              const placed = ai === -1 && opts.indent === undefined ? newBlock : setIndent(newBlock, level);
              next.splice(aid === null ? 0 : ai === -1 ? next.length : ai + 1, 0, placed);
            }
            triggerSaveRef.current(next);
            return next;
          });
          anchor = newBlock.id;
          replaceId = null;
          placedAny = true;
        } catch (err) {
          const code = err instanceof DocsUploadError ? err.code : 'failed';
          const key =
            code === 'file_type_not_allowed'
              ? 'editor.upload.typeNotAllowed'
              : code === 'storage_unavailable'
                ? 'editor.upload.storageUnavailable'
                : code === 'file_too_large'
                  ? 'editor.upload.tooLarge'
                  : 'editor.upload.failed';
          setUploadError(t(key, { name: file.name, max: formatFileSize(max) }));
        } finally {
          setUploading((n) => n - 1);
        }
      }
      // Una línea para seguir escribiendo debajo del último bloque subido: la
      // vacía que ya estaba ahí o una nueva, con el foco adentro.
      const last = anchor;
      if (placedAny && last) {
        setBlocks((prev) => {
          const i = prev.findIndex((b) => b.id === last);
          if (i === -1) return prev;
          const after = prev[i + 1];
          const level = blockIndent(prev[i]);
          if (after && after.type === 'paragraph' && after.content === '' && blockIndent(after) === level) {
            pendingFocusId.current = after.id;
            return prev;
          }
          const para = setIndent({ id: newId(), type: 'paragraph', content: '' }, level);
          pendingFocusId.current = para.id;
          const next = [...prev];
          next.splice(i + 1, 0, para);
          triggerSaveRef.current(next);
          return next;
        });
        setFocusTick((v) => v + 1);
      }
    },
    [uploadUrl, t, uploadsEnabled, setBlocks],
  );

  /** Pegar archivos en un bloque: si es un párrafo vacío, lo reemplaza. */
  const handlePasteFiles = useCallback(
    (index: number, files: File[]) => {
      const b = blocks[index];
      void uploadFiles(files, b?.id ?? null, {
        replaceId: b && b.type === 'paragraph' && b.content === '' ? b.id : null,
      });
    },
    [blocks, uploadFiles],
  );

  /**
   * Destino de un drop en (x, y): el contenedor más profundo bajo el puntero
   * (una columna o un bloque sincronizado, o la página) y, adentro, el primer
   * bloque cuyo centro queda abajo. Con `allowSide`, el borde derecho o
   * izquierdo de un bloque es "al costado" (arma columnas, como en Notion).
   */
  const computeDrop = useCallback(
    (clientX: number, clientY: number, allowSide: boolean, list: DocsBlock[]): DropTarget | null => {
      const wrap = blocksWrapRef.current;
      if (!wrap) return null;
      const w = wrap.getBoundingClientRect();
      let scope = -1;
      let scopeRect: DOMRect = w;
      wrap.querySelectorAll<HTMLElement>('[data-scope]').forEach((el) => {
        const r = el.getBoundingClientRect();
        const idx = Number(el.dataset.scope);
        if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom && idx > scope) {
          scope = idx;
          scopeRect = r;
        }
      });
      const outers = Array.from(wrap.querySelectorAll<HTMLElement>(`.docs-block-outer[data-in="${scope}"]`)).filter(
        (o) => !o.classList.contains('is-hidden'),
      );
      const lineFor = (top: number): DropLine => ({ top: top - w.top, left: scopeRect.left - w.left, width: scopeRect.width });
      if (allowSide) {
        for (const o of outers) {
          if (o.classList.contains('docs-container-outer')) continue;
          const r = o.getBoundingClientRect();
          if (clientY < r.top || clientY > r.bottom || clientX < r.left || clientX > r.right + 40) continue;
          const bi = Number(o.dataset.bi);
          const right = clientX > r.left + r.width * 0.85;
          const left = clientX < r.left + Math.min(40, r.width * 0.08);
          if (right || left) {
            const x = right ? Math.min(r.right, w.right) - w.left - 2 : r.left - w.left;
            return {
              index: bi,
              side: { target: bi, side: right ? 'right' : 'left' },
              line: { top: r.top - w.top, left: x, width: 3, height: r.height, vertical: true },
            };
          }
        }
      }
      for (const o of outers) {
        const r = o.getBoundingClientRect();
        const threshold = o.classList.contains('docs-container-outer') ? r.top + Math.min(r.height / 2, 24) : r.top + r.height / 2;
        if (clientY < threshold) {
          const bi = Number(o.dataset.bi);
          return { index: bi, indent: scope === -1 ? undefined : blockIndent(list[bi]), side: null, line: lineFor(r.top - 3) };
        }
      }
      const last = outers[outers.length - 1];
      const bottom = last ? last.getBoundingClientRect().bottom + 1 : scopeRect.top + 4;
      if (scope === -1) return { index: list.length, side: null, line: lineFor(bottom) };
      return { index: subtreeEnd(list, scope) + 1, indent: blockIndent(list[scope]) + 1, side: null, line: lineFor(bottom) };
    },
    [],
  );

  const updateBlock = useCallback(
    (index: number, patch: Partial<DocsBlock>) => {
      setBlocks((prev) => {
        const next = prev.map((b, i) => (i === index ? { ...b, ...patch } : b));
        triggerSave(next);
        return next;
      });
    },
    [triggerSave, setBlocks],
  );

  const insertBlock = useCallback(
    (index: number, type: DocsBlockType, level?: 1 | 2 | 3) => {
      // Debajo de un bloque con hijos entra como primer hijo; debajo de un
      // toggle plegado, después de todo lo que esconde.
      // Después de un contenedor (columnas, sincronizado): debajo de todo su contenido.
      const container = blocks[index]?.type === 'columns' || blocks[index]?.type === 'synced';
      const { at, indent } = container
        ? { at: subtreeEnd(blocks, index) + 1, indent: blockIndent(blocks[index]) }
        : blocks[index]?.type === 'column'
          ? { at: index + 1, indent: blockIndent(blocks[index]) + 1 }
          : insertionPoint(blocks, index);
      const newBlock = setIndent({ id: crypto.randomUUID(), type, content: '', level }, indent);
      setBlocks((prev) => {
        const next = [...prev.slice(0, at), newBlock, ...prev.slice(at)];
        triggerSave(next);
        return next;
      });
      setCmdOpen(false);
      setCmdQuery('');
      setSlash(null);
      setMention(null);
      setUserMention(null);
      setFocusIndex(at);
    },
    [blocks, triggerSave, setBlocks],
  );

  const removeBlock = useCallback(
    (index: number) => {
      setBlocks((prev) => {
        if (prev.length <= 1) return prev;
        // Los hijos suben un nivel si quedaron colgando (normalizeIndents).
        const next = normalizeIndents(prev.filter((_, i) => i !== index));
        triggerSave(next);
        return next;
      });
      setFocusIndex(Math.max(0, index - 1));
    },
    [triggerSave, setBlocks],
  );

  /** Reemplaza todos los bloques (ya con la estructura válida) y guarda. */
  const commitBlocks = useCallback(
    (next: DocsBlock[]) => {
      setBlocks(next);
      triggerSave(next);
    },
    [triggerSave, setBlocks],
  );

  /**
   * Mueve [start, end] con sus hijos un lugar (dir = -1 arriba, +1 abajo):
   * salta el subárbol del hermano. Devuelve el rango nuevo o null si no se movió.
   */
  const moveBlocks = useCallback(
    (start: number, end: number, dir: -1 | 1) => {
      const res = moveRange(blocks, start, end, dir);
      if (!res) return null;
      commitBlocks(res.blocks);
      return res;
    },
    [blocks, commitBlocks],
  );

  /** Duplica [start, end] con sus hijos (ids nuevos, filas/columnas copiadas) justo debajo. */
  const duplicateBlocks = useCallback(
    (start: number, end: number) => {
      const res = duplicateRange(blocks, start, end, () => crypto.randomUUID());
      commitBlocks(res.blocks);
      return res;
    },
    [blocks, commitBlocks],
  );

  /** Borra [start, end] con sus hijos (la página nunca queda sin bloques). */
  const deleteBlocks = useCallback(
    (start: number, end: number) => {
      const res = deleteRange(blocks, start, end, () => crypto.randomUUID());
      commitBlocks(res.blocks);
      return res;
    },
    [blocks, commitBlocks],
  );

  /** Tab / Shift+Tab sobre [start, end]: true si cambió algo. */
  const indentBlocks = useCallback(
    (start: number, end: number, dir: -1 | 1) => {
      const next = indentRange(blocks, start, end, dir);
      if (!next) return false;
      commitBlocks(next);
      return true;
    },
    [blocks, commitBlocks],
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
      const outer = container?.querySelector<HTMLElement>(`.docs-block-outer[data-bi="${d.index}"]`);
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

  const updateBlockDrag = useCallback(
    (d: BlockDragState, e: ReactPointerEvent<HTMLElement>) => {
      if (d.ghostEl) {
        d.ghostEl.style.top = `${e.clientY - d.offsetY}px`;
      }
      const list = live.current.blocks;
      // Al costado solo bloques sueltos (una fila de columnas no entra en otra).
      const target = computeDrop(e.clientX, e.clientY, list[d.index]?.type !== 'columns', list);
      if (!target) return;
      const end = subtreeEnd(list, d.index);
      // Al costado de sí mismo (o de algo que lleva adentro) no hace nada.
      const side = target.side && (target.side.target < d.index || target.side.target > end) ? target.side : null;
      d.side = side;
      d.dropIndex = target.index;
      d.dropIndent = target.indent;
      setDropLine(side || !target.side ? target.line : null);
    },
    [computeDrop],
  );

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
      const side = d.side;
      const dropIndent = d.dropIndent;
      setBlocks((prev) => {
        if (from < 0 || from >= prev.length) return prev;
        // Al costado de un bloque: columnas (nueva fila o una columna más).
        if (side) {
          const next = dropBeside(prev, from, side.target, side.side, newId);
          if (!next) return prev;
          triggerSave(next);
          return next;
        }
        // El bloque viaja con sus hijos. Soltarlo dentro de sí mismo (o en
        // el mismo lugar) no hace nada.
        const end = subtreeEnd(prev, from);
        if (dropIndex >= from && dropIndex <= end + 1) return prev;
        const moved = prev.slice(from, end + 1);
        // Una fila de columnas no entra en una columna.
        if (moved[0].type === 'columns' && dropIndent !== undefined) return prev;
        const rest = [...prev.slice(0, from), ...prev.slice(end + 1)];
        const insertAt = Math.max(0, Math.min(dropIndex > end ? dropIndex - moved.length : dropIndex, rest.length));
        // Dentro de un contenedor: el nivel del destino. Si no, el del bloque
        // de arriba (como en Notion), salvo que ese esté adentro de columnas.
        const above = rest[insertAt - 1];
        let level = dropIndent ?? (above ? blockIndent(above) : 0);
        if (dropIndent === undefined && above && scopeBaseIndent(rest, insertAt - 1) > 0) {
          const below = rest[insertAt];
          level = below && scopeBaseIndent(rest, insertAt) === 0 ? blockIndent(below) : 0;
        }
        const shift = level - blockIndent(moved[0]);
        const placed = moved.map((b) => setIndent(b, blockIndent(b) + shift));
        const next = normalizeIndents([...rest.slice(0, insertAt), ...placed, ...rest.slice(insertAt)]);
        triggerSave(next);
        return next;
      });
    },
    [triggerSave, setBlocks],
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
    (
      index: number,
      type: DocsBlockType,
      level?: 1 | 2 | 3,
      content?: string,
      caretOffset = 0,
      extra: { toggle?: boolean; linked?: boolean } = {},
    ) => {
      setBlocks((prev) => {
        const next = prev.map((b, i) => {
          if (i !== index) return b;
          const converted: DocsBlock = {
            ...b,
            type,
            level,
            content: content !== undefined ? content : b.content,
          };
          // Heading con toggle (o sin); el plegado solo vive en toggles.
          if (type === 'heading' && extra.toggle) converted.toggle = true;
          else delete converted.toggle;
          if (!isToggleBlock(converted)) delete converted.collapsed;
          if (type === 'callout') converted.icon = converted.icon || '💡';
          else delete converted.icon;
          if (type === 'todo') converted.checked = converted.checked ?? false;
          // Code es texto plano (pre-wrap): sin marcas en línea dentro.
          if (type === 'code') converted.content = escapeHtml(htmlToFlatText(converted.content));
          // Vista vinculada: el bloque elige su base de origen al mostrarse.
          if (type === 'database' && extra.linked) {
            const viewId = crypto.randomUUID().slice(0, 12);
            converted.linked = { page_id: '_pick', block_id: '_pick', views: [{ id: viewId, name: '', type: 'table' }], active_view: viewId };
            delete converted.db;
            converted.content = '';
          } else if (type === 'database' && !converted.db && !converted.columns?.length) {
            // Database: Name, Status y Due, una fila vacía y una vista tabla.
            converted.db = defaultDatabase({
              name: t('database.defaults.name'),
              status: t('database.defaults.status'),
              due: t('database.defaults.due'),
              notStarted: t('database.defaults.notStarted'),
              inProgress: t('database.defaults.inProgress'),
              done: t('database.defaults.done'),
            });
            converted.content = '';
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
    [triggerSave, t, setBlocks],
  );

  /** HTML de una mención de fecha (con recordatorio: instante en la zona del navegador e id propio). */
  const dateHtmlFor = useCallback(
    (date: string, time: string | undefined, remind: boolean) =>
      dateMentionHtml({
        date,
        time,
        remindAt: remind ? localInstant(date, time) : undefined,
        rid: remind ? newId() : undefined,
        label: dateLabel(date, time, locale),
      }),
    [locale],
  );

  /** Aplica un comando del menú `/`: borra solo el `/query` tipeado y convierte/inserta. */
  const applyCommand = useCallback(
    (index: number, cmd: { type: DocsBlockType; level?: 1 | 2 | 3; toggle?: boolean; linked?: boolean; special?: CommandSpecial; count?: number }) => {
      const block = blocks[index];
      if (!block) return;
      const s = slash && slash.index === index ? slash : null;
      const stripped = s ? removeHtmlRange(block.content, s.start, s.end) : block.content;
      const caret = s ? s.start : htmlToFlatText(block.content).length;
      const closeMenu = () => {
        setCmdOpen(false);
        setCmdQuery('');
        setCmdSel(0);
        setSlash(null);
      };
      const replace = block.type === 'paragraph' && stripped === '';
      /** Inserta bloques nuevos en lugar de la línea vacía (o debajo de todo lo que cuelga del bloque). */
      const place = (created: DocsBlock[], focusOffset: number) => {
        const base = blockIndent(block);
        const placed = created.map((b) => setIndent(b, blockIndent(b) + base));
        const at = replace ? index : subtreeEnd(blocks, index) + 1;
        setBlocks((prev) => {
          const next = prev.map((b, i) => (i === index ? { ...b, content: stripped } : b));
          next.splice(at, replace ? 1 : 0, ...placed);
          triggerSave(next);
          return next;
        });
        closeMenu();
        const target = at + focusOffset;
        if (isTextBlockType(placed[focusOffset]?.type ?? 'divider')) pendingCaret.current = { index: target, offset: 0 };
        setFocusIndex(target);
        setFocusTick((v) => v + 1);
      };

      if (cmd.special === 'ai' || cmd.special === 'syncedDatabase') {
        // Se borra el `/query` y se abre el agregado (menú de IA o diálogo de la base sincronizada).
        updateBlock(index, { content: stripped });
        closeMenu();
        if (cmd.special === 'ai') pluginRef.current?.openAi({ index });
        else pluginRef.current?.openSync(index);
        return;
      }
      if (cmd.special === 'columns') {
        place(makeColumnList(cmd.count ?? 2, 0, newId), 2);
        return;
      }
      if (cmd.type === 'synced') {
        place(
          [
            { id: newId(), type: 'synced', content: '', synced_id: newId() },
            setIndent({ id: newId(), type: 'paragraph', content: '' }, 1),
          ],
          1,
        );
        return;
      }
      if (cmd.special === 'date' || cmd.special === 'reminder') {
        // Mención de fecha en el caret: hoy, o un recordatorio mañana a las 9.
        const today = new Date();
        const opt = cmd.special === 'date' ? dateSuggestions('', today, locale)[0] : dateSuggestions('', today, locale)[2];
        const html = dateHtmlFor(opt.date, opt.remind ? opt.time : undefined, opt.remind);
        const [before, after] = splitHtmlAt(stripped, caret);
        const content = `${before}${html} ${after}`;
        updateBlock(index, { content });
        closeMenu();
        pendingCaret.current = { index, offset: caret + htmlToFlatText(html).length + 1 };
        setFocusIndex(index);
        setFocusTick((v) => v + 1);
        return;
      }
      if (cmd.special === 'inlineEquation') {
        updateBlock(index, { content: stripped });
        closeMenu();
        const pos = readCaretMenuPos(index);
        setEqPopover({ index, start: caret, length: 0, tex: '', top: (pos?.bottom ?? 120) + 6, left: pos?.left ?? 120 });
        return;
      }
      if (INSERT_TYPES.has(cmd.type)) {
        // Bloques que nacen enteros (bookmark, embed, ecuación, índice, botón,
        // breadcrumb, pizarra): reemplazan la línea vacía o van debajo, más un
        // párrafo para seguir escribiendo.
        place([{ id: newId(), type: cmd.type, content: '' }, { id: newId(), type: 'paragraph', content: '' }], 0);
        return;
      }

      if (isFileBlockType(cmd.type)) {
        // "/imagen" o "/archivo": se borra el `/query`, se abre el selector y
        // el bloque se crea al terminar la subida (reemplaza la línea si quedó vacía).
        setBlocks((prev) => {
          const next = prev.map((b, i) => (i === index ? { ...b, content: stripped } : b));
          triggerSave(next);
          return next;
        });
        setCmdOpen(false);
        setCmdQuery('');
        setCmdSel(0);
        setSlash(null);
        uploadTarget.current = {
          anchorId: block.id,
          replaceId: block.type === 'paragraph' && stripped === '' ? block.id : null,
          kind: cmd.type as DocsFileKind,
        };
        const input = fileInputRef.current;
        if (input) {
          input.accept = acceptFor(cmd.type as DocsFileKind);
          input.value = '';
          input.click();
        }
        return;
      }

      if (cmd.type === 'board') {
        // Pizarra embebida: el bloque arranca sin pizarra y muestra el
        // buscador para elegirla. Reemplaza la línea si quedó vacía.
        const boardBlock: DocsBlock = { id: crypto.randomUUID(), type: 'board', content: '' };
        const paraBlock: DocsBlock = { id: crypto.randomUUID(), type: 'paragraph', content: '' };
        const replace = block.type === 'paragraph' && stripped === '';
        setBlocks((prev) => {
          const next = prev.map((b, i) => (i === index ? { ...b, content: stripped } : b));
          next.splice(replace ? index : index + 1, replace ? 1 : 0, boardBlock, paraBlock);
          triggerSave(next);
          return next;
        });
        setCmdOpen(false);
        setCmdQuery('');
        setCmdSel(0);
        setSlash(null);
        setFocusIndex(replace ? index : index + 1);
        return;
      }

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

      convertBlock(index, cmd.type, cmd.level, stripped, caret, { toggle: cmd.toggle, linked: cmd.linked });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [blocks, slash, convertBlock, triggerSave, setBlocks, updateBlock, locale, readCaretMenuPos, dateHtmlFor],
  );

  /** Comandos del menú `/` que coinciden con `query` (tolerante: "3 col", "col 3", "todo"). */
  const commandsFor = useCallback(
    (query: string) =>
      BLOCK_COMMANDS.map((c) => ({ ...c, label: t(`editor.commands.${c.key}`) })).filter((c) => {
        if (!uploadsEnabled && isFileBlockType(c.type)) return false;
        if (!allowDatabase && c.type === 'database') return false;
        // Pizarras, sincronizados, vistas vinculadas, breadcrumb y fechas con recordatorio: solo en Docs (no en Notes ni en filas).
        if (embedded && (c.type === 'board' || c.type === 'synced' || c.linked || c.type === 'breadcrumb' || c.special === 'date' || c.special === 'reminder')) return false;
        // IA, notas de reunión y bases sincronizadas: solo en páginas de Docs.
        if (embedded && (c.special === 'ai' || c.type === 'meeting' || c.special === 'syncedDatabase')) return false;
        return commandMatches(c.label, COMMAND_KEYWORDS[c.key] ?? [], query);
      }),
    [t, uploadsEnabled, embedded, allowDatabase],
  );
  const commandsForRef = useRef(commandsFor);
  commandsForRef.current = commandsFor;
  const filteredCommands = useMemo(() => commandsFor(cmdQuery), [commandsFor, cmdQuery]);

  /** Enter en párrafo/heading/listas/todo: split en el caret o continuación de lista. */
  const splitBlock = useCallback(
    (index: number, caret: number) => {
      const block = blocks[index];
      if (!block) return;

      // Bloque anidado vacío + Enter (párrafo, ítem, toggle…): sube un nivel
      // en vez de crear otro anidado, como en Notion.
      if (block.content === '' && blockIndent(block) > scopeBaseIndent(blocks, index) && indentBlocks(index, index, -1)) {
        pendingCaret.current = { index, offset: 0 };
        setFocusTick((v) => v + 1);
        return;
      }
      // Ítem vacío sin anidar: sale de la lista convirtiéndolo en párrafo
      // (igual un toggle vacío).
      if ((LIST_TYPES.includes(block.type) || block.type === 'toggle') && block.content === '') {
        convertBlock(index, 'paragraph', undefined, '', 0);
        return;
      }

      const [before, after] = splitHtmlAt(block.content, caret);
      const isList = LIST_TYPES.includes(block.type);
      const indent = blockIndent(block);
      // Listas/todo continúan el mismo tipo; heading/paragraph crean un párrafo.
      // Un toggle desplegado recibe lo nuevo adentro (primer hijo); uno
      // plegado sigue con otro toggle después de todo lo que esconde.
      let newType: DocsBlockType = isList ? block.type : 'paragraph';
      let at = index + 1;
      let newIndent = indent;
      if (isToggleBlock(block) && after === '') {
        if (block.collapsed) {
          at = subtreeEnd(blocks, index) + 1;
          if (block.type === 'toggle') newType = 'toggle';
        } else {
          newIndent = indent + 1;
        }
      } else if (block.type === 'toggle') {
        newType = 'toggle';
      }
      const newBlock = setIndent({ id: crypto.randomUUID(), type: newType, content: after }, newIndent);
      if (newType === 'todo') newBlock.checked = false;

      setBlocks((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], content: before };
        next.splice(at, 0, newBlock);
        triggerSave(next);
        return next;
      });
      pendingCaret.current = { index: at, offset: 0 };
      setFocusIndex(at);
      setFocusTick((v) => v + 1);
    },
    [blocks, convertBlock, indentBlocks, triggerSave, setBlocks],
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
    [blocks, convertBlock, insertSoftNewline, triggerSave, setBlocks],
  );

  /** Backspace con caret al inicio: fusiona con el bloque anterior (o borra divider). */
  const mergeWithPrevious = useCallback(
    (index: number) => {
      const block = blocks[index];
      if (!block) return false;

      // Un bloque anidado primero sube de nivel (como en Notion).
      if (blockIndent(block) > scopeBaseIndent(blocks, index) && isTextBlockType(block.type)) {
        if (indentBlocks(index, index, -1)) {
          pendingCaret.current = { index, offset: 0 };
          setFocusTick((v) => v + 1);
          return true;
        }
      }

      // El anterior visible: lo que esconde un toggle plegado no cuenta.
      const prevIndex = nextVisible(hidden, index, -1);
      if (index === 0 || prevIndex === -1) {
        // Primer bloque: Backspace al inicio solo baja el tipo a párrafo.
        if (block.type !== 'paragraph' && isTextBlockType(block.type)) {
          convertBlock(index, 'paragraph', undefined, block.content, 0);
          return true;
        }
        return false;
      }

      const prev = blocks[prevIndex];

      if (prev.type === 'divider') {
        setBlocks((all) => {
          const next = normalizeIndents(all.filter((_, i) => i !== prevIndex));
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
        // tags adyacentes iguales: válido, se renderiza igual). Los hijos del
        // bloque fusionado quedan donde estaban (normalizeIndents los acomoda).
        const join = htmlToFlatText(prev.content).length;
        setBlocks((all) => {
          const next = [...all];
          next[prevIndex] = { ...next[prevIndex], content: prev.content + block.content };
          next.splice(index, 1);
          const norm = normalizeIndents(next);
          triggerSave(norm);
          return norm;
        });
        pendingCaret.current = { index: prevIndex, offset: join };
        setFocusIndex(prevIndex);
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
    [blocks, convertBlock, hidden, indentBlocks, removeBlock, triggerSave, setBlocks],
  );

  /**
   * Flechas arriba/abajo en la primera/última línea de un bloque: el foco
   * pasa al bloque vecino (saltea divider/tabla/base) con el caret lo más
   * cerca posible de la x que tenía, como en Notion. Arriba en el primer
   * bloque sube al título. `index` -1 = desde el título.
   */
  const moveVertical = useCallback(
    (index: number, dir: -1 | 1, x: number): boolean => {
      // Lo que esconde un toggle plegado se saltea como un divider.
      // Contenedores (columnas, sincronizados) no se enfocan: se pasa a su contenido.
      const target = findVerticalTarget(
        blocks.map((b, i) => (hidden[i] || isStructuralBlock(b) || b.type === 'synced' ? 'divider' : b.type)),
        index,
        dir,
      );
      if (target === -1) {
        if (dir === -1 && index >= 0 && titleRef.current) {
          placeCaretAtX(titleRef.current, x, 'bottom');
          return true;
        }
        return false;
      }
      const el = blockRefs.current[target];
      if (!el) return false;
      prevFocus.current = target;
      if (el.isContentEditable) {
        placeCaretAtX(el, x, dir === -1 ? 'bottom' : 'top');
      } else {
        el.focus({ preventScroll: true });
        el.scrollIntoView?.({ block: 'nearest' });
      }
      return true;
    },
    [blocks, hidden],
  );

  /**
   * Pasa a selección de bloques: el caret se va, el foco queda en el
   * contenedor (su onKeyDown maneja flechas, Backspace, Cmd+D, Tab…).
   */
  const selectBlocks = useCallback((anchor: number, focus: number) => {
    setBlockSel({ anchor, focus });
    setToolbar(null);
    setBlockMenu(null);
    setTurnIntoOpen(false);
    setCmdOpen(false);
    setSlash(null);
    setMention(null);
    setUserMention(null);
    window.getSelection()?.removeAllRanges();
    blocksWrapRef.current?.focus({ preventScroll: true });
  }, []);

  /** Sale de la selección editando el bloque (caret al final). */
  const editBlock = useCallback(
    (index: number, list: DocsBlock[] = blocks) => {
      setBlockSel(null);
      const b = list[index];
      if (!b) return;
      if (!isTextBlockType(b.type)) {
        blockRefs.current[index]?.focus();
        return;
      }
      pendingCaret.current = { index, offset: htmlToFlatText(b.content).length };
      setFocusIndex(index);
      setFocusTick((v) => v + 1);
    },
    [blocks],
  );

  const handleKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent<HTMLElement>) => {
      const block = blocks[index];
      if (!block) return;
      if (modeRef.current === 'suggest' && suggestKeyDownRef.current(index, e)) return;
      if (modeRef.current === 'readonly') return;
      if (noEditRef.current[index]) return;

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

      // Esc: selecciona el bloque (como en Notion). Con la selección, el
      // teclado mueve, duplica, borra o anida (ver handleSelectionKeyDown).
      if (e.key === 'Escape' && blockMenu === null && !linkDialog && !e.defaultPrevented) {
        e.preventDefault();
        selectBlocks(index, index);
        return;
      }

      // Alt+Shift+↑/↓ (o Cmd/Ctrl+Shift+↑/↓): mueve el bloque con sus hijos.
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.shiftKey && (e.altKey || meta)) {
        e.preventDefault();
        const res = moveBlocks(index, index, e.key === 'ArrowUp' ? -1 : 1);
        if (res) {
          pendingCaret.current = { index: res.start, offset: caret };
          setFocusIndex(res.start);
          setFocusTick((v) => v + 1);
        }
        return;
      }

      // Shift+↑ con la selección en el principio (o Shift+↓ en el final) del
      // bloque: pasa a seleccionar bloques enteros.
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.shiftKey && !e.altKey && !meta) {
        const dir = e.key === 'ArrowUp' ? -1 : 1;
        if (isEditable) {
          const off = getSelectionOffsets(el);
          const len = htmlToFlatText(block.content).length;
          const atEdge = !off || (dir === -1 ? off.start === 0 : off.end >= len);
          if (atEdge) {
            e.preventDefault();
            selectBlocks(index, index);
            return;
          }
        } else if (isCardBlockType(block.type) && e.target === e.currentTarget) {
          e.preventDefault();
          selectBlocks(index, index);
          return;
        }
      }

      // Cmd/Ctrl+D: duplica el bloque (con sus hijos) y sigue en la copia.
      if (meta && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'd' && (isEditable || e.target === e.currentTarget)) {
        e.preventDefault();
        const res = duplicateBlocks(index, index);
        pendingCaret.current = { index: res.start, offset: caret };
        setFocusIndex(res.start);
        setFocusTick((v) => v + 1);
        return;
      }

      // Tab / Shift+Tab: anida o desanida (en código, Tab indenta el texto).
      if (e.key === 'Tab' && !meta && !e.altKey) {
        if (block.type === 'code' && isEditable && !e.shiftKey) {
          e.preventDefault();
          updateBlock(index, { content: insertTextAtOffset(block.content, caret, '  ') });
          pendingCaret.current = { index, offset: caret + 2 };
          setFocusTick((v) => v + 1);
          return;
        }
        if (isEditable || (isCardBlockType(block.type) && e.target === e.currentTarget)) {
          e.preventDefault();
          if (indentBlocks(index, index, e.shiftKey ? -1 : 1)) {
            pendingCaret.current = { index, offset: caret };
            setFocusTick((v) => v + 1);
          }
          return;
        }
      }

      // Flechas entre bloques: solo con el caret en la primera/última línea
      // (si no, el browser mueve el caret dentro del bloque) o desde un bloque
      // de imagen/archivo enfocado. Con Shift se extiende la selección: no se toca.
      if (
        (e.key === 'ArrowUp' || e.key === 'ArrowDown') &&
        !e.shiftKey &&
        !e.altKey &&
        !meta &&
        !mention &&
        !userMention
      ) {
        const dir = e.key === 'ArrowUp' ? -1 : 1;
        const onCard = isCardBlockType(block.type) && e.target === e.currentTarget;
        if (onCard || (isEditable && collapsed && isCaretOnEdgeLine(el, dir))) {
          const x = (isEditable ? getCaretViewportRect()?.left : undefined) ?? el.getBoundingClientRect().left;
          if (moveVertical(index, dir, x)) {
            e.preventDefault();
            return;
          }
        }
      }

      // Supr sobre un bloque de imagen/archivo enfocado: lo borra (como Backspace).
      if (e.key === 'Delete' && isCardBlockType(block.type) && e.target === e.currentTarget) {
        e.preventDefault();
        removeBlock(index);
        return;
      }

      // Espacio en una línea vacía: abre la IA (como Notion).
      if (e.key === ' ' && isEditable && collapsed && block.type === 'paragraph' && !embedded && !e.shiftKey && htmlToFlatText(block.content) === '') {
        e.preventDefault();
        pluginRef.current?.openAi({ index });
        return;
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
      embedded,
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
      mention,
      userMention,
      moveVertical,
      blockMenu,
      linkDialog,
      selectBlocks,
      moveBlocks,
      duplicateBlocks,
      indentBlocks,
      updateBlock,
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

      // `$$x^2$$`: al cerrar el segundo `$$` queda una ecuación en línea.
      const texMatch = !isCode ? beforeCaret.match(/\$\$([^$\n]{1,500})\$\$$/) : null;
      if (texMatch) {
        const start = caret - texMatch[0].length;
        const tex = texMatch[1].trim();
        if (tex) {
          const html = `<span data-tex="${escapeHtml(tex).replace(/"/g, '&quot;')}">${escapeHtml(tex)}</span>`;
          const [before, after] = splitHtmlAt(removeHtmlRange(text, start, caret), start);
          // Un espacio después: el caret no puede quedar adentro del span atómico.
          const gap = /^\s/.test(htmlToFlatText(after)) ? '' : ' ';
          updateBlock(index, { content: `${before}${html}${gap}${after}` });
          pendingCaret.current = { index, offset: start + tex.length + gap.length };
          setFocusTick((v) => v + 1);
          closeSlash();
          return;
        }
      }

      // `[[query`: la query no cruza '[' ni ']' (otro '[[' reinicia el trigger).
      const mentionMatch = !isCode && pageLinksEnabled ? beforeCaret.match(/\[\[([^\][]*)$/) : null;
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

      // @mención: '@' al inicio o tras un espacio, query sin espacios (o con
      // espacios si es una fecha: "@recordar mañana 9am").
      const spaced = !isCode && !embedded ? beforeCaret.match(/(?:^|\s)@([^@\n]{1,40})$/) : null;
      const spacedDate = spaced && /\s/.test(spaced[1]) && dateSuggestions(spaced[1], new Date(), locale).length > 0;
      const userMatch = !isCode && !embedded ? (spacedDate ? spaced : beforeCaret.match(/(?:^|\s)@([^\s@]*)$/)) : null;
      if (userMatch) {
        const query = userMatch[1] ?? '';
        setUserMention({ index, query, start: caret - query.length - 1, end: caret });
        closeSlash();
        const pos = readCaretMenuPos(index);
        if (pos) setCaretMenuPos(pos);
        return;
      }
      setUserMention(null);

      // Menú `/`: '/' al inicio o tras un espacio, query sin '/'. Puede tener
      // espacios ("/3 col") mientras algún comando coincida, como en Notion.
      const slashMatch = !isCode ? beforeCaret.match(/(?:^|\s)\/((?:[^\s/][^/\n]{0,30})?)$/) : null;
      if (slashMatch && /\s/.test(slashMatch[1]) && commandsForRef.current(slashMatch[1]).length === 0) {
        closeSlash();
      } else if (slashMatch) {
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
    [blocks, convertBlock, embedded, pageLinksEnabled, readCaretMenuPos, updateBlock, locale],
  );

  const handleBlockChange = useCallback(
    (index: number, patch: Partial<DocsBlock>) => {
      // Modo sugerir: el texto nuevo o borrado queda marcado como sugerencia
      // (sin menús de / [[ @ ni atajos Markdown).
      if (modeRef.current === 'suggest' && patch.content !== undefined) {
        const block = blocks[index];
        if (!block) return;
        const res = suggestChange(block, patch.content, blockRefs.current[index]);
        if (!res) return;
        updateBlock(index, { content: res.content });
        pendingCaret.current = { index, offset: res.caret };
        setFocusTick((v) => v + 1);
        return;
      }
      if (modeRef.current === 'readonly' || noEditRef.current[index]) return;
      updateBlock(index, patch);
      if (patch.content !== undefined) handleInput(index, patch.content);
    },
    [handleInput, updateBlock, blocks, suggestChange],
  );

  // Fin de una composición (acentos, IME) en modo sugerir: se procesa el texto final.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onEnd = (e: CompositionEvent) => {
      const host = (e.target as HTMLElement | null)?.closest?.('.docs-editable') as HTMLElement | null;
      const index = host ? blockRefs.current.indexOf(host as HTMLDivElement) : -1;
      setTimeout(() => {
        if (index < 0) {
          composing.current = false;
          return;
        }
        onCompositionEnd(index, (i, content, caret) => {
          updateBlock(i, { content });
          pendingCaret.current = { index: i, offset: caret };
          setFocusTick((v) => v + 1);
        });
      }, 0);
    };
    root.addEventListener('compositionend', onEnd);
    return () => root.removeEventListener('compositionend', onEnd);
  }, [composing, onCompositionEnd, updateBlock]);

  /**
   * Teclas en modo sugerir: se escribe y se borra adentro de un bloque (el
   * cambio se vuelve sugerencia); Enter al final sugiere un párrafo nuevo; el
   * resto de la estructura (unir, anidar, formato) no se toca. true = ya está.
   */
  const suggestKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent<HTMLElement>): boolean => {
      const nav = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'];
      if (nav.includes(e.key)) return false;
      const mod = e.metaKey || e.ctrlKey;
      if (mod) {
        if (['c', 'a', 'z', 'y', 'x', 'v'].includes(e.key.toLowerCase())) return true;
        e.preventDefault();
        return true;
      }
      const block = blocks[index];
      const el = blockRefs.current[index];
      if (!block || !el) return true;
      const sel = getSelectionOffsets(el);
      const len = htmlToFlatText(block.content).length;
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!sel || sel.start !== sel.end || sel.end < len || !currentUserId) return true;
        const sugId = block.suggestion?.id ?? newId();
        const nb: DocsBlock = setIndent({ id: newId(), type: 'paragraph', content: '', suggestion: { id: sugId, by: currentUserId } }, blockIndent(block));
        setBlocks((prev) => {
          const next = [...prev.slice(0, index + 1), nb, ...prev.slice(index + 1)];
          triggerSave(next);
          return next;
        });
        pendingCaret.current = { index: index + 1, offset: 0 };
        setFocusIndex(index + 1);
        setFocusTick((v) => v + 1);
        return true;
      }
      if (e.key === 'Tab' || e.key === 'Escape') {
        e.preventDefault();
        return true;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        const collapsed = !!sel && sel.start === sel.end;
        const atEdge = collapsed && (e.key === 'Backspace' ? sel!.start === 0 : sel!.end >= len);
        if (atEdge) {
          e.preventDefault();
          // Un párrafo sugerido propio y vacío se puede sacar con Backspace.
          if (e.key === 'Backspace' && block.suggestion?.by === currentUserId && !block.content) {
            setBlocks((prev) => {
              const next = prev.filter((_, i) => i !== index);
              triggerSave(next);
              return next;
            });
            if (index > 0) {
              pendingCaret.current = { index: index - 1, offset: htmlToFlatText(blocks[index - 1].content).length };
              setFocusIndex(index - 1);
              setFocusTick((v) => v + 1);
            }
          }
        }
        return true;
      }
      return true;
    },
    [blocks, currentUserId, setBlocks, triggerSave],
  );
  suggestKeyDownRef.current = suggestKeyDown;

  /** El click del usuario ya posiciona el caret: no hay que re-moverlo en el efecto. */
  const handleFocus = useCallback((index: number) => {
    prevFocus.current = index;
    setFocusIndex(index);
    setBlockSel(null);
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
    (selected: PageLinkCandidate) => {
      if (!mention) return;
      const { index, start, end } = mention;
      const block = blocks[index];
      if (!block) {
        setMention(null);
        return;
      }
      // Se borra el `[[query` tipeado (rango plano capturado al tipear, en
      // cualquier posición del bloque) y se inserta un link a la página (el
      // título va escapado) más un espacio para seguir escribiendo afuera.
      const title = selected.title || t('untitled');
      const [before, after] = splitHtmlAt(removeHtmlRange(block.content, start, end), start);
      const newContent = `${before}${pageLinkHtml(selected.id, title, selected.row_id)} ${after}`;
      setBlocks((prev) => {
        const next = prev.map((b, i) => (i === index ? { ...b, content: newContent } : b));
        triggerSave(next);
        return next;
      });
      setMention(null);
      pendingCaret.current = { index, offset: start + title.length + 1 };
      setFocusIndex(index);
      setFocusTick((v) => v + 1);
    },
    [blocks, mention, triggerSave, t, setBlocks],
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
    [blocks, page.id, triggerSave, userMention, setBlocks],
  );

  /** Fechas que ofrece el popover de @ para lo tipeado (hoy, mañana, recordatorios). */
  const dateOptions = useMemo(() => {
    if (!userMention || embedded) return [];
    return dateSuggestions(userMention.query, new Date(), locale);
  }, [userMention, embedded, locale]);

  const dateOptionLabels = useMemo<DateMentionOption[]>(
    () =>
      dateOptions.map((d) => ({
        key: d.key,
        remind: d.remind,
        label: d.remind
          ? t('mentions.remindAt', { when: dateLabel(d.date, d.time, locale) })
          : d.key === 'today'
            ? t('mentions.today')
            : d.key === 'tomorrow'
              ? t('mentions.tomorrow')
              : dateLabel(d.date, d.time, locale),
        detail: d.remind ? t('mentions.reminderHint') : d.key === 'date' ? '' : dateLabel(d.date, d.time, locale),
      })),
    [dateOptions, locale, t],
  );

  /** Elige una fecha del popover de @: reemplaza el `@query` por la mención (con recordatorio si corresponde). */
  const onSelectDateMention = useCallback(
    (i: number) => {
      const opt = dateOptions[i];
      if (!userMention || !opt) return;
      const { index, start, end } = userMention;
      const block = blocks[index];
      setUserMention(null);
      if (!block) return;
      const html = dateHtmlFor(opt.date, opt.time, opt.remind);
      const [before, after] = splitHtmlAt(removeHtmlRange(block.content, start, end), start);
      setBlocks((prev) => {
        const next = prev.map((b, k) => (k === index ? { ...b, content: `${before}${html} ${after}` } : b));
        triggerSave(next);
        return next;
      });
      pendingCaret.current = { index, offset: start + htmlToFlatText(html).length + 1 };
      setFocusIndex(index);
      setFocusTick((v) => v + 1);
    },
    [blocks, dateHtmlFor, dateOptions, setBlocks, triggerSave, userMention],
  );

  /**
   * Teclado con bloques seleccionados (foco en el contenedor): ↑/↓ cambia el
   * bloque, Shift+↑/↓ extiende, Alt+Shift+↑/↓ mueve, Cmd/Ctrl+D duplica,
   * Backspace/Supr borra, Tab/Shift+Tab anida, Cmd/Ctrl+C/X copia o corta
   * como Markdown, Cmd/Ctrl+A selecciona todo, Enter edita y Esc sale.
   */
  const handleSelectionKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!blockSel || e.target !== e.currentTarget) return;
    const meta = e.metaKey || e.ctrlKey;
    const key = e.key;
    const keep = (start: number, end: number) =>
      setBlockSel(blockSel.anchor <= blockSel.focus ? { anchor: start, focus: end } : { anchor: end, focus: start });
    const reveal = (i: number) =>
      blocksWrapRef.current?.querySelector<HTMLElement>(`.docs-block-outer[data-bi="${i}"]`)?.scrollIntoView?.({ block: 'nearest' });

    if (key === 'Escape') {
      e.preventDefault();
      setBlockSel(null);
      return;
    }
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      e.preventDefault();
      const dir = key === 'ArrowUp' ? -1 : 1;
      if (e.shiftKey && (e.altKey || meta)) {
        const res = moveBlocks(selMin, selMax, dir);
        if (res) {
          keep(res.start, res.end);
          reveal(dir === -1 ? res.start : res.end);
        }
        return;
      }
      if (e.shiftKey) {
        const f = nextVisible(hidden, blockSel.focus, dir);
        if (f !== -1) {
          setBlockSel({ anchor: blockSel.anchor, focus: f });
          reveal(f);
        }
        return;
      }
      const from = dir === -1 ? selMin : selMax;
      const to = nextVisible(hidden, from, dir);
      const target = to === -1 ? from : to;
      setBlockSel({ anchor: target, focus: target });
      reveal(target);
      return;
    }
    if (key === 'Backspace' || key === 'Delete') {
      e.preventDefault();
      const res = deleteBlocks(selMin, selMax);
      editBlock(res.start, res.blocks);
      return;
    }
    if (meta && key.toLowerCase() === 'd') {
      e.preventDefault();
      const res = duplicateBlocks(selMin, selMax);
      keep(res.start, res.end);
      return;
    }
    if (key === 'Tab') {
      e.preventDefault();
      indentBlocks(selMin, selMax, e.shiftKey ? -1 : 1);
      return;
    }
    if (key === 'Enter') {
      e.preventDefault();
      editBlock(blockSel.focus);
      return;
    }
    if (meta && key.toLowerCase() === 'a') {
      e.preventDefault();
      const last = hidden.lastIndexOf(false);
      setBlockSel({ anchor: 0, focus: Math.max(0, last) });
      return;
    }
    if (meta && (key.toLowerCase() === 'c' || key.toLowerCase() === 'x')) {
      e.preventDefault();
      const [a, b] = expandRange(blocks, selMin, selMax);
      const md = blocksToMarkdown(blocks.slice(a, b + 1));
      navigator.clipboard?.writeText(md).catch(() => {});
      if (key.toLowerCase() === 'x') {
        const res = deleteBlocks(selMin, selMax);
        editBlock(res.start, res.blocks);
      }
    }
  };

  /**
   * Pegado con estructura (varios párrafos, listas, headings, Markdown):
   * el texto antes del caret queda en el bloque, lo pegado entra como
   * bloques debajo (con el nivel del bloque) y lo que seguía al caret va a
   * un párrafo al final. Un párrafo vacío se reemplaza.
   */
  const handlePasteBlocks = useCallback(
    (index: number, pasted: DocsBlock[]) => {
      const block = blocks[index];
      if (!block || pasted.length === 0) return;
      const el = blockRefs.current[index];
      const offsets = el ? getSelectionOffsets(el) : null;
      let content = block.content;
      let caret = htmlToFlatText(content).length;
      if (offsets) {
        content = removeHtmlRange(content, offsets.start, offsets.end);
        caret = offsets.start;
      }
      const [before, after] = splitHtmlAt(content, caret);
      const base = blockIndent(block);
      const placed = pasted.map((b) => setIndent(b, blockIndent(b) + base));
      const keepCurrent = htmlToFlatText(before).trim() !== '' || block.type !== 'paragraph';
      const tail: DocsBlock[] = htmlToFlatText(after).trim()
        ? [setIndent({ id: crypto.randomUUID(), type: 'paragraph', content: after }, base)]
        : [];
      const head = keepCurrent ? [{ ...block, content: before }] : [];
      const next = normalizeIndents([...blocks.slice(0, index), ...head, ...placed, ...tail, ...blocks.slice(index + 1)]);
      commitBlocks(next);
      const lastIndex = index + head.length + placed.length - 1;
      const last = next[lastIndex];
      if (last && isTextBlockType(last.type)) {
        pendingCaret.current = { index: lastIndex, offset: htmlToFlatText(last.content).length };
        setFocusIndex(lastIndex);
        setFocusTick((v) => v + 1);
      }
    },
    [blocks, commitBlocks],
  );

  /** Importa un .md o .docx: el server lo convierte en bloques y se agregan al final. */
  const importFile = useCallback(
    async (file: File) => {
      if (!importUrl) return;
      setUploadError(null);
      if (!docsImportKind(file.name)) {
        setUploadError(t('editor.import.typeNotAllowed', { name: file.name }));
        return;
      }
      if (file.size > DOCS_IMPORT_MAX_BYTES) {
        setUploadError(t('editor.import.tooLarge', { name: file.name }));
        return;
      }
      setImporting(true);
      try {
        const body = new FormData();
        body.append('file', file);
        const res = await fetch(importUrl, { method: 'POST', body });
        if (!res.ok) {
          setUploadError(t('editor.import.failed', { name: file.name }));
          return;
        }
        const data = (await res.json()) as { blocks?: DocsBlock[] };
        const imported = upgradeBlocks(data.blocks ?? []);
        if (imported.length === 0) {
          setUploadError(t('editor.import.empty', { name: file.name }));
          return;
        }
        setBlocks((prev) => {
          // Página vacía (un párrafo sin texto): lo importado la reemplaza.
          const empty = prev.length === 1 && prev[0].type === 'paragraph' && prev[0].content === '';
          const next = normalizeIndents(empty ? imported : [...prev, ...imported]);
          triggerSaveRef.current(next);
          return next;
        });
      } catch {
        setUploadError(t('editor.import.failed', { name: file.name }));
      } finally {
        setImporting(false);
      }
    },
    [importUrl, t, setBlocks],
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
    setCoverPosition(50);
    triggerSave(undefined, undefined, undefined, url);
    setCoverOpen(false);
  };

  /** Página vacía (sin título ni texto): se ofrece empezar con una plantilla. */
  const pageIsEmpty = !embedded && !title.trim() && blocks.length === 1 && blocks[0].type === 'paragraph' && !blocks[0].content;
  const [templatesOpen, setTemplatesOpen] = useState(false);

  /** Llena la página vacía con una plantilla (título y bloques; queda en el historial). */
  const applyTemplate = (tpl: DocTemplate) => {
    const next = normalizeStructure(upgradeBlocks(tpl.makeBlocks()), newId);
    setBlocks(next);
    setTitle(tpl.title);
    if (titleRef.current) titleRef.current.textContent = tpl.title;
    triggerSaveRef.current(next, tpl.title);
  };

  /** Imagen subida como ícono de la página ("img:<url del storage>"). */
  const uploadIcon = async (file: File) => {
    setUploadError(null);
    setUploading((n) => n + 1);
    try {
      const up = await uploadDocsFile(file, { uploadUrl });
      rememberUploadPreview(up.url, file);
      const next = `${ICON_IMAGE_PREFIX}${up.url}`;
      setIcon(next);
      triggerSaveRef.current(undefined, undefined, next);
    } catch {
      setUploadError(t('editor.upload.failed', { name: file.name }));
    } finally {
      setUploading((n) => n - 1);
    }
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

  // ---------- Bases de datos: fila abierta como página ----------

  /** Fila abierta (panel lateral o página completa); el panel vive fuera del root (sus teclas no son del editor). */
  const [openRow, setOpenRow] = useState<{ blockId: string; rowId: string; mode: DbRowPanelMode } | null>(null);
  const membersUrl = embedded ? '/api/docs/members' : `/api/docs/members?page=${encodeURIComponent(page.id)}`;

  /** ?row=<id> en la URL de la página (Docs): la fila abierta como página completa. */
  const pushedRow = useRef<string | null>(null);
  const setRowUrl = useCallback(
    (rowId: string | null, push: boolean) => {
      if (embedded || typeof window === 'undefined') return;
      const url = new URL(window.location.href);
      // Cerrar la fila que abrió esta pestaña: se vuelve atrás (no queda una entrada de más en el historial).
      if (!rowId && pushedRow.current && url.searchParams.get('row') === pushedRow.current) {
        pushedRow.current = null;
        window.history.back();
        return;
      }
      if (rowId) url.searchParams.set('row', rowId);
      else url.searchParams.delete('row');
      if (url.href === window.location.href) return;
      if (push) {
        window.history.pushState(null, '', url.href);
        pushedRow.current = rowId;
      } else window.history.replaceState(null, '', url.href);
    },
    [embedded],
  );

  const onOpenRow = useCallback(
    (blockId: string, rowId: string, requested: DbRowPanelMode) => {
      // En un teléfono la fila se abre como página (con su URL: "atrás" la cierra).
      const narrow = !embedded && typeof window !== 'undefined' && window.matchMedia?.('(max-width: 720px)').matches;
      const mode: DbRowPanelMode = narrow ? 'full' : requested;
      setOpenRow({ blockId, rowId, mode });
      setRowUrl(mode === 'full' ? rowId : null, mode === 'full');
    },
    [setRowUrl, embedded],
  );

  const closeRow = useCallback(() => {
    setOpenRow(null);
    setRowUrl(null, false);
  }, [setRowUrl]);

  const rowParam = embedded ? null : searchParams?.get('row') ?? null;
  // Link a una fila (?row=): se abre como página completa; volver atrás la cierra.
  useEffect(() => {
    if (!rowParam) {
      // "Atrás" del navegador: la entrada que se agregó al abrir ya no está.
      pushedRow.current = null;
      setOpenRow((cur) => (cur?.mode === 'full' ? null : cur));
      return;
    }
    const block = live.current.blocks.find(
      (b) => b.type === 'database' && normalizeDatabase(b).rows.some((r) => r.id === rowParam),
    );
    if (block) setOpenRow({ blockId: block.id, rowId: rowParam, mode: 'full' });
  }, [rowParam, page.id]);

  // Otra página: no queda abierta una fila de la anterior.
  useEffect(() => {
    setOpenRow((cur) => (cur && !live.current.blocks.some((b) => b.id === cur.blockId) ? null : cur));
  }, [page.id]);

  /** Cambio sobre la base más reciente del bloque (el cuerpo de la fila guarda con debounce). */
  const updateDatabase = useCallback(
    (blockId: string, fn: (db: DocsDatabase) => DocsDatabase) => {
      setBlocks((prev) => {
        const i = prev.findIndex((b) => b.id === blockId);
        if (i === -1 || prev[i].type !== 'database') return prev;
        const cur = normalizeDatabase(prev[i]);
        const nextDb = fn(cur);
        if (nextDb === cur) return prev;
        const next = prev.map((b, j) => (j === i ? { ...b, ...databasePatch(nextDb) } : b));
        triggerSave(next);
        return next;
      });
    },
    [triggerSave, setBlocks],
  );

  const dbHooks = useMemo(
    () => ({ onOpenRow, membersUrl, pageId: embedded ? null : page.id, updateDatabase, readOnly: mode !== 'edit' }),
    [onOpenRow, membersUrl, embedded, page.id, updateDatabase, mode],
  );

  /** [[ y archivos en el cuerpo de una fila: los de Notes, o los de esta página de Docs. */
  const rowPageLinks = useMemo<PageLinkSource>(
    () =>
      pageLinks ?? {
        search: (q: string) =>
          fetch(`/api/docs/search?q=${encodeURIComponent(q)}`)
            .then((r) => (r.ok ? r.json() : { rows: [] }))
            .then((d: { rows?: PageLinkCandidate[] }) => d.rows ?? []),
        href: (id: string) => pageLinkHref(id),
        rows: true,
      },
    [pageLinks],
  );
  const rowFiles = useMemo<DocsFileSource | undefined>(
    () => files ?? (embedded ? undefined : { uploadUrl: `/api/docs/pages/${page.id}/files`, href: (blockId, opts) => docsFileHref(page.id, blockId, opts) }),
    [files, embedded, page.id],
  );
  const openRowBlock = openRow ? blocks.find((b) => b.id === openRow.blockId) : undefined;

  // ---------- Bloques nuevos: índice, breadcrumb, botón, ecuación en línea, links pegados, sincronizados, columnas ----------

  const toc = useMemo(() => buildToc(blocks), [blocks]);
  const trail = useMemo(
    () => [
      ...ancestors.filter((a) => a.id !== page.id).map((a) => ({ id: a.id, title: a.title, icon: a.icon })),
      { id: page.id, title, icon: icon || null },
    ],
    [ancestors, page.id, title, icon],
  );

  /** Botón: abre su link o inserta sus bloques (Markdown) debajo. */
  const runButton = useCallback(
    (index: number, button: DocsButtonConfig) => {
      if (button.action === 'link') {
        const url = button.url ?? '';
        if (/^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener,noreferrer');
        else if (url.startsWith('/')) window.location.assign(url.startsWith(`/${locale}/`) ? url : `/${locale}${url}`);
        return;
      }
      const created = markdownToBlocks(button.markdown ?? '', { sanitize: sanitizeRichHtml }).map((b) => ({ ...b, id: newId() }));
      if (!created.length) return;
      setBlocks((prev) => {
        const i = prev.findIndex((b) => b.id === blocks[index]?.id);
        if (i === -1) return prev;
        const at = subtreeEnd(prev, i) + 1;
        const base = blockIndent(prev[i]);
        const placed = created.map((b) => setIndent(b, blockIndent(b) + base));
        const next = normalizeIndents([...prev.slice(0, at), ...placed, ...prev.slice(at)]);
        triggerSave(next);
        return next;
      });
    },
    [blocks, locale, setBlocks, triggerSave],
  );

  /** Clic en una ecuación en línea: abre su editor. */
  const openInlineEquation = useCallback((index: number, start: number, tex: string) => {
    const el = blockRefs.current[index];
    const span = Array.from(el?.querySelectorAll<HTMLElement>('span[data-tex]') ?? []).find((x) => x.getAttribute('data-tex') === tex);
    const r = span?.getBoundingClientRect() ?? el?.getBoundingClientRect();
    setEqPopover({ index, start, length: tex.length, tex, top: (r?.bottom ?? 120) + 6, left: r?.left ?? 120 });
  }, []);

  /** Guarda la ecuación en línea del popover (vacía = se borra). */
  const saveInlineEquation = useCallback(
    (tex: string) => {
      const pop = eqPopover;
      setEqPopover(null);
      if (!pop) return;
      const block = blocks[pop.index];
      if (!block) return;
      const clean = tex.trim();
      const base = pop.length ? removeHtmlRange(block.content, pop.start, pop.start + pop.length) : block.content;
      const html = clean ? `<span data-tex="${escapeHtml(clean).replace(/"/g, '&quot;')}">${escapeHtml(clean)}</span>` : '';
      const [before, after] = splitHtmlAt(base, pop.start);
      const gap = html && !/^\s/.test(htmlToFlatText(after)) ? ' ' : '';
      updateBlock(pop.index, { content: `${before}${html}${gap}${after}` });
      pendingCaret.current = { index: pop.index, offset: pop.start + clean.length + gap.length };
      setFocusIndex(pop.index);
      setFocusTick((v) => v + 1);
    },
    [blocks, eqPopover, updateBlock],
  );

  /** Se pegó un link solo: ofrecer mención, bookmark o embed (queda como link si no se elige). */
  const onPasteUrl = useCallback((index: number, url: string) => {
    requestAnimationFrame(() => {
      const el = blockRefs.current[index];
      const blockId = live.current.blocks[index]?.id;
      if (!el || !blockId) return;
      const end = getCaretOffset(el);
      const rect = getCaretViewportRect() ?? el.getBoundingClientRect();
      setPastePrompt({ index, blockId, url, start: Math.max(0, end - url.length), end, top: rect.bottom + 6, left: rect.left, embeddable: Boolean(embedFor(url)) });
    });
  }, []);

  /** Elige qué hacer con el link pegado. */
  const resolvePaste = useCallback(
    async (choice: 'link' | 'mention' | 'bookmark' | 'embed') => {
      const prompt = pastePrompt;
      setPastePrompt(null);
      if (!prompt || choice === 'link') return;
      const current = live.current.blocks;
      const index = current.findIndex((b) => b.id === prompt.blockId);
      if (index === -1) return;
      const block = current[index];
      const preview = await fetchLinkPreview(prompt.url);
      if (choice === 'mention') {
        const label = preview.title || preview.url;
        const [before, rest] = splitHtmlAt(block.content, prompt.start);
        const [, after] = splitHtmlAt(rest, prompt.end - prompt.start);
        const html = `<a href="${escapeHtml(preview.url).replace(/"/g, '&quot;')}">${escapeHtml(label)}</a>`;
        updateBlock(index, { content: `${before}${html}${after}` });
        return;
      }
      // Bookmark o embed: el link sale del texto y entra un bloque debajo (o en lugar de la línea si quedó vacía).
      const stripped = removeHtmlRange(block.content, prompt.start, prompt.end);
      const created: DocsBlock = setIndent({ id: newId(), type: choice, content: '', link: preview }, blockIndent(block));
      const empty = block.type === 'paragraph' && htmlToFlatText(stripped).trim() === '';
      setBlocks((prev) => {
        const i = prev.findIndex((b) => b.id === prompt.blockId);
        if (i === -1) return prev;
        const next = [...prev];
        if (empty) next.splice(i, 1, created, setIndent({ id: newId(), type: 'paragraph', content: '' }, blockIndent(block)));
        else {
          next[i] = { ...next[i], content: stripped };
          next.splice(subtreeEnd(next, i) + 1, 0, created);
        }
        triggerSave(next);
        return next;
      });
    },
    [pastePrompt, setBlocks, triggerSave, updateBlock],
  );

  // Menú de link pegado: ↑/↓ elige, Enter aplica, Esc lo deja como link. Cualquier otra tecla lo cierra.
  const [pasteSel, setPasteSel] = useState(0);
  const pasteSelRef = useRef(0);
  pasteSelRef.current = pasteSel;
  const pasteChoices = useMemo<Array<'link' | 'mention' | 'bookmark' | 'embed'>>(
    () => (pastePrompt ? (['mention', 'bookmark', ...(pastePrompt.embeddable ? ['embed' as const] : []), 'link'] as Array<'link' | 'mention' | 'bookmark' | 'embed'>) : []),
    [pastePrompt],
  );
  useEffect(() => {
    if (!pastePrompt) return;
    setPasteSel(0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setPasteSel((v) => (v + (e.key === 'ArrowDown' ? 1 : -1) + pasteChoices.length) % pasteChoices.length);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        void resolvePaste(pasteChoices[pasteSelRef.current] ?? 'link');
        return;
      }
      if (e.key === 'Escape') e.stopPropagation();
      setPastePrompt(null);
    };
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.docs-paste-menu')) setPastePrompt(null);
    };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onDown);
    };
  }, [pastePrompt, pasteChoices, resolvePaste]);

  const [syncedNotice, setSyncedNotice] = useState<string | null>(null);

  /** "Copiar y sincronizar": el id va al portapapeles; pegarlo en otra página crea la copia sincronizada. */
  const copySynced = useCallback(
    (block: DocsBlock) => {
      if (!block.synced_id) return;
      const text = `zerosoft-synced:${block.synced_id}`;
      navigator.clipboard?.writeText(text).catch(() => {});
      setSyncedNotice(t('editor.synced.copied'));
      window.setTimeout(() => setSyncedNotice(null), 4000);
    },
    [t],
  );

  /** Pegaron un bloque sincronizado: se inserta con el contenido actual. */
  const onPasteSynced = useCallback(
    async (index: number, syncedId: string) => {
      const res = await fetch(`/api/docs/synced/${encodeURIComponent(syncedId)}`).catch(() => null);
      if (!res?.ok) {
        setSyncedNotice(t('editor.synced.notFound'));
        window.setTimeout(() => setSyncedNotice(null), 4000);
        return;
      }
      const data = (await res.json()) as { blocks?: DocsBlock[] };
      const children = upgradeBlocks(data.blocks?.length ? data.blocks : [{ id: newId(), type: 'paragraph', content: '' }]);
      setBlocks((prev) => {
        const i = Math.min(index, prev.length - 1);
        const cur = prev[i];
        const base = cur ? blockIndent(cur) : 0;
        const created = [
          setIndent({ id: newId(), type: 'synced', content: '', synced_id: syncedId }, base),
          ...children.map((c) => setIndent(c, blockIndent(c) + base + 1)),
        ];
        const replace = cur && cur.type === 'paragraph' && cur.content === '';
        const at = replace ? i : subtreeEnd(prev, i) + 1;
        const next = [...prev.slice(0, at), ...created, ...prev.slice(at + (replace ? 1 : 0))];
        triggerSave(next);
        return next;
      });
    },
    [setBlocks, t, triggerSave],
  );

  /** Desincronizar: el contenido queda como bloques comunes de esta página. */
  const unsync = useCallback(
    (index: number) => {
      setBlocks((prev) => {
        if (prev[index]?.type !== 'synced') return prev;
        const end = subtreeEnd(prev, index);
        const kids = prev.slice(index + 1, end + 1).map((b) => setIndent(b, blockIndent(b) - 1));
        const next = normalizeIndents([...prev.slice(0, index), ...kids, ...prev.slice(end + 1)]);
        triggerSave(next);
        return next;
      });
    },
    [setBlocks, triggerSave],
  );

  /** Una columna más (vacía) al final de la fila, con anchos parejos. */
  const addColumn = useCallback(
    (listIndex: number) => {
      setBlocks((prev) => {
        if (prev[listIndex]?.type !== 'columns') return prev;
        const cols = columnsIn(prev, listIndex);
        if (cols.length >= MAX_COLUMNS) return prev;
        const d = blockIndent(prev[listIndex]);
        const at = subtreeEnd(prev, listIndex) + 1;
        const added = [
          setIndent({ id: newId(), type: 'column', content: '', ratio: 1 }, d + 1),
          setIndent({ id: newId(), type: 'paragraph', content: '' }, d + 2),
        ];
        const set = new Set(cols);
        const even = prev.map((b, k) => (set.has(k) ? { ...b, ratio: 1 } : b));
        const next = [...even.slice(0, at), ...added, ...even.slice(at)];
        triggerSave(next);
        return next;
      });
    },
    [setBlocks, triggerSave],
  );

  /** Pesos nuevos de las columnas (por id). */
  const setColumnRatios = useCallback(
    (ids: string[], ratios: number[]) => {
      const byId = new Map(ids.map((id, k) => [id, ratios[k]]));
      setBlocks((prev) => {
        const next = prev.map((b) => (byId.has(b.id) ? { ...b, ratio: byId.get(b.id) } : b));
        triggerSave(next);
        return next;
      });
    },
    [setBlocks, triggerSave],
  );

  /** Un bloque suelto (no contenedor) con su asa, menú, comentarios y el "+" de abajo. */
  const renderLeaf = (block: DocsBlock, index: number) => {
          const commentCount = commentCounts?.[block.id] ?? 0;
          const indent = visualIndent(blocks, index);
          const isHidden = hidden[index];
          const selected = !isHidden && index >= selMin && index <= selMax;
          return (
            <Fragment key={block.id}>
              <div
                className={`docs-block-outer${dragIndex === index ? ' dragging' : ''}${blockMenu === index ? ' menu-open' : ''}${isHidden ? ' is-hidden' : ''}${selected ? ' is-selected' : ''}${block.suggestion ? ' is-suggested-block' : ''}`}
                data-sug-block={block.suggestion?.id}
                style={indent ? ({ '--docs-indent': indent } as CSSProperties) : undefined}
                data-indent={indent || undefined}
                data-bi={index}
                data-in={containerOf(blocks, index)}
                data-block-anchor={block.id}
                aria-hidden={isHidden || undefined}
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
                  onClick={(e) => {
                    // Shift+click en el asa: extiende la selección de bloques.
                    if (e.shiftKey) {
                      e.preventDefault();
                      selectBlocks(blockSel ? blockSel.anchor : focusIndex, index);
                      return;
                    }
                    handleGripClick(index);
                  }}
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
                          {TURN_INTO_COMMANDS.filter((cmd) => allowDatabase || cmd.type !== 'database').map((cmd) => (
                            <button
                              key={cmd.key}
                              type="button"
                              className="docs-bmenu-item"
                              onClick={() => {
                                closeBlockMenu();
                                convertBlock(index, cmd.type, cmd.level, undefined, 0, { toggle: cmd.toggle, linked: cmd.linked });
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
                        duplicateBlocks(index, index);
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
                        moveBlocks(index, index, -1);
                      }}
                    >
                      {t('editor.blockMenu.moveUp')}
                    </button>
                    <button
                      type="button"
                      className="docs-bmenu-item"
                      disabled={subtreeEnd(blocks, index) === blocks.length - 1}
                      onClick={() => {
                        closeBlockMenu();
                        moveBlocks(index, index, 1);
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
                        deleteBlocks(index, index);
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
                  listIndex={numbers[index] || undefined}
                  onChange={handleBlockChange}
                  onKeyDown={handleKeyDown}
                  onFocus={handleFocus}
                  focused={focusIndex === index}
                  fileHref={uploadsEnabled ? fileHref : undefined}
                  pageLinks={pageLinks}
                  database={dbHooks}
                  onPasteFiles={uploadsEnabled && mode === 'edit' ? handlePasteFiles : undefined}
                  onPasteBlocks={mode === 'edit' ? handlePasteBlocks : undefined}
                  onPasteUrl={(embedded && !pageLinks) || mode !== 'edit' ? undefined : onPasteUrl}
                  onPasteSynced={embedded || mode !== 'edit' ? undefined : onPasteSynced}
                  readOnly={mode === 'readonly' || noEdit[index]}
                  toc={toc}
                  trail={trail}
                  onRunButton={runButton}
                  onInlineEquation={openInlineEquation}
                  ref={(el) => { blockRefs.current[index] = el; }}
                />
              </div>
              <div className={`docs-gap${isHidden ? ' is-hidden' : ''}`}>
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
  };

  /** Asa de un contenedor (columnas, sincronizado): arrastra todo y abre su menú. */
  const renderContainerGrip = (index: number) => (
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
  );

  /** Menú de un contenedor: duplicar, mover, borrar (y en un sincronizado, copiar y sincronizar o desincronizar). */
  const renderContainerMenu = (index: number, block: DocsBlock) =>
    blockMenu === index && (
      <div className="docs-block-menu" ref={blockMenuRef} data-no-drag>
        {block.type === 'synced' && (
          <>
            <button
              type="button"
              className="docs-bmenu-item"
              onClick={() => {
                closeBlockMenu();
                copySynced(block);
              }}
            >
              {t('editor.synced.copy')}
            </button>
            <button
              type="button"
              className="docs-bmenu-item"
              onClick={() => {
                closeBlockMenu();
                unsync(index);
              }}
            >
              {t('editor.synced.unsync')}
            </button>
            <hr className="docs-bmenu-divider" />
          </>
        )}
        {block.type === 'columns' && columnsIn(blocks, index).length < MAX_COLUMNS && (
          <button
            type="button"
            className="docs-bmenu-item"
            onClick={() => {
              closeBlockMenu();
              addColumn(index);
            }}
          >
            {t('editor.columns.add')}
          </button>
        )}
        <button
          type="button"
          className="docs-bmenu-item"
          onClick={() => {
            closeBlockMenu();
            duplicateBlocks(index, index);
          }}
        >
          {t('editor.blockMenu.duplicate')}
        </button>
        <button
          type="button"
          className="docs-bmenu-item"
          disabled={index === 0}
          onClick={() => {
            closeBlockMenu();
            moveBlocks(index, index, -1);
          }}
        >
          {t('editor.blockMenu.moveUp')}
        </button>
        <button
          type="button"
          className="docs-bmenu-item"
          disabled={subtreeEnd(blocks, index) === blocks.length - 1}
          onClick={() => {
            closeBlockMenu();
            moveBlocks(index, index, 1);
          }}
        >
          {t('editor.blockMenu.moveDown')}
        </button>
        <hr className="docs-bmenu-divider" />
        <button
          type="button"
          className="docs-bmenu-item docs-bmenu-danger"
          onClick={() => {
            closeBlockMenu();
            deleteBlocks(index, index);
          }}
        >
          {t('editor.blockMenu.delete')}
        </button>
      </div>
    );

  /** El "+" de abajo de un bloque o contenedor. */
  const renderGap = (index: number, isHidden: boolean) => (
    <div className={`docs-gap${isHidden ? ' is-hidden' : ''}`}>
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
  );

  /** Separador entre dos columnas: arrastrar (o ←/→) cambia sus anchos. */
  const startColumnResize = (e: ReactPointerEvent<HTMLElement>, listIndex: number, left: number) => {
    e.preventDefault();
    const row = (e.currentTarget.parentElement as HTMLElement | null) ?? null;
    if (!row) return;
    const total = row.getBoundingClientRect().width;
    const cols = columnsIn(blocks, listIndex);
    const ids = cols.map((c) => blocks[c].id);
    const start = cols.map((c) => columnRatio(blocks[c]));
    const x0 = e.clientX;
    let last = start;
    const move = (ev: PointerEvent) => {
      last = resizeRatios(start, left, ev.clientX - x0, total);
      row.querySelectorAll<HTMLElement>(':scope > .docs-column').forEach((el, k) => {
        el.style.flexGrow = String(last[k]);
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setColumnRatios(ids, last);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** Una fila de columnas: cada columna es un contenedor con sus bloques. */
  const renderColumns = (index: number) => {
    const block = blocks[index];
    const cols = columnsIn(blocks, index);
    const isHidden = hidden[index];
    const indent = visualIndent(blocks, index);
    const selected = !isHidden && index >= selMin && index <= selMax;
    const ratios = cols.map((c) => columnRatio(blocks[c]));
    return (
      <Fragment key={block.id}>
        <div
          className={`docs-block-outer docs-container-outer docs-columns-outer${dragIndex === index ? ' dragging' : ''}${blockMenu === index ? ' menu-open' : ''}${isHidden ? ' is-hidden' : ''}${selected ? ' is-selected' : ''}`}
          style={indent ? ({ '--docs-indent': indent } as CSSProperties) : undefined}
          data-indent={indent || undefined}
          data-bi={index}
          data-in={containerOf(blocks, index)}
          data-testid="docs-columns"
          aria-hidden={isHidden || undefined}
        >
          {renderContainerGrip(index)}
          {renderContainerMenu(index, block)}
          <div className="docs-columns" role="group" aria-label={t('editor.columns.label', { count: cols.length })}>
            {cols.map((c, k) => (
              <Fragment key={blocks[c].id}>
                <div className="docs-column" data-scope={c} data-testid="docs-column" style={{ flexGrow: ratios[k] }}>
                  {renderRange(c + 1, subtreeEnd(blocks, c))}
                </div>
                {k < cols.length - 1 && (
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={t('editor.columns.resize')}
                    tabIndex={0}
                    className="docs-column-resizer"
                    data-no-drag
                    onPointerDown={(e) => startColumnResize(e, index, k)}
                    onKeyDown={(e) => {
                      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                      e.preventDefault();
                      const ids = cols.map((x) => blocks[x].id);
                      // De a 5% del ancho de la fila.
                      setColumnRatios(ids, resizeRatios(ratios, k, e.key === 'ArrowRight' ? 50 : -50, 1000));
                    }}
                  />
                )}
              </Fragment>
            ))}
          </div>
        </div>
        {renderGap(index, isHidden)}
      </Fragment>
    );
  };

  /** Bloque sincronizado: su contenido se comparte con las otras páginas que lo usan. */
  const renderSynced = (index: number) => {
    const block = blocks[index];
    const isHidden = hidden[index];
    const indent = visualIndent(blocks, index);
    const selected = !isHidden && index >= selMin && index <= selMax;
    return (
      <Fragment key={block.id}>
        <div
          className={`docs-block-outer docs-container-outer docs-synced-outer${dragIndex === index ? ' dragging' : ''}${blockMenu === index ? ' menu-open' : ''}${isHidden ? ' is-hidden' : ''}${selected ? ' is-selected' : ''}`}
          style={indent ? ({ '--docs-indent': indent } as CSSProperties) : undefined}
          data-indent={indent || undefined}
          data-bi={index}
          data-in={containerOf(blocks, index)}
          data-testid="docs-synced"
          aria-hidden={isHidden || undefined}
        >
          {renderContainerGrip(index)}
          {renderContainerMenu(index, block)}
          <div className="docs-synced" data-scope={index} role="group" aria-label={t('editor.synced.label')}>
            <div className="docs-synced-bar">
              <DocsGlyph name="synced" size={13} />
              <span>{t('editor.synced.label')}</span>
              {block.no_edit && <span className="docs-synced-readonly" data-testid="docs-synced-readonly">{t('editor.synced.readOnly')}</span>}
              {!block.no_access && (
                <button type="button" className="docs-synced-copy" onClick={() => copySynced(block)}>
                  {t('editor.synced.copy')}
                </button>
              )}
            </div>
            {block.no_access ? (
              // Sin acceso a la página de origen (como Notion): ni el contenido ni dónde está.
              <p className="docs-synced-noaccess" data-testid="docs-synced-noaccess">
                {t('editor.synced.noAccess')}
              </p>
            ) : (
              renderRange(index + 1, subtreeEnd(blocks, index))
            )}
          </div>
        </div>
        {renderGap(index, isHidden)}
      </Fragment>
    );
  };

  /** Bloques [start, end] en orden; los contenedores dibujan su subárbol adentro. */
  function renderRange(start: number, end: number): ReactNode[] {
    const out: ReactNode[] = [];
    let i = start;
    while (i <= end && i < blocks.length) {
      const b = blocks[i];
      if (b.type === 'columns') {
        out.push(renderColumns(i));
        i = subtreeEnd(blocks, i) + 1;
      } else if (b.type === 'synced') {
        out.push(renderSynced(i));
        i = subtreeEnd(blocks, i) + 1;
      } else if (b.type === 'column') {
        // Columna suelta (no debería quedar: normalizeStructure la deshace).
        i = subtreeEnd(blocks, i) + 1;
      } else {
        out.push(renderLeaf(b, i));
        i++;
      }
    }
    return out;
  }
  return (
    <>
    <div
      ref={rootRef}
      className={`docs-editor${smallText ? ' docs-editor-small' : ''}${fullWidth ? ' docs-editor-full' : ''}${embedded ? ' docs-editor-embedded' : ''}${mode === 'suggest' ? ' is-suggesting' : ''}${mode === 'readonly' ? ' is-readonly' : ''}`}
      onKeyDownCapture={handleHistoryKeys}
    >
      {!embedded && (
      <div className="docs-top-bar">
        <nav className="docs-breadcrumb" aria-label={t('editor.breadcrumb')}>
          {/* La banda ya dice "Docs / Páginas": acá van solo ancestros y título. */}
          <ol>
            {ancestorChain.map((a) => (
              <li key={a.id} className="docs-breadcrumb-segment">
                <Link href={`/app/docs/${a.id}`} className="docs-breadcrumb-link">
                  <DocsPageIcon icon={a.icon} pageId={a.id} size={14} />
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
                {importUrl && (
                  <button
                    type="button"
                    role="menuitem"
                    className="docs-menu-item"
                    onClick={() => {
                      setMenuOpen(false);
                      importInputRef.current?.click();
                    }}
                  >
                    {t('editor.import.menu')}
                  </button>
                )}
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
        <div className="docs-cover-anchor docs-cover-anchor-top">
          <DocsCover
            pageId={page.id}
            value={coverUrl}
            position={coverPosition}
            editable
            onChangeClick={() => setCoverOpen(true)}
            onRemove={removeCover}
            onPosition={(pos) => {
              setCoverPosition(pos);
              onSave({ cover_position: pos });
            }}
          />
          {coverOpen && <DocsCoverPicker uploadUrl={uploadsEnabled ? uploadUrl : null} onPick={addCover} onClose={() => setCoverOpen(false)} />}
        </div>
      ) : null}

      <div className="docs-page-header">
        {!embedded && icon && (
          <EmojiPicker
            value={icon.startsWith('img:') ? '' : icon}
            onChange={(next) => {
              setIcon(next);
              triggerSave(undefined, undefined, next);
            }}
            onRemove={() => {
              setIcon('');
              triggerSave(undefined, undefined, '');
            }}
            onUpload={uploadsEnabled ? uploadIcon : undefined}
            triggerLabel={t('editor.changeIcon')}
          >
            {iconImageUrl(icon) ? (
              // Ícono subido: la ruta con permisos (o el archivo local recién subido).
              // eslint-disable-next-line @next/next/no-img-element
              <img className="docs-icon docs-icon-img" src={uploadPreview(iconImageUrl(icon)!) ?? pageImageHref(page.id, 'icon', icon)} alt="" />
            ) : (
              <span className="docs-icon">{icon}</span>
            )}
          </EmojiPicker>
        )}

        {!embedded && (
          <div className="docs-page-meta">
            {!icon && (
              <EmojiPicker
                value=""
                triggerClassName="btn btn-ghost btn-sm docs-meta-btn"
                triggerLabel={t('editor.addIcon')}
                onUpload={uploadsEnabled ? uploadIcon : undefined}
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
                {coverOpen && <DocsCoverPicker uploadUrl={uploadsEnabled ? uploadUrl : null} onPick={addCover} onClose={() => setCoverOpen(false)} />}
              </div>
            )}
            <button type="button" className="btn btn-ghost btn-sm docs-meta-btn" onClick={() => onAddComment?.()}>
              {t('editor.addComment')}
            </button>
            {pageIsEmpty && (
              <button
                type="button"
                className="btn btn-ghost btn-sm docs-meta-btn"
                onClick={() => setTemplatesOpen(true)}
                aria-haspopup="dialog"
                data-testid="docs-page-templates"
              >
                {t('templates.startWith')}
              </button>
            )}
          </div>
        )}
        {!embedded && (
          <DocsTemplateGallery open={templatesOpen} onClose={() => setTemplatesOpen(false)} onUseBuiltIn={applyTemplate} />
        )}

        <div
          ref={titleRef}
          className="docs-title"
          contentEditable={mode === 'edit'}
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={t('editor.pageTitle')}
          data-placeholder={titlePlaceholder ?? t('editor.untitled')}
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
              return;
            }
            // Abajo en la última línea del título: al primer bloque, con la x del caret.
            if (
              e.key === 'ArrowDown' &&
              !e.shiftKey &&
              !e.altKey &&
              !e.metaKey &&
              !e.ctrlKey &&
              (window.getSelection()?.isCollapsed ?? true) &&
              isCaretOnEdgeLine(e.currentTarget, 1)
            ) {
              const x = getCaretViewportRect()?.left ?? e.currentTarget.getBoundingClientRect().left;
              if (moveVertical(-1, 1, x)) e.preventDefault();
            }
          }}
        />
        {belowTitle}
      </div>

      <div
        className={`docs-blocks${fileDropLine !== null ? ' file-dragover' : ''}${blockSel ? ' has-selection' : ''}`}
        ref={blocksWrapRef}
        tabIndex={-1}
        aria-label={blockSel ? t('editor.selection.label', { count: selMax - selMin + 1 }) : undefined}
        onKeyDown={handleSelectionKeyDown}
        onMouseDown={(e) => {
          // Un click (salvo Shift+click en el asa) deja la selección de bloques.
          if (blockSel && !(e.shiftKey && (e.target as HTMLElement).closest('.docs-block-grip'))) setBlockSel(null);
        }}
        onBlur={(e) => {
          if (blockSel && e.target === e.currentTarget && !e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setBlockSel(null);
          }
        }}
        onDragOver={(e) => {
          if (!uploadsEnabled || !Array.from(e.dataTransfer.types).includes('Files')) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          setFileDropLine(computeDrop(e.clientX, e.clientY, false, blocks)?.line ?? null);
        }}
        onDragLeave={(e) => {
          if (!blocksWrapRef.current?.contains(e.relatedTarget as Node | null)) setFileDropLine(null);
        }}
        onDrop={(e) => {
          if (!uploadsEnabled || !Array.from(e.dataTransfer.types).includes('Files')) return;
          e.preventDefault();
          setFileDropLine(null);
          // Cae antes del bloque destino: se ancla al anterior (o al contenedor si es el primero).
          const target = computeDrop(e.clientX, e.clientY, false, blocks);
          const at = target ? target.index - 1 : blocks.length - 1;
          // En la página (fuera de contenedores) después de unas columnas: al nivel del bloque que sigue.
          const indent =
            target?.indent ??
            (at >= 0 && scopeBaseIndent(blocks, at) > 0 ? (blocks[target?.index ?? -1] ? blockIndent(blocks[target!.index]) : 0) : undefined);
          void uploadFiles(Array.from(e.dataTransfer.files), at >= 0 ? blocks[at]?.id ?? null : null, { indent });
        }}
      >
        {renderRange(0, blocks.length - 1)}
        {[dropLine, fileDropLine].map(
          (line, k) =>
            line && (
              <div
                key={k}
                className={`docs-drop-line${line.vertical ? ' is-vertical' : ''}`}
                style={{ top: line.top, left: line.left, width: line.vertical ? 3 : line.width, height: line.vertical ? line.height : undefined }}
                aria-hidden
              />
            ),
        )}
      </div>

      {uploadsEnabled && (
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          data-testid="docs-file-input"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            const target = uploadTarget.current;
            uploadTarget.current = null;
            e.target.value = '';
            if (files.length === 0) return;
            void uploadFiles(files, target ? target.anchorId : blocks[blocks.length - 1]?.id ?? null, {
              replaceId: target?.replaceId,
              kind: target?.kind,
            });
          }}
        />
      )}
      {importUrl && (
        <input
          ref={importInputRef}
          type="file"
          hidden
          accept=".md,.markdown,.txt,.docx,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          data-testid="docs-import-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void importFile(file);
          }}
        />
      )}
      {(uploading > 0 || importing || uploadError) && (
        <p className={`docs-upload-status${uploadError && uploading === 0 && !importing ? ' is-error' : ''}`} role="status">
          <span>
            {uploading > 0
              ? t('editor.upload.uploading', { count: uploading })
              : importing
                ? t('editor.import.importing')
                : uploadError}
          </span>
          {uploadError && uploading === 0 && !importing && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setUploadError(null)}>
              {t('editor.upload.dismiss')}
            </button>
          )}
        </p>
      )}

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
          {filteredCommands.map((cmd, i) => (
            <Fragment key={cmd.key}>
            {(i === 0 || (filteredCommands[i - 1].group ?? 'basic') !== (cmd.group ?? 'basic')) && (
              <div className="docs-command-title">{t(`editor.commandGroups.${cmd.group ?? 'basic'}`)}</div>
            )}
            <button
              type="button"
              className={`docs-command-item${i === cmdSel ? ' sel' : ''}`}
              onClick={() => applyCommand(slash.index, cmd)}
            >
              <span className="docs-command-icon"><DocsGlyph name={commandIcon(cmd)} size={14} /></span>
              <span className="docs-command-label">{cmd.label}</span>
              {cmd.shortcut && (
                <span className="docs-command-shortcut">{cmd.shortcut}</span>
              )}
            </button>
            </Fragment>
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
          search={pageLinks?.search}
          create={pageLinks?.create}
          labels={pageLinks?.labels}
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
          dates={dateOptionLabels}
          onSelectDate={onSelectDateMention}
        />,
        document.body,
      )}

      {!embedded && mode === 'edit' && <DocsEditorPlugins ref={pluginRef} api={pluginApi} />}

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
          {onInlineComment && (
            <>
              <button
                type="button"
                className="docs-format-btn docs-format-btn-text"
                title={`${t('comments.commentSelection')} (⌘⇧M)`}
                aria-label={t('comments.commentSelection')}
                data-testid="docs-inline-comment"
                onClick={() => {
                  const b = blocks[toolbar.index];
                  if (!b) return;
                  onInlineComment({ blockId: b.id, start: toolbar.start, end: toolbar.end, quote: htmlToFlatText(b.content).slice(toolbar.start, toolbar.end) });
                  setToolbar(null);
                }}
              >
                {t('comments.commentShort')}
              </button>
              {mode === 'edit' && <span className="docs-format-sep" aria-hidden />}
            </>
          )}
          {mode === 'edit' && (
          <>
          {!embedded && (
            <>
              <button
                type="button"
                className="docs-format-btn docs-format-ai"
                title={t('ai.askAi')}
                data-testid="docs-format-ai"
                onClick={() => {
                  const tb = toolbar;
                  setToolbar(null);
                  pluginRef.current?.openAi({ index: tb.index, start: tb.start, end: tb.end });
                }}
              >
                <DocsGlyph name="sparkle" size={13} />
                <span>{t('ai.askAi')}</span>
              </button>
              <span className="docs-format-sep" aria-hidden />
            </>
          )}
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
          </>
          )}
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
      {pastePrompt &&
        createPortal(
          <div
            className="docs-menu docs-paste-menu"
            role="menu"
            aria-label={t('editor.paste.title')}
            style={{ position: 'fixed', top: pastePrompt.top, left: Math.max(8, Math.min(pastePrompt.left, window.innerWidth - 228)) }}
            onMouseDown={(e) => e.preventDefault()}
            data-testid="docs-paste-menu"
          >
            <div className="docs-command-title">{t('editor.paste.title')}</div>
            {pasteChoices.map((c, i) => (
              <button
                key={c}
                type="button"
                role="menuitem"
                className={`docs-menu-item${i === pasteSel ? ' sel' : ''}`}
                onMouseEnter={() => setPasteSel(i)}
                onClick={() => void resolvePaste(c)}
              >
                <DocsGlyph name={c === 'bookmark' ? 'bookmark' : c === 'embed' ? 'embed' : 'link'} size={14} />
                {t(`editor.paste.${c}`)}
              </button>
            ))}
          </div>,
          document.body,
        )}
      {eqPopover &&
        createPortal(
          <InlineEquationEditor
            tex={eqPopover.tex}
            style={{ position: 'fixed', top: eqPopover.top, left: Math.max(8, Math.min(eqPopover.left, window.innerWidth - 300)) }}
            onSave={saveInlineEquation}
            onCancel={() => {
              const pop = eqPopover;
              setEqPopover(null);
              setFocusIndex(pop.index);
              setFocusTick((v) => v + 1);
            }}
          />,
          document.body,
        )}
      {syncedNotice && (
        <p className="docs-upload-status" role="status">
          <span>{syncedNotice}</span>
        </p>
      )}
    </div>
    {openRow && openRowBlock && (
      <DbRowPanel
        key={`${openRow.blockId}:${openRow.rowId}`}
        block={openRowBlock}
        rowId={openRow.rowId}
        mode={openRow.mode}
        membersUrl={membersUrl}
        readOnly={mode !== 'edit'}
        pageId={embedded ? null : page.id}
        updateDatabase={updateDatabase}
        pageTitle={title}
        updateDb={(fn) => updateDatabase(openRow.blockId, fn)}
        onMode={(mode) => onOpenRow(openRow.blockId, openRow.rowId, mode)}
        onClose={closeRow}
        renderBody={(bodyPage, onSaveRow, properties) => (
          <DocsEditor
            page={bodyPage}
            ancestors={[]}
            onSave={onSaveRow}
            embedded
            mode={mode === 'edit' ? 'edit' : 'readonly'}
            allowDatabase={false}
            pageLinks={rowPageLinks}
            files={rowFiles}
            belowTitle={properties}
            titlePlaceholder={t('database.untitledRow')}
          />
        )}
      />
    )}
    </>
  );
}
