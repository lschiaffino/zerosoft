'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { escapeHtml } from '@/lib/track-markdown';
import {
  blockRuleFor,
  inlineRuleFor,
  looksLikeMarkdown,
  nodesToMarkdown,
  renderEditorHtml,
  type BlockRule,
  type RtNode,
} from '@/lib/track-richtext';
import { safeHexColor } from '@/lib/track-color';
import { refCache, resolveRefs, statusGlyph, type RefInfo } from './issueRefs';
import TrackIcon, { type TrackIconName } from './TrackIcon';

export interface MentionMember {
  id: string;
  name: string | null;
  email: string;
}

export interface UploadResult {
  url: string;
  filename: string;
  image: boolean;
}

export interface RichEditorHandle {
  focus: () => void;
  /** Reemplaza el contenido (p. ej. vaciar el composer después de comentar). */
  setMarkdown: (markdown: string) => void;
  getMarkdown: () => string;
}

interface RichEditorProps {
  /** Markdown inicial. Si cambia desde afuera (y no es lo que emitió el editor), se vuelve a cargar. */
  value: string;
  onChange: (markdown: string) => void;
  ariaLabel: string;
  placeholder?: string;
  testId?: string;
  members?: MentionMember[];
  /** Pegar, soltar o elegir archivos (imágenes): los sube y deja la imagen o el link. */
  onUpload?: (file: File) => Promise<UploadResult | null>;
  /** ⌘↵ fuera de una tarea (en una tarea, ⌘↵ la tilda, como en Linear). */
  onSubmit?: () => void;
  onEscape?: () => void;
  onFocus?: () => void;
  /** El foco salió del editor entero (no a su menú o barra). */
  onBlur?: () => void;
  autoFocus?: boolean;
  className?: string;
  /** Comentarios: alto mínimo chico. */
  compact?: boolean;
}

type TriggerKind = 'slash' | 'mention' | 'issue';
interface Trigger {
  kind: TriggerKind;
  node: Text;
  start: number;
  query: string;
}

type SlashCmd = 'h1' | 'h2' | 'h3' | 'bullet' | 'numbered' | 'todo' | 'code' | 'quote' | 'divider' | 'table' | 'image';
const SLASH: Array<{ cmd: SlashCmd; icon: TrackIconName; keywords: string; hint?: string }> = [
  { cmd: 'h1', icon: 'heading', keywords: 'heading title titulo título h1', hint: '#' },
  { cmd: 'h2', icon: 'heading', keywords: 'heading subtitle subtitulo h2', hint: '##' },
  { cmd: 'h3', icon: 'heading', keywords: 'heading h3', hint: '###' },
  { cmd: 'bullet', icon: 'list', keywords: 'bullet list lista viñetas', hint: '-' },
  { cmd: 'numbered', icon: 'numbered', keywords: 'numbered ordered numerada', hint: '1.' },
  { cmd: 'todo', icon: 'todo', keywords: 'todo checklist task tarea tareas check', hint: '[]' },
  { cmd: 'code', icon: 'code', keywords: 'code codigo código snippet', hint: '```' },
  { cmd: 'quote', icon: 'quote', keywords: 'quote cita citação', hint: '>' },
  { cmd: 'divider', icon: 'divider', keywords: 'divider separador line hr', hint: '---' },
  { cmd: 'table', icon: 'table', keywords: 'table tabla tabela' },
  { cmd: 'image', icon: 'image', keywords: 'image imagen imagem upload file archivo foto' },
];

const BLOCK_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'PRE', 'BLOCKQUOTE']);

interface Option {
  key: string;
  label: string;
  meta?: string;
  icon?: TrackIconName;
  swatch?: string;
  apply: () => void;
}

function exec(cmd: string, arg?: string): boolean {
  // execCommand sigue siendo la forma de editar un contenteditable sin romper
  // el ⌘Z nativo del navegador (todos los navegadores lo soportan).
  return document.execCommand(cmd, false, arg);
}

function caretRange(): Range | null {
  const sel = window.getSelection();
  return sel && sel.rangeCount ? sel.getRangeAt(0) : null;
}

