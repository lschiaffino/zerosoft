'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type RefObject,
  type TextareaHTMLAttributes,
} from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import {
  applyMarkdownAction,
  applySlashCommand,
  autoTask,
  continueList,
  detectTrigger,
  indentListItem,
  insertCompletion,
  renderTrackMarkdown,
  type EditorTrigger,
  type MarkdownAction,
  type SlashCommand,
} from '@/lib/track-markdown';
import { glyphColor, safeHexColor } from '@/lib/track-color';
import TrackIcon from './TrackIcon';

export interface MarkdownLabels {
  write: string;
  preview: string;
  toolbar: string;
  bold: string;
  italic: string;
  code: string;
  list: string;
  link: string;
  /** Texto que se inserta cuando no hay selección (negrita, link…). */
  placeholderText: string;
  emptyPreview: string;
  hint: string;
}

interface RefInfo {
  id: string;
  identifier: string;
  title: string;
  status_name: string | null;
  status_color: string | null;
  status_category: string | null;
}

// Referencias ya resueltas en esta pestaña (el estado se refresca cada minuto).
const refCache = new Map<string, { at: number; info: RefInfo | null }>();
const REF_TTL = 60_000;

async function resolveRefs(refs: string[]): Promise<void> {
  const now = Date.now();
  const missing = refs.filter((r) => {
    const hit = refCache.get(r);
    return !hit || now - hit.at > REF_TTL;
  });
  if (missing.length === 0) return;
  const res = await fetch(`/api/track/refs?refs=${encodeURIComponent(missing.join(','))}`).catch(() => null);
  if (!res?.ok) return;
  const rows = ((await res.json()) as { rows: RefInfo[] }).rows;
  for (const r of missing) refCache.set(r, { at: now, info: null });
  for (const row of rows) {
    refCache.set(row.identifier, { at: now, info: row });
    refCache.set(row.id, { at: now, info: row });
  }
}

function statusGlyph(info: RefInfo): string {
  const c = info.status_category === 'cancelled' ? '#8c8c8c' : glyphColor(info.status_color);
  const filled = info.status_category === 'done' || info.status_category === 'cancelled';
  const half = info.status_category === 'in_progress' ? '<path d="M7 3.25a3.75 3.75 0 0 1 0 7.5z" fill="currentColor"/>' : '';
  const dash = info.status_category === 'backlog' ? ' stroke-dasharray="2.2 1.8"' : '';
  // El color va en style (acepta var(--ink)); el SVG usa currentColor.
  return `<svg class="track-status-glyph" viewBox="0 0 14 14" width="12" height="12" aria-hidden="true" style="color:${c}"><circle cx="7" cy="7" r="5.75" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.5"${dash}/>${half}</svg>`;
}

/**
 * Markdown renderizado (sanitizado en lib/track-markdown). Las referencias a
 * issues (ZER-12 o un link a un issue) se completan con su estado y título y
 * llevan al issue; con `onToggleTask` los checkboxes se pueden tildar.
 */
