'use client';

/**
 * Piezas de un mensaje del asistente, como en Claude, ChatGPT o Gemini:
 * - Activity: todo lo que hizo el modelo en el turno (razonamiento y
 *   herramientas) en UN bloque. Mientras trabaja, una línea con un verbo que
 *   brilla y va cambiando ("Ordenando…", "Revisando…") y debajo una caja de
 *   alto fijo con los pasos en lenguaje común ("Buscando cómo hacerlo…",
 *   "Preparó: crear 23 carpetas…"), que no hace crecer la charla. Al
 *   terminar se pliega en "Hizo 9 pasos" y se abre con el detalle de cada
 *   uno. Nunca muestra el nombre técnico de una herramienta.
 * - AssistantMarkdown: la respuesta en Markdown, escrita de a poco con un
 *   cursor, con copiar en los bloques de código.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { renderAssistantMarkdown } from '@/lib/assistant/markdown';
import { PRODUCT_CONFIG } from '@/lib/products';
import type { ChatPart } from './client';
import { useRevealLabel } from './Rows';
import { useHoldScroll } from './useFollow';

function short(value: unknown): string {
  try {
    const s = JSON.stringify(value, null, 2) ?? '';
    return s.length > 4000 ? `${s.slice(0, 4000)}\n…` : s;
  } catch {
    return String(value);
  }
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

type ToolPart = Extract<ChatPart, { type: 'tool' }>;
type ReasoningPart = Extract<ChatPart, { type: 'reasoning' }>;
export type StepPart = ToolPart | ReasoningPart;
type StepState = 'running' | 'ok' | 'failed';

const APP_LABEL: Record<string, string> = {
  ...Object.fromEntries(Object.entries(PRODUCT_CONFIG).map(([k, v]) => [k, v.name])),
  inbox: 'Inbox',
  hiring: 'Hiring',
  people: 'People',
  books: 'Books',
  shop: 'Shop',
  sign: 'Sign',
  send: 'Send',
  forms: 'Forms',
  analytics: 'Analytics',
  social: 'Social',
  talk: 'Talk',
  robot: 'Robots',
};

/** "v1.groups.chats.messages.create" → "Lines › chats › messages". */
function humanOperation(id: unknown): string {
  const segs = String(id ?? '')
    .split('.')
    .filter((s) => s && !/^v\d+$/.test(s));
  if (!segs.length) return '';
  const [app, ...rest] = segs;
  const words = rest.length > 1 ? rest.slice(0, -1) : rest;
  return [APP_LABEL[app] ?? app, ...words.map((w) => w.replace(/[_-]+/g, ' '))].join(' › ');
}

/** Estado de un paso ("ya estaba todo" no es una falla). */
function stepState(part: ToolPart): StepState {
  if (part.running) return 'running';
  const out = (part.output ?? {}) as { error?: unknown };
  return part.ok || out.error === 'nothing_to_do' ? 'ok' : 'failed';
}