/**
 * Editor visual de Track (descripción y comentarios), como el de Linear:
 * markdown que se convierte al tipear (`# `, `- `, `1. `, `[] `, `> `,
 * ``` ``` ```, **negrita**, `código`), "/" para insertar bloques, "@" para
 * personas e issues, "#" para issues, tareas que se tildan con clic o ⌘↵,
 * pegar o soltar imágenes y una barra flotante al seleccionar. Guarda
 * markdown (lib/track-richtext), el mismo que leen la API y los emails.
 */
const RichEditor = forwardRef<RichEditorHandle, RichEditorProps>(function RichEditor(
  {
    value,
    onChange,
    ariaLabel,
    placeholder,
    testId,
    members = [],
    onUpload,
    onSubmit,
    onEscape,
    onFocus,
    onBlur,
    autoFocus,
    className = '',
    compact = false,
  },
  ref,
) {
  const te = useTranslations('track.ux.editor');
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastMd = useRef<string>('');
  const prevValue = useRef<string>(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const membersRef = useRef(members);
  membersRef.current = members;
  const [empty, setEmpty] = useState(!value.trim());
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [active, setActive] = useState(0);
  const [issueHits, setIssueHits] = useState<RefInfo[]>([]);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [toolbar, setToolbar] = useState<{ top: number; left: number } | null>(null);
  const [linkInput, setLinkInput] = useState<{ range: Range; value: string } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [tooLong, setTooLong] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const menuId = `rte-${useId().replace(/:/g, '')}`;

  // ---------- contenido ----------

  /** Completa chips de issues (glifo de estado y título) y de personas (nombre). */
  const upgradeChips = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const refs = Array.from(root.querySelectorAll<HTMLElement>('[data-issue-ref]'));
    const paint = () => {
      for (const chip of refs) {
        if (chip.dataset.resolved) continue;
        const info = refCache.get(chip.dataset.issueRef!)?.info;
        if (!info) continue;
        chip.dataset.resolved = '1';
        chip.title = `${info.identifier} ${info.title}${info.status_name ? ` · ${info.status_name}` : ''}`;
        if (chip.tagName === 'A') continue;
        chip.innerHTML = `${statusGlyph(info)}<span class="track-chip-id"></span><span class="track-chip-title"></span>`;
        (chip.querySelector('.track-chip-id') as HTMLElement).textContent = info.identifier;
        (chip.querySelector('.track-chip-title') as HTMLElement).textContent = info.title;
      }
    };
    paint();
    const ids = Array.from(new Set(refs.map((r) => r.dataset.issueRef!).filter(Boolean)));
    if (ids.length) void resolveRefs(ids).then(paint);
    for (const chip of Array.from(root.querySelectorAll<HTMLElement>('[data-mention]'))) {
      const email = chip.dataset.mention!.slice(1).toLowerCase();
      const m = membersRef.current.find((x) => x.email.toLowerCase() === email);
      if (m?.name) chip.textContent = `@${m.name}`;
    }
  }, []);

  const load = useCallback(
    (markdown: string) => {
      const root = rootRef.current;
      if (!root) return;
      root.innerHTML = renderEditorHtml(markdown);
      lastMd.current = nodesToMarkdown(root as unknown as RtNode);
      setEmpty(!lastMd.current);
      setTooLong(lastMd.current.length > 5000);
      upgradeChips();
    },
    [upgradeChips],
  );

  useLayoutEffect(() => {
    load(value);
    if (autoFocus) {
      const root = rootRef.current;
      if (root) {
        root.focus();
        const r = document.createRange();
        r.selectNodeContents(root);
        r.collapse(false);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(r);
      }
    }
    // Solo al montar: después manda `value` (efecto de abajo).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (value === prevValue.current) return;
    prevValue.current = value;
    if (value === lastMd.current) return;
    load(value);
  }, [value, load]);

  const emit = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const md = nodesToMarkdown(root as unknown as RtNode);
    const isEmpty = !md && !root.querySelector('img, hr, table, li, pre');
    setEmpty(isEmpty);
    setTooLong(md.length > 5000);
    if (md === lastMd.current) return;
    lastMd.current = md;
    prevValue.current = md;
    onChangeRef.current(md);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => rootRef.current?.focus(),
      setMarkdown: (md: string) => {
        prevValue.current = md;
        load(md);
      },
      getMarkdown: () => lastMd.current,
    }),
    [load],
  );

  // ---------- helpers de selección ----------

  function currentBlock(): HTMLElement | null {
    const root = rootRef.current;
    let n: Node | null = caretRange()?.startContainer ?? null;
    while (n && n !== root) {
      if (n.nodeType === 1 && BLOCK_TAGS.has(n.nodeName)) return n as HTMLElement;
      n = n.parentNode;
    }
    return null;
  }

  function textBefore(block: Node): string {
    const r = caretRange();
    if (!r) return '';
    const pre = document.createRange();
    pre.setStart(block, 0);
    pre.setEnd(r.startContainer, r.startOffset);
    return pre.toString();
  }

  function placeCaret(node: Node, offset: number) {
    const r = document.createRange();
    r.setStart(node, offset);
    r.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);
  }

  function selectFromBlockStart(block: Node) {
    const r = caretRange();
    if (!r) return;
    const sel = document.createRange();
    sel.setStart(block, 0);
    sel.setEnd(r.startContainer, r.startOffset);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(sel);
  }

  function closestTask(): HTMLLIElement | null {
    const n = caretRange()?.startContainer ?? null;
    const el = (n?.nodeType === 1 ? n : n?.parentElement) as HTMLElement | null;
    const li = el?.closest('li');
    return li && rootRef.current?.contains(li) && li.hasAttribute('data-task') ? (li as HTMLLIElement) : null;
  }

  function ensureTrailingNewline(pre: HTMLElement) {
    if (!(pre.textContent ?? '').endsWith('\n')) pre.appendChild(document.createTextNode('\n'));
  }

  // ---------- bloques ----------

  /** Convierte el bloque del cursor (ya sin el prefijo tipeado). */
  function applyBlock(rule: BlockRule | { kind: 'divider' } | { kind: 'table' }) {
    switch (rule.kind) {
      case 'heading':
        exec('formatBlock', `h${rule.level}`);
        break;
      case 'quote':
        exec('formatBlock', 'blockquote');
        break;
      case 'bullet':
        if (!currentBlock()?.closest('ul')) exec('insertUnorderedList');
        break;
      case 'numbered':
        if (!currentBlock()?.closest('ol')) exec('insertOrderedList');
        break;
      case 'todo': {
        let li = currentBlock()?.closest('li') as HTMLLIElement | null;
        if (!li) {
          exec('insertUnorderedList');
          li = currentBlock()?.closest('li') as HTMLLIElement | null;
        }
        if (li) {
          li.setAttribute('data-task', '1');
          li.setAttribute('data-checked', rule.checked ? 'true' : 'false');
        }
        break;
      }
      case 'code': {
        exec('formatBlock', 'pre');
        const pre = currentBlock()?.closest('pre') as HTMLElement | null;
        if (pre) {
          if (rule.lang) pre.setAttribute('data-lang', rule.lang);
          ensureTrailingNewline(pre);
        }
        break;
      }
      case 'divider':
        exec('insertHTML', '<hr><p><br></p>');
        break;
      case 'table':
        exec(
          'insertHTML',
          '<table><thead><tr><th><br></th><th><br></th></tr></thead><tbody><tr><td><br></td><td><br></td></tr></tbody></table><p><br></p>',
        );
        break;
    }
  }

  // ---------- menú "/", "@" y "#" ----------

  const wantsIssues = trigger && (trigger.kind === 'issue' || trigger.kind === 'mention');
  const issueQuery = wantsIssues ? trigger.query : null;
  useEffect(() => {
    if (issueQuery === null) {
      setIssueHits([]);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      const sp = new URLSearchParams({ pageSize: '6' });
      if (issueQuery) sp.set('q', issueQuery);
      void fetch(`/api/track/issues?${sp.toString()}`)
        .then((r) => (r.ok ? (r.json() as Promise<{ rows: RefInfo[] }>) : { rows: [] }))
        .then((d) => alive && setIssueHits(d.rows.slice(0, 6)))
        .catch(() => alive && setIssueHits([]));
    }, 120);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [issueQuery]);

  function selectTrigger(t: Trigger) {
    const r = caretRange();
    const range = document.createRange();
    range.setStart(t.node, t.start);
    if (r && r.startContainer === t.node) range.setEnd(t.node, r.startOffset);
    else range.setEnd(t.node, Math.min(t.node.length, t.start + 1 + t.query.length));
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  }

  function insertChip(html: string) {
    exec('insertHTML', `${html}&nbsp;`);
    upgradeChips();
    emit();
  }

  const options: Option[] = useMemo(() => {
    if (!trigger) return [];
    const q = trigger.query.toLowerCase();
    const run = (fn: () => void) => () => {
      const t = trigger;
      setTrigger(null);
      rootRef.current?.focus();
      selectTrigger(t);
      exec('delete');
      fn();
      emit();
    };
    if (trigger.kind === 'slash') {
      return SLASH.filter((s) => !q || te(`slash.${s.cmd}`).toLowerCase().includes(q) || s.keywords.includes(q)).map((s) => ({
        key: s.cmd,
        label: te(`slash.${s.cmd}`),
        meta: s.hint,
        icon: s.icon,
        apply: run(() => {
          if (s.cmd === 'image') fileRef.current?.click();
          else if (s.cmd === 'h1' || s.cmd === 'h2' || s.cmd === 'h3') applyBlock({ kind: 'heading', level: Number(s.cmd[1]) as 1 | 2 | 3 });
          else if (s.cmd === 'todo') applyBlock({ kind: 'todo', checked: false });
          else if (s.cmd === 'code') applyBlock({ kind: 'code', lang: '' });
          else applyBlock({ kind: s.cmd } as BlockRule);
        }),
      }));
    }
    const people: Option[] =
      trigger.kind === 'mention'
        ? members
            .filter((m) => !q || m.email.toLowerCase().includes(q) || (m.name ?? '').toLowerCase().includes(q))
            .slice(0, 6)
            .map((m) => ({
              key: `u:${m.id}`,
              label: m.name ?? m.email,
              meta: m.email,
              icon: 'user' as const,
              apply: run(() => {
                const md = escapeHtml(`@${m.email}`);
                insertChip(`<span class="track-chip track-chip-mention" contenteditable="false" data-md="${md}" data-mention="${md}">@${escapeHtml(m.name ?? m.email)}</span>`);
              }),
            }))
        : [];
    const issues: Option[] = issueHits.map((i) => ({
      key: `i:${i.id}`,
      label: `${i.identifier} ${i.title}`,
      swatch: i.status_color ? safeHexColor(i.status_color, '#767676') : undefined,
      meta: i.status_name ?? undefined,
      apply: run(() => {
        refCache.set(i.identifier, { at: Date.now(), info: i });
        const id = escapeHtml(i.identifier);
        insertChip(`<span class="track-chip track-chip-issue" contenteditable="false" data-md="${id}" data-issue-ref="${id}">${id}</span>`);
      }),
    }));
    return [...people, ...issues];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger, members, issueHits, te]);

  useEffect(() => {
    if (active >= options.length) setActive(0);
  }, [options.length, active]);

  function refreshTrigger() {
    const r = caretRange();
    const root = rootRef.current;
    if (!r || !r.collapsed || !root || r.startContainer.nodeType !== 3 || !root.contains(r.startContainer)) {
      setTrigger(null);
      return;
    }
    const node = r.startContainer as Text;
    if (node.parentElement?.closest('pre, code')) {
      setTrigger(null);
      return;
    }
    const before = node.data.slice(0, r.startOffset);
    const m = /(^|[\s ])([/@#])([^\s/@#]{0,40})$/.exec(before);
    if (!m) {
      setTrigger(null);
      return;
    }
    const kind: TriggerKind = m[2] === '/' ? 'slash' : m[2] === '@' ? 'mention' : 'issue';
    const start = m.index + m[1].length;
    // "/" solo al empezar un bloque o después de un espacio (no en una URL a medias).
    setTrigger((prev) => {
      if (!prev || prev.kind !== kind || prev.node !== node || prev.start !== start) setActive(0);
      return { kind, node, start, query: m[3] };
    });
    const rect = (() => {
      const probe = document.createRange();
      probe.setStart(node, start);
      probe.setEnd(node, Math.min(node.length, start + 1));
      return probe.getBoundingClientRect();
    })();
    const wrap = wrapRef.current?.getBoundingClientRect();
    if (wrap) {
      const width = Math.min(300, wrap.width);
      setMenuPos({ top: rect.bottom - wrap.top + 4, left: Math.max(0, Math.min(rect.left - wrap.left, wrap.width - width)) });
    }
  }

  // ---------- barra flotante al seleccionar ----------

  useEffect(() => {
    const onSel = () => {
      const root = rootRef.current;
      const wrap = wrapRef.current;
      const r = caretRange();
      if (!root || !wrap || !r || r.collapsed || !root.contains(r.commonAncestorContainer)) {
        setToolbar(null);
        return;
      }
      if ((r.commonAncestorContainer.parentElement ?? (r.commonAncestorContainer as HTMLElement)).closest?.('pre')) {
        setToolbar(null);
        return;
      }
      const rect = r.getBoundingClientRect();
      const w = wrap.getBoundingClientRect();
      const width = 228;
      setToolbar({
        top: Math.max(0, rect.top - w.top - 38),
        left: Math.max(0, Math.min(rect.left - w.left + rect.width / 2 - width / 2, w.width - width)),
      });
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, []);

  function format(kind: 'bold' | 'italic' | 'strike' | 'code' | 'link') {
    rootRef.current?.focus();
    if (kind === 'bold') exec('bold');
    else if (kind === 'italic') exec('italic');
    else if (kind === 'strike') exec('strikeThrough');
    else if (kind === 'code') {
      const r = caretRange();
      const text = r?.toString() ?? '';
      if (text) exec('insertHTML', `<code>${escapeHtml(text)}</code>​`);
    } else {
      const r = caretRange();
      if (r && !r.collapsed) setLinkInput({ range: r.cloneRange(), value: '' });
      return;
    }
    emit();
  }

  function applyLink() {
    if (!linkInput) return;
    const url = linkInput.value.trim();
    const range = linkInput.range;
    setLinkInput(null);
    rootRef.current?.focus();
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    if (url && /^(https?:\/\/|mailto:|\/)/i.test(url)) exec('createLink', url);
    else if (url) exec('createLink', `https://${url}`);
    emit();
  }

  // ---------- archivos ----------

  async function uploadFiles(files: File[]) {
    if (!onUpload || files.length === 0) return;
    setUploadError(null);
    for (const file of files) {
      const key = `up${Math.random().toString(36).slice(2, 8)}`;
      rootRef.current?.focus();
      exec(
        'insertHTML',
        `<span class="track-uploading" contenteditable="false" data-md="" data-upload="${key}">${escapeHtml(te('uploading', { name: file.name }))}</span>`,
      );
      const result = await onUpload(file).catch(() => null);
      const holder = rootRef.current?.querySelector(`[data-upload="${key}"]`);
      if (!holder) continue;
      if (!result) {
        holder.remove();
        setUploadError(te('uploadError', { name: file.name }));
        emit();
        continue;
      }
      const el = result.image ? document.createElement('img') : document.createElement('a');
      if (el instanceof HTMLImageElement) {
        el.src = result.url;
        el.alt = result.filename;
      } else {
        (el as HTMLAnchorElement).href = result.url;
        el.textContent = result.filename;
      }
      holder.replaceWith(el);
      emit();
    }
  }

  // ---------- eventos ----------

  function onInput(e: React.FormEvent<HTMLDivElement>) {
    const native = e.nativeEvent as InputEvent;
    const root = rootRef.current!;
    // Texto suelto en la raíz (todo borrado): vuelve a un párrafo.
    if (!currentBlock() && root.textContent) exec('formatBlock', 'p');
    if (native.inputType === 'insertText' && native.data) {
      const block = currentBlock();
      const inCode = Boolean(block?.closest('pre'));
      if (block && !inCode && (native.data === ' ' || native.data === '`')) {
        const prefix = textBefore(block);
        const rule = blockRuleFor(prefix.replace(/ /g, ' '));
        const blockOk = block.tagName === 'P' || block.tagName === 'DIV' || (rule?.kind === 'todo' && block.tagName === 'LI');
        if (rule && blockOk && (rule.kind !== 'code' || native.data === '`')) {
          selectFromBlockStart(block);
          exec('delete');
          applyBlock(rule);
          setTrigger(null);
          emit();
          return;
        }
      }
      const r = caretRange();
      if (!inCode && r && r.startContainer.nodeType === 3 && '*_~`'.includes(native.data) && !r.startContainer.parentElement?.closest('code')) {
        const node = r.startContainer as Text;
        const rule = inlineRuleFor(node.data.slice(0, r.startOffset));
        if (rule) {
          const range = document.createRange();
          range.setStart(node, rule.start);
          range.setEnd(node, r.startOffset);
          window.getSelection()?.removeAllRanges();
          window.getSelection()?.addRange(range);
          exec('insertHTML', `<${rule.tag}>${escapeHtml(rule.text)}</${rule.tag}>​`);
        }
      }
    }
    if (native.inputType === 'insertParagraph') {
      // Ítem nuevo de una lista de tareas: sin tildar.
      const li = closestTask();
      if (li && !(li.textContent ?? '').trim()) li.setAttribute('data-checked', 'false');
    }
    refreshTrigger();
    emit();
  }

  function toggleTask(li: HTMLElement) {
    li.setAttribute('data-checked', li.getAttribute('data-checked') === 'true' ? 'false' : 'true');
    emit();
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    const menuOpen = trigger && options.length > 0;
    if (menuOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        options[active]?.apply();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setTrigger(null);
        return;
      }
    }
    const mod = e.metaKey || e.ctrlKey;
    const block = currentBlock();
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (onEscape) {
        e.preventDefault();
        onEscape();
      } else rootRef.current?.blur();
      return;
    }
    if (e.key === 'Enter' && mod) {
      e.preventDefault();
      e.stopPropagation();
      const li = closestTask();
      if (li) toggleTask(li);
      else onSubmit?.();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      const pre = block?.closest('pre') as HTMLElement | null;
      if (pre) {
        e.preventDefault();
        ensureTrailingNewline(pre);
        const before = textBefore(pre);
        const full = pre.textContent ?? '';
        // Línea vacía al final del bloque: Enter sale del código.
        if (before.length >= full.length - 1 && before.endsWith('\n')) {
          const r = caretRange();
          if (r && r.startContainer.nodeType === 3 && r.startOffset > 0) {
            const del = document.createRange();
            del.setStart(r.startContainer, r.startOffset - 1);
            del.setEnd(r.startContainer, r.startOffset);
            window.getSelection()?.removeAllRanges();
            window.getSelection()?.addRange(del);
            exec('delete');
          }
          const p = document.createElement('p');
          p.appendChild(document.createElement('br'));
          pre.after(p);
          placeCaret(p, 0);
        } else exec('insertText', '\n');
        emit();
        return;
      }
      if (block && (block.tagName === 'P' || block.tagName === 'DIV') && (block.textContent ?? '').trim() === '---') {
        e.preventDefault();
        block.textContent = '';
        placeCaret(block, 0);
        applyBlock({ kind: 'divider' });
        emit();
        return;
      }
      const quote = block?.closest('blockquote') as HTMLElement | null;
      if (quote) {
        e.preventDefault();
        const before = textBefore(quote);
        const atEnd = before.length >= (quote.textContent ?? '').length;
        if (!(quote.textContent ?? '').trim() || (atEnd && (before.endsWith('\n') || !before.trim()))) {
          // Línea vacía: sale de la cita.
          const last = quote.lastChild;
          if (last && last.nodeName === 'BR') last.remove();
          const p = document.createElement('p');
          p.appendChild(document.createElement('br'));
          quote.after(p);
          if (!(quote.textContent ?? '').trim()) quote.remove();
          placeCaret(p, 0);
        } else exec('insertLineBreak');
        emit();
        return;
      }
    }
    if (e.key === 'Backspace' && !mod && block) {
      const r = caretRange();
      if (r?.collapsed && textBefore(block) === '') {
        const tag = block.tagName;
        if (/^H[1-6]$/.test(tag) || tag === 'BLOCKQUOTE' || tag === 'PRE') {
          e.preventDefault();
          if (tag === 'PRE') block.textContent = (block.textContent ?? '').replace(/\n$/, '');
          exec('formatBlock', 'p');
          emit();
          return;
        }
        if (tag === 'LI') {
          e.preventDefault();
          if (block.hasAttribute('data-task')) {
            block.removeAttribute('data-task');
            block.removeAttribute('data-checked');
          } else exec('outdent');
          emit();
          return;
        }
      }
    }
    if (e.key === 'Tab' && !mod && block?.closest('li')) {
      e.preventDefault();
      exec(e.shiftKey ? 'outdent' : 'indent');
      emit();
      return;
    }
    if (!mod || e.altKey) return;
    const key = e.key.toLowerCase();
    if (!e.shiftKey && (key === 'b' || key === 'i')) {
      e.preventDefault();
      format(key === 'b' ? 'bold' : 'italic');
    } else if (!e.shiftKey && key === 'e') {
      e.preventDefault();
      format('code');
    } else if (!e.shiftKey && key === 'u') {
      // Sin subrayado: markdown no lo tiene.
      e.preventDefault();
    } else if (!e.shiftKey && key === 'k' && !caretRange()?.collapsed) {
      // Con texto elegido ⌘K hace un link (sin abrir la paleta), como en Linear.
      e.preventDefault();
      e.stopPropagation();
      format('link');
    } else if (e.shiftKey && (key === 'x' || e.code === 'KeyX')) {
      e.preventDefault();
      format('strike');
    } else if (e.shiftKey && (e.code === 'Digit7' || e.code === 'Digit8' || e.code === 'Digit9')) {
      e.preventDefault();
      applyBlock(e.code === 'Digit7' ? { kind: 'numbered' } : e.code === 'Digit8' ? { kind: 'bullet' } : { kind: 'todo', checked: false });
      emit();
    }
  }

  function onPaste(e: ClipboardEvent<HTMLDivElement>) {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (onUpload && files.length) {
      e.preventDefault();
      void uploadFiles(files);
      return;
    }
    const text = e.clipboardData.getData('text/plain');
    const html = e.clipboardData.getData('text/html');
    const r = caretRange();
    e.preventDefault();
    if (currentBlock()?.closest('pre')) {
      exec('insertText', text);
      emit();
      return;
    }
    // URL sobre texto elegido → link.
    if (r && !r.collapsed && /^(https?:\/\/|mailto:)\S+$/i.test(text.trim())) {
      exec('createLink', text.trim());
      emit();
      return;
    }
    let md: string | null = null;
    if (html) {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      md = nodesToMarkdown(doc.body as unknown as RtNode);
    } else if (looksLikeMarkdown(text)) md = text;
    if (md === null || !md.includes('\n') && !/^(#|[-*+] |\d+\. |> |```)/.test(md) && md === text) {
      exec('insertText', text);
    } else {
      let out = renderEditorHtml(md);
      // Un solo párrafo: va en línea, sin partir el bloque actual.
      const single = /^<p>([\s\S]*)<\/p>$/.exec(out);
      if (single && !single[1].includes('<p>')) out = single[1];
      exec('insertHTML', out);
      upgradeChips();
    }
    emit();
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    setDragOver(false);
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (!onUpload || files.length === 0) return;
    e.preventDefault();
    const pos = (document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }).caretRangeFromPoint?.(e.clientX, e.clientY);
    if (pos) {
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(pos);
    }
    void uploadFiles(files);
  }

  function onMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    const li = (e.target as HTMLElement).closest('li[data-task]') as HTMLElement | null;
    if (li && rootRef.current?.contains(li)) {
      const box = li.getBoundingClientRect();
      // La casilla se dibuja en el margen izquierdo del ítem.
      if (e.clientX - box.left < 22 && e.clientY - box.top < 24) {
        e.preventDefault();
        toggleTask(li);
      }
    }
  }

  function onClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    const link = target.closest('a[href]') as HTMLAnchorElement | null;
    const chip = target.closest('.track-chip-issue') as HTMLElement | null;
    // ⌘clic (o clic en un chip de issue) abre; un clic simple en un link edita.
    if (chip && (e.metaKey || e.ctrlKey || e.detail === 1)) {
      const info = refCache.get(chip.dataset.issueRef ?? '')?.info;
      if (info && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        router.push(`/app/track/issues/${info.id}`);
      }
      return;
    }
    if (link && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      window.open(link.href, '_blank', 'noopener,noreferrer');
    }
    refreshTrigger();
  }

  const menuOpen = Boolean(trigger && options.length > 0 && menuPos);

  return (
    <div
      ref={wrapRef}
      className={`track-rte${compact ? ' is-compact' : ''}${dragOver ? ' is-drop' : ''} ${className}`.trim()}
      onBlur={(e) => {
        const next = e.relatedTarget as Node | null;
        if (next && wrapRef.current?.contains(next)) return;
        setTrigger(null);
        if (!linkInput) setToolbar(null);
        onBlur?.();
      }}
    >
      <div
        ref={rootRef}
        className={`track-rte-content track-markdown${empty ? ' is-empty' : ''}`}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        aria-placeholder={placeholder}
        // `placeholder` también como atributo: lo usan los tests (getByPlaceholder).
        {...({ placeholder } as Record<string, string | undefined>)}
        data-placeholder={placeholder}
        data-testid={testId}
        aria-autocomplete="list"
        aria-controls={menuOpen ? menuId : undefined}
        aria-activedescendant={menuOpen ? `${menuId}-${active}` : undefined}
        spellCheck
        onInput={onInput}
        onKeyDown={onKeyDown}
        onKeyUp={(e) => {
          if (e.key.startsWith('Arrow') && !menuOpen) refreshTrigger();
        }}
        onMouseDown={onMouseDown}
        onClick={onClick}
        onFocus={() => {
          exec('defaultParagraphSeparator', 'p');
          onFocus?.();
        }}
        onPaste={onPaste}
        onDragOver={(e) => {
          if (onUpload && e.dataTransfer?.types.includes('Files')) {
            e.preventDefault();
            setDragOver(true);
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      />
      {menuOpen && trigger && menuPos && (
        <div
          className="track-md-menu track-rte-menu"
          style={{ top: menuPos.top, left: menuPos.left }}
          id={menuId}
          role="listbox"
          aria-label={te(`menu.${trigger.kind}`)}
          data-testid="track-md-menu"
        >
          <p className="track-md-menu-head">{te(`menu.${trigger.kind}`)}</p>
          {options.map((o, i) => (
            <button
              key={o.key}
              id={`${menuId}-${i}`}
              type="button"
              role="option"
              aria-selected={i === active}
              className={`track-md-menu-item${i === active ? ' is-active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => o.apply()}
            >
              {o.swatch ? (
                <span className="cmdk-swatch" style={{ background: o.swatch }} aria-hidden />
              ) : o.icon ? (
                <span className="track-md-menu-icon" aria-hidden>
                  <TrackIcon name={o.icon} size={13} />
                </span>
              ) : null}
              <span className="track-md-menu-label">{o.label}</span>
              {o.meta && <span className="track-md-menu-meta">{o.meta}</span>}
            </button>
          ))}
        </div>
      )}
      {(toolbar || linkInput) && (
        <div
          className="track-rte-toolbar"
          role="toolbar"
          aria-label={te('toolbar')}
          style={toolbar ? { top: toolbar.top, left: toolbar.left } : undefined}
          data-testid="track-rte-toolbar"
        >
          {linkInput ? (
            <input
              className="input track-rte-link"
              autoFocus
              value={linkInput.value}
              placeholder={te('linkPlaceholder')}
              aria-label={te('link')}
              onChange={(e) => setLinkInput({ ...linkInput, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  applyLink();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  setLinkInput(null);
                  rootRef.current?.focus();
                }
              }}
              onBlur={() => setLinkInput(null)}
            />
          ) : (
            (
              [
                ['bold', 'bold', 'Meta+B'],
                ['italic', 'italic', 'Meta+I'],
                ['strike', 'strike', 'Meta+Shift+X'],
                ['code', 'code', 'Meta+E'],
                ['link', 'link', 'Meta+K'],
              ] as const
            ).map(([kind, icon, keys]) => (
              <button
                key={kind}
                type="button"
                className="btn btn-ghost btn-sm btn-icon"
                aria-label={te(kind)}
                title={te(kind)}
                aria-keyshortcuts={keys}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => format(kind)}
              >
                <TrackIcon name={icon} size={14} />
              </button>
            ))
          )}
        </div>
      )}
      {onUpload && (
        <input
          ref={fileRef}
          type="file"
          hidden
          accept="image/*,application/pdf,.txt,.csv,.zip"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            void uploadFiles(files);
          }}
        />
      )}
      {uploadError && (
        <p className="ui-error track-md-error" role="alert">
          {uploadError}
        </p>
      )}
      {tooLong && (
        <p className="ui-error track-md-error" role="alert">
          {te('tooLong')}
        </p>
      )}
    </div>
  );
});

export default RichEditor;