export function MarkdownView({
  source,
  className = '',
  onToggleTask,
}: {
  source: string;
  className?: string;
  onToggleTask?: (index: number) => void;
}) {
  const interactive = Boolean(onToggleTask);
  const html = useMemo(() => renderTrackMarkdown(source, { interactive }), [source, interactive]);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Completa las referencias ya resueltas que haya en el DOM. Se vuelve a
  // consultar el DOM en cada pasada: React puede reemplazar el HTML (p. ej. al
  // hidratar) y unos nodos guardados de antes quedarían sueltos.
  const upgrade = useCallback(() => {
    const root = ref.current;
    if (!root) return;
    for (const node of Array.from(root.querySelectorAll<HTMLElement>('[data-issue-ref]:not([data-resolved])'))) {
      const info = refCache.get(node.dataset.issueRef!)?.info;
      if (!info) continue;
      node.dataset.resolved = '1';
      node.title = `${info.identifier} ${info.title}${info.status_name ? ` · ${info.status_name}` : ''}`;
      if (node.tagName === 'A') {
        node.insertAdjacentHTML('afterbegin', statusGlyph(info));
        continue;
      }
      // ZER-12 suelto → link con glifo de estado, ID y título.
      const a = document.createElement('a');
      a.className = 'track-issue-ref is-resolved';
      a.href = `/app/track/issues/${info.id}`;
      a.dataset.issueRef = info.identifier;
      a.dataset.resolved = '1';
      a.title = node.title;
      a.innerHTML = `${statusGlyph(info)}<span class="track-issue-ref-id"></span><span class="track-issue-ref-title"></span>`;
      (a.querySelector('.track-issue-ref-id') as HTMLElement).textContent = info.identifier;
      (a.querySelector('.track-issue-ref-title') as HTMLElement).textContent = info.title;
      node.replaceWith(a);
    }
  }, []);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const refs = Array.from(
      new Set(Array.from(root.querySelectorAll<HTMLElement>('[data-issue-ref]')).map((n) => n.dataset.issueRef!).filter(Boolean)),
    );
    if (refs.length === 0) return;
    let alive = true;
    upgrade();
    void resolveRefs(refs).then(() => {
      if (alive) upgrade();
      // Una pasada más después del próximo render (si React tocó el HTML).
      window.setTimeout(() => alive && upgrade(), 300);
    });
    return () => {
      alive = false;
    };
  }, [html, upgrade]);

  return (
    <div
      ref={ref}
      className={`track-markdown ${className}`.trim()}
      onClick={(e) => {
        const el = e.target as HTMLElement;
        const box = el.closest('input.track-task') as HTMLInputElement | null;
        if (box && onToggleTask) {
          e.stopPropagation();
          onToggleTask(Number(box.dataset.task));
          return;
        }
        // Links a issues: navegación de la app (sin recargar).
        const issue = el.closest('a[data-issue-ref]') as HTMLAnchorElement | null;
        if (issue && !(e.metaKey || e.ctrlKey || e.shiftKey)) {
          e.preventDefault();
          e.stopPropagation();
          const url = new URL(issue.href, window.location.origin);
          router.push(url.pathname.replace(/^\/[a-z]{2}(?=\/app\/)/, ''));
        }
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

const ACTIONS: Array<{ action: MarkdownAction; icon: 'bold' | 'italic' | 'code' | 'list' | 'link'; keys?: string }> = [
  { action: 'bold', icon: 'bold', keys: 'Meta+B' },
  { action: 'italic', icon: 'italic', keys: 'Meta+I' },
  { action: 'code', icon: 'code', keys: 'Meta+E' },
  { action: 'list', icon: 'list' },
  { action: 'link', icon: 'link', keys: 'Meta+K' },
];

const SLASH: Array<{ cmd: SlashCommand; keywords: string }> = [
  { cmd: 'h1', keywords: 'heading title titulo h1' },
  { cmd: 'h2', keywords: 'heading subtitle subtitulo h2' },
  { cmd: 'h3', keywords: 'heading h3' },
  { cmd: 'bullet', keywords: 'bullet list lista' },
  { cmd: 'numbered', keywords: 'numbered ordered numerada' },
  { cmd: 'todo', keywords: 'todo checklist task tarea tareas check' },
  { cmd: 'code', keywords: 'code codigo código snippet' },
  { cmd: 'quote', keywords: 'quote cita citação' },
  { cmd: 'divider', keywords: 'divider separador line hr' },
  { cmd: 'table', keywords: 'table tabla tabela' },
];

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

interface Option {
  key: string;
  label: string;
  meta?: string;
  swatch?: string;
  apply: () => void;
}

interface MarkdownEditorProps {
  value: string;
  onValueChange: (value: string) => void;
  labels: MarkdownLabels;
  /** Ref del textarea (para el foco y el cursor desde afuera). */
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  textareaProps?: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
    [data: `data-${string}`]: string | undefined;
  };
  /** El foco salió del editor entero (no al pasar a la barra o a la vista previa). */
  onBlurOutside?: () => void;
  /** Personas para "@" (además de issues). */
  members?: MentionMember[];
  /** Pegar o soltar archivos (imágenes): los sube y deja el markdown. */
  onUpload?: (file: File) => Promise<UploadResult | null>;
  /** Contenido extra dentro del área de escritura. */
  children?: React.ReactNode;
  className?: string;
}

/**
 * Editor de Markdown con los atajos del editor de Linear: listas y tareas que
 * siguen con Enter, Tab para anidar, "/" para insertar bloques, "@" para
 * personas e issues, "#" para issues, ⌘B ⌘I ⌘E ⌘K, y pegar o soltar imágenes.
 * Pestañas Escribir / Vista previa con el mismo render seguro que la lectura.
 */
export default function MarkdownEditor({
  value,
  onValueChange,
  labels,
  textareaRef,
  textareaProps = {},
  onBlurOutside,
  members = [],
  onUpload,
  children,
  className = '',
}: MarkdownEditorProps) {
  const te = useTranslations('track.ux.editor');
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const ref = (textareaRef ?? ownRef) as RefObject<HTMLTextAreaElement | null>;
  const rootRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const [trigger, setTrigger] = useState<EditorTrigger | null>(null);
  const [active, setActive] = useState(0);
  const [issueHits, setIssueHits] = useState<RefInfo[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const menuId = `mdm-${useId().replace(/:/g, '')}`;

  // El cursor se fija apenas React escribe el valor nuevo (antes de la
  // próxima tecla): con un requestAnimationFrame, quien tipea rápido perdía
  // el lugar después de un atajo (lista, tarea, comando "/").
  const pendingCursor = useRef<[number, number] | null>(null);
  useLayoutEffect(() => {
    const sel = pendingCursor.current;
    const t = ref.current;
    if (sel === null || !t || t.value !== value) return;
    pendingCursor.current = null;
    if (document.activeElement !== t) t.focus();
    t.setSelectionRange(sel[0], sel[1]);
  }, [value, ref]);

  function commit(next: string, cursor: number) {
    if (next === valueRef.current) {
      ref.current?.setSelectionRange(cursor, cursor);
      return;
    }
    pendingCursor.current = [cursor, cursor];
    onValueChange(next);
  }

  function run(action: MarkdownAction) {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = applyMarkdownAction(value, start, end, action, labels.placeholderText);
    pendingCursor.current = [next.selectionStart, next.selectionEnd];
    onValueChange(next.value);
    if (next.value === value) {
      pendingCursor.current = null;
      el?.focus();
      el?.setSelectionRange(next.selectionStart, next.selectionEnd);
    }
  }

  // Issues para "@" y "#": se buscan en el servidor mientras se tipea.
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
    }, 150);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [issueQuery]);

  const options: Option[] = useMemo(() => {
    if (!trigger) return [];
    const cursor = trigger.start + 1 + trigger.query.length;
    const q = trigger.query.toLowerCase();
    const complete = (text: string) => () => {
      const r = insertCompletion(valueRef.current, trigger.start, cursor, text);
      setTrigger(null);
      commit(r.value, r.cursor);
    };
    if (trigger.kind === 'slash') {
      return SLASH.filter((s) => !q || te(`slash.${s.cmd}`).toLowerCase().includes(q) || s.keywords.includes(q)).map((s) => ({
        key: s.cmd,
        label: te(`slash.${s.cmd}`),
        apply: () => {
          const r = applySlashCommand(valueRef.current, trigger.start, cursor, s.cmd);
          setTrigger(null);
          commit(r.value, r.cursor);
        },
      }));
    }
    const people: Option[] =
      trigger.kind === 'mention'
        ? members
            .filter((m) => !q || m.email.toLowerCase().includes(q) || (m.name ?? '').toLowerCase().includes(q))
            .slice(0, 6)
            .map((m) => ({ key: `u:${m.id}`, label: m.name ?? m.email, meta: m.email, apply: complete(`@${m.email}`) }))
        : [];
    const issues: Option[] = issueHits.map((i) => ({
      key: `i:${i.id}`,
      label: `${i.identifier} ${i.title}`,
      swatch: i.status_color ? safeHexColor(i.status_color, '#767676') : undefined,
      meta: i.status_name ?? undefined,
      apply: complete(i.identifier),
    }));
    return [...people, ...issues];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger, members, issueHits, te]);

  useEffect(() => {
    if (active >= options.length) setActive(0);
  }, [options.length, active]);

  function refreshTrigger(el: HTMLTextAreaElement) {
    const t = detectTrigger(el.value, el.selectionStart ?? el.value.length);
    setTrigger((prev) => {
      if (!t) return null;
      if (!prev || prev.kind !== t.kind || prev.start !== t.start) setActive(0);
      return t;
    });
  }

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const el = e.target;
    const cursor = el.selectionStart ?? el.value.length;
    // `[] ` al principio de la línea → tarea.
    if (el.value[cursor - 1] === ' ') {
      const r = autoTask(el.value, cursor);
      if (r) {
        commit(r.value, r.cursor);
        setTrigger(null);
        return;
      }
    }
    onValueChange(el.value);
    refreshTrigger(el);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
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
    textareaProps.onKeyDown?.(e);
    if (e.defaultPrevented) return;
    const el = e.currentTarget;
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Enter' && !mod && !e.shiftKey && !e.altKey && el.selectionStart === el.selectionEnd) {
      const r = continueList(el.value, el.selectionStart);
      if (r) {
        e.preventDefault();
        commit(r.value, r.cursor);
      }
      return;
    }
    if (e.key === 'Tab' && !mod && !e.altKey && el.selectionStart === el.selectionEnd) {
      const r = indentListItem(el.value, el.selectionStart, e.shiftKey);
      if (r) {
        e.preventDefault();
        commit(r.value, r.cursor);
      }
      return;
    }
    if (!mod || e.altKey) return;
    const key = e.key.toLowerCase();
    if (!e.shiftKey && (key === 'b' || key === 'i' || key === 'e')) {
      e.preventDefault();
      run(key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'code');
    } else if (!e.shiftKey && key === 'k' && el.selectionStart !== el.selectionEnd) {
      // Con texto elegido ⌘K hace un link (sin abrir la paleta), como en Linear.
      e.preventDefault();
      e.stopPropagation();
      run('link');
    } else if (e.shiftKey && (key === 'x' || e.code === 'KeyX')) {
      e.preventDefault();
      run('strike');
    } else if (e.shiftKey && (e.code === 'Digit7' || e.code === 'Digit8' || e.code === 'Digit9')) {
      // ⌘⇧7 numerada… acá: ⌘⇧8 lista, ⌘⇧9 tareas (⌘⇧7 queda para el navegador).
      e.preventDefault();
      run(e.code === 'Digit9' ? 'todo' : 'list');
    }
  }

  async function uploadFiles(files: File[]) {
    if (!onUpload || files.length === 0) return;
    setUploadError(null);
    for (const file of files) {
      const el = ref.current;
      const cur = valueRef.current;
      const at = el?.selectionStart ?? cur.length;
      const placeholder = `![${te('uploading', { name: file.name })}]()`;
      const sep = at > 0 && cur[at - 1] !== '\n' ? '\n' : '';
      const next = cur.slice(0, at) + sep + placeholder + '\n' + cur.slice(at);
      onValueChange(next);
      valueRef.current = next;
      const result = await onUpload(file).catch(() => null);
      const latest = valueRef.current;
      if (!result) {
        onValueChange(latest.replace(`${placeholder}\n`, '').replace(placeholder, ''));
        setUploadError(te('uploadError', { name: file.name }));
        continue;
      }
      const md = result.image ? `![${result.filename}](${result.url})` : `[${result.filename}](${result.url})`;
      const replaced = latest.includes(placeholder) ? latest.replace(placeholder, md) : `${latest}\n${md}`;
      onValueChange(replaced);
      valueRef.current = replaced;
    }
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (!onUpload || files.length === 0) return;
    e.preventDefault();
    void uploadFiles(files);
  }

  function onDrop(e: DragEvent<HTMLTextAreaElement>) {
    setDragOver(false);
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (!onUpload || files.length === 0) return;
    e.preventDefault();
    void uploadFiles(files);
  }

  // El foco nunca queda en la nada al cambiar de pestaña: así "salir del
  // editor" (onBlurOutside) se detecta igual en escritura y en vista previa.
  function switchMode(next: 'write' | 'preview') {
    setMode(next);
    setTrigger(null);
    window.requestAnimationFrame(() => (next === 'write' ? ref.current : panelRef.current)?.focus());
  }

  const tabId = `md-${useId().replace(/:/g, '')}`;
  const panelRef = useRef<HTMLDivElement>(null);
  const menuOpen = mode === 'write' && trigger && options.length > 0;
  const toolLabel = (a: MarkdownAction) => (a in labels ? labels[a as keyof MarkdownLabels] : te(a));

  return (
    <div
      ref={rootRef}
      className={`track-md ${className}`.trim()}
      onBlur={(e) => {
        const next = e.relatedTarget as Node | null;
        if (next && rootRef.current?.contains(next)) return;
        setTrigger(null);
        onBlurOutside?.();
      }}
    >
      <div className="track-md-bar">
        <div className="ui-tabs track-md-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            id={`${tabId}-write`}
            aria-selected={mode === 'write'}
            aria-controls={`${tabId}-panel`}
            className="ui-tab"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => switchMode('write')}
          >
            {labels.write}
          </button>
          <button
            type="button"
            role="tab"
            id={`${tabId}-preview`}
            aria-selected={mode === 'preview'}
            aria-controls={`${tabId}-panel`}
            className="ui-tab"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => switchMode('preview')}
            data-testid="track-md-preview-tab"
          >
            {labels.preview}
          </button>
        </div>
        {mode === 'write' && (
          <div className="track-md-tools" role="toolbar" aria-label={labels.toolbar}>
            {ACTIONS.map((a) => (
              <button
                key={a.action}
                type="button"
                className="btn btn-ghost btn-sm btn-icon"
                aria-label={toolLabel(a.action)}
                title={toolLabel(a.action)}
                aria-keyshortcuts={a.keys}
                // Sin robar el foco: la selección del textarea se mantiene.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => run(a.action)}
              >
                <TrackIcon name={a.icon} size={14} />
              </button>
            ))}
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-icon"
              aria-label={te('todo')}
              title={te('todo')}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => run('todo')}
              data-testid="track-md-todo"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="2" y="2.5" width="5" height="5" rx="1" />
                <path d="M3.2 5l1 1 1.7-1.9M9.5 5H14M2 11h5M9.5 11H14" />
              </svg>
            </button>
          </div>
        )}
      </div>
      <div
        ref={panelRef}
        id={`${tabId}-panel`}
        role="tabpanel"
        aria-labelledby={`${tabId}-${mode}`}
        className="track-md-panel"
        tabIndex={mode === 'preview' ? -1 : undefined}
      >
        {mode === 'write' ? (
          <div className={`track-md-write${dragOver ? ' is-drop' : ''}`}>
            <textarea
              {...textareaProps}
              ref={ref as RefObject<HTMLTextAreaElement>}
              className={textareaProps.className ?? 'textarea'}
              value={value}
              onChange={onChange}
              onKeyDown={onKeyDown}
              onKeyUp={(e) => {
                if (e.key.startsWith('Arrow') && !menuOpen) refreshTrigger(e.currentTarget);
              }}
              onClick={(e) => refreshTrigger(e.currentTarget)}
              onPaste={onPaste}
              onDragOver={(e) => {
                if (onUpload && e.dataTransfer?.types.includes('Files')) {
                  e.preventDefault();
                  setDragOver(true);
                }
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              aria-autocomplete="list"
              aria-controls={menuOpen ? menuId : undefined}
              aria-activedescendant={menuOpen ? `${menuId}-${active}` : undefined}
            />
            {menuOpen && (
              <div className="track-md-menu" id={menuId} role="listbox" aria-label={te(`menu.${trigger.kind}`)} data-testid="track-md-menu">
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
                    {o.swatch && <span className="cmdk-swatch" style={{ background: o.swatch }} aria-hidden />}
                    <span className="track-md-menu-label">{o.label}</span>
                    {o.meta && <span className="track-md-menu-meta">{o.meta}</span>}
                  </button>
                ))}
              </div>
            )}
            {children}
          </div>
        ) : value.trim() ? (
          <MarkdownView source={value} className="track-md-preview" />
        ) : (
          <p className="track-md-preview is-empty">{labels.emptyPreview}</p>
        )}
      </div>
      {uploadError && (
        <p className="ui-error track-md-error" role="alert">
          {uploadError}
        </p>
      )}
      {mode === 'write' && <p className="track-md-hint">{te('hint')}</p>}
    </div>
  );
}