/** Lo que hizo un paso, en lenguaje común (sin nombres de herramientas). */
function useStepLabel() {
  const t = useTranslations('assistant');
  return useCallback(
    (part: ToolPart, state: StepState): string => {
      const input = (part.input ?? {}) as Record<string, unknown>;
      const out = (part.output ?? {}) as { summary?: unknown; error?: unknown };
      const summary = typeof out.summary === 'string' ? out.summary : '';
      const failed = (label: string) => (state === 'failed' ? `${label}: ${t('step.failed')}` : label);
      if (part.tool === 'find_operations') return failed(t('step.find', { query: String(input.query ?? '').slice(0, 80) }));
      if (part.tool === 'get_operation') return failed(t('step.get', { op: humanOperation(input.operation) }));
      if (part.tool === 'run_operation') return failed(t('step.run', { op: humanOperation(input.operation) }));
      const chatApp = part.tool.startsWith('inbox_') ? 'Inbox' : part.tool.startsWith('lines_') ? 'Lines' : '';
      if (part.tool === 'inbox_attention' || part.tool === 'lines_attention') return failed(t('step.attention', { app: chatApp }));
      if (part.tool === 'inbox_read_chats' || part.tool === 'lines_read_chats') {
        if ((part.output as { status?: unknown } | undefined)?.status === 'awaiting_permission') return t('step.waitingPermission', { app: chatApp });
        return failed(t('step.readChats', { app: chatApp }));
      }
      if (part.tool === 'grant_chat_access') return t('step.waitingPermission', { app: String(input.app) === 'lines' ? 'Lines' : 'Inbox' });
      if (part.tool === 'propose_inbox_actions' && state === 'running') return t('step.inboxActions');
      if (part.tool === 'propose_folders_from_json') {
        if (state === 'running') return t('step.foldersRunning', { source: t('step.yourFile') });
        if (out.error === 'nothing_to_do') return t('step.foldersNothing');
        return state === 'ok' ? t('step.foldersOk', { summary }) : t('step.foldersFailed');
      }
      if (part.tool === 'request_feature' || part.tool === 'report_problem') {
        if (state === 'running') return t('step.recording');
        const title = String(input.title ?? '').slice(0, 120);
        return failed(t(part.tool === 'request_feature' ? 'step.featureRecorded' : 'step.problemReported', { title }));
      }
      if (part.tool.startsWith('propose_')) {
        if (state === 'running') return t('step.proposeRunning');
        return state === 'ok' && summary ? t('step.proposeOk', { summary }) : t('step.proposeFailed');
      }
      const key = `toolLabel.names.${part.tool}`;
      if (t.has(key)) return failed(t(state === 'running' ? 'step.running' : 'step.ok', { tool: t(key) }));
      const app = APP_LABEL[part.tool.split('_')[0]];
      return failed(app ? t('step.app', { app }) : t('step.workspace'));
    },
    [t],
  );
}

/** Un paso del bloque: ícono de estado y etiqueta; se abre con lo que pidió y lo que volvió. */
function ToolStep({ part }: { part: ToolPart }) {
  const t = useTranslations('assistant');
  const label = useStepLabel();
  const state = stepState(part);
  return (
    <li className="asst-step" data-testid="assistant-tool-card" data-tool={part.tool} data-state={state}>
      <details>
        <summary>
          <span className="asst-step-icon" data-state={state} aria-hidden="true">
            {state === 'ok' ? '✓' : state === 'failed' ? '✗' : null}
          </span>
          <span className="asst-step-text">{label(part, state)}</span>
          <span className="sr-only">{state === 'running' ? t('tool.running') : state === 'ok' ? t('tool.ok') : t('tool.failed')}</span>
        </summary>
        <div className="asst-step-body">
          <p className="asst-step-label">{t('tool.input')}</p>
          <pre>{short(part.input)}</pre>
          {!part.running && (
            <>
              <p className="asst-step-label">{t('tool.output')}</p>
              <pre>{short(part.output)}</pre>
            </>
          )}
        </div>
      </details>
    </li>
  );
}

/** El razonamiento como un paso: "Pensó 4 segundos", se abre con el texto. */
function ReasoningStep({ part }: { part: ReasoningPart }) {
  const t = useTranslations('assistant');
  const live = part.ms === null;
  const seconds = Math.max(1, Math.round((part.ms ?? 0) / 1000));
  return (
    <li className="asst-step is-reasoning" data-testid="assistant-reasoning" data-state={live ? 'running' : 'ok'}>
      <details>
        <summary>
          <span className="asst-step-icon" data-state={live ? 'running' : 'thought'} aria-hidden="true" />
          <span className="asst-step-text">{live ? t('activity.thinking') : t('activity.thought', { seconds })}</span>
        </summary>
        <div className="asst-step-body asst-step-reason">{part.text}</div>
      </details>
    </li>
  );
}

/** Verbo que va cambiando mientras trabaja ("Pensando", "Ordenando"…). */
function useRotatingVerb(live: boolean): string {
  const t = useTranslations('assistant');
  const verbs = useMemo(() => {
    const raw = t.raw('activity.verbs') as unknown;
    return Array.isArray(raw) && raw.length ? (raw as string[]) : [t('activity.thinking')];
  }, [t]);
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => setI((n) => (n + 1) % verbs.length), 2400);
    return () => window.clearInterval(timer);
  }, [live, verbs.length]);
  return verbs[i % verbs.length];
}

/**
 * Todo lo que hizo el modelo en un turno, en un bloque. `live`: está
 * trabajando (antes de la respuesta o entre herramientas).
 */
export function Activity({ parts, live }: { parts: StepPart[]; live: boolean }) {
  const t = useTranslations('assistant');
  const verb = useRotatingVerb(live);
  const feed = useRef<HTMLOListElement>(null);
  const tools = parts.filter((p): p is ToolPart => p.type === 'tool');
  const thoughtMs = parts.reduce((n, p) => (p.type === 'reasoning' ? n + (p.ms ?? 0) : n), 0);
  // La caja en vivo muestra siempre el último paso (sin mover la charla).
  useEffect(() => {
    const el = feed.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [parts, live]);
  const rows = parts.map((p) => (p.type === 'tool' ? <ToolStep key={p.callId} part={p} /> : <ReasoningStep key={p.key} part={p} />));
  if (live) {
    return (
      <div className="asst-activity is-live" data-testid="assistant-activity" data-state="live">
        <p className="asst-activity-head" role="status" data-testid="assistant-thinking">
          <span className="asst-shimmer" key={verb}>
            {verb}…
          </span>
        </p>
        {rows.length > 0 && (
          <ol className="asst-activity-feed" ref={feed} aria-label={t('activity.steps')}>
            {rows}
          </ol>
        )}
      </div>
    );
  }
  if (!rows.length) return null;
  const seconds = Math.max(1, Math.round(thoughtMs / 1000));
  const title = !tools.length ? t('activity.thought', { seconds }) : thoughtMs > 0 ? t('activity.thoughtAndDone', { seconds, count: tools.length }) : t('activity.done', { count: tools.length });
  const failedSteps = tools.filter((p) => stepState(p) === 'failed').length;
  return (
    <details className="asst-activity" data-testid="assistant-activity" data-state="done" data-failed={failedSteps || undefined}>
      <summary>
        <span className="asst-activity-title">{title}</span>
      </summary>
      <ol className="asst-activity-list" aria-label={t('activity.steps')}>
        {rows}
      </ol>
    </details>
  );
}

/**
 * Texto que llega de a pedazos, mostrado de a poco a un ritmo parejo (se pone
 * al día solo si viene mucho junto). Con movimiento reducido, o en un mensaje
 * viejo, se ve entero de una.
 */
function useSmoothText(target: string, streaming: boolean): string {
  const animate = useRef(streaming && !prefersReducedMotion());
  const [shown, setShown] = useState(animate.current ? '' : target);
  const len = useRef(shown.length);
  useEffect(() => {
    if (!animate.current) {
      len.current = target.length;
      setShown(target);
      return;
    }
    if (len.current > target.length) len.current = target.length;
    let raf = 0;
    const tick = () => {
      const remaining = target.length - len.current;
      if (remaining <= 0) return;
      let next = len.current + Math.max(1, Math.ceil(remaining / 10));
      // No partir un emoji ni una letra con tilde compuesta.
      const code = target.charCodeAt(next - 1);
      if (code >= 0xd800 && code <= 0xdbff) next += 1;
      len.current = Math.min(target.length, next);
      setShown(target.slice(0, len.current));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return shown;
}

/** Respuesta en Markdown (HTML seguro de lib/assistant/markdown.ts), con cursor mientras escribe. */
export function AssistantMarkdown({ text, streaming }: { text: string; streaming: boolean }) {
  const t = useTranslations('assistant');
  const router = useRouter();
  const shown = useSmoothText(text, streaming);
  const writing = streaming || shown.length < text.length;
  // Tablas y listas largas: cuántos renglones se ven de cada una ("Mostrar las 27" suma el resto en el lugar).
  const [rowsShown, setRowsShown] = useState<Record<string, number>>({});
  const revealLabel = useRevealLabel();
  const hold = useHoldScroll();
  const html = useMemo(
    () => renderAssistantMarkdown(shown, { cursor: writing, copy: t('code.copy'), rows: { shown: rowsShown, label: revealLabel } }),
    [shown, writing, t, rowsShown, revealLabel],
  );
  const onClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = e.target as HTMLElement;
      const more = el.closest<HTMLButtonElement>('[data-rows-more]');
      if (more) {
        hold();
        const key = more.dataset.rowsMore ?? '';
        const to = Number(more.dataset.to);
        const root = e.currentTarget;
        // La fila o el ítem que recibe el foco: el primero nuevo de esa tabla o lista.
        const target = () => root.querySelector<HTMLElement>(`[data-rows="${key}"]`);
        const from = target()?.children.length ?? 0;
        setRowsShown((prev) => ({ ...prev, [key]: to }));
        // El foco pasa al primer renglón nuevo (el HTML se vuelve a pintar), sin mover la charla.
        requestAnimationFrame(() => {
          const row = target()?.children[from] as HTMLElement | undefined;
          if (!row) return;
          row.tabIndex = -1;
          row.focus({ preventScroll: true });
        });
        return;
      }
      const copy = el.closest<HTMLButtonElement>('[data-copy-code]');
      if (copy) {
        const code = copy.closest('.asst-code')?.querySelector('code')?.textContent ?? '';
        const done = (ok: boolean) => {
          copy.textContent = ok ? t('code.copied') : t('code.copyFailed');
          window.setTimeout(() => {
            copy.textContent = t('code.copy');
          }, 1500);
        };
        // Sin portapapeles (http sin TLS, permisos): lo dice en vez de fallar callado.
        if (!navigator.clipboard?.writeText) done(false);
        else
          navigator.clipboard.writeText(code).then(
            () => done(true),
            () => done(false),
          );
        return;
      }
      // Links de la app: se navega dentro (con el idioma), sin recargar.
      const a = el.closest<HTMLAnchorElement>('a[href^="/"]');
      if (a && !a.target && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
        e.preventDefault();
        // El router pone el idioma: un link que ya lo trae (/es/app/…) va sin él.
        router.push(a.getAttribute('href')!.replace(/^\/(?:en|es|pt)(?=\/|$)/, '') || '/');
      }
    },
    [router, t, hold],
  );
  if (!html) return null;
  // eslint-disable-next-line react/no-danger -- HTML armado por renderAssistantMarkdown: sin HTML crudo, links filtrados.
  return <div className="asst-md" data-testid="assistant-markdown" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Mensaje largo de la persona (un JSON pegado): recortado, con "Ver todo". */
export function UserText({ text }: { text: string }) {
  const t = useTranslations('assistant');
  const long = text.length > 700 || text.split('\n').length > 14;
  const [open, setOpen] = useState(false);
  return (
    <>
      <p className={`asst-msg-text${long && !open ? ' is-clamped' : ''}`}>{text}</p>
      {long && (
        <button type="button" className="btn btn-ghost btn-sm asst-more" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? t('message.showLess') : t('message.showAll')}
        </button>
      )}
    </>
  );
}

/**
 * Aviso chico debajo de la respuesta cuando el asistente anotó un pedido o un
 * problema para el equipo (el paso queda plegado en la actividad).
 */
export function RequestNotes({ parts }: { parts: StepPart[] }) {
  const t = useTranslations('assistant');
  const done = parts.filter((p): p is ToolPart => p.type === 'tool' && !p.running && Boolean(p.ok) && (p.tool === 'request_feature' || p.tool === 'report_problem'));
  if (!done.length) return null;
  return (
    <>
      {done.map((p) => (
        <p key={p.callId} className="asst-notice muted" role="status" data-testid="assistant-request-recorded" data-kind={p.tool === 'request_feature' ? 'feature' : 'problem'}>
          {t(p.tool === 'request_feature' ? 'requestNote.feature' : 'requestNote.problem', { title: String((p.input as Record<string, unknown> | undefined)?.title ?? '').slice(0, 120) })}
        </p>
      ))}
    </>
  );
}
