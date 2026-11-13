'use client';

/**
 * Piezas de un mensaje del asistente, como en ChatGPT o Claude:
 * - Thinking: mientras espera al modelo, tres ceros que laten (quietos con
 *   movimiento reducido).
 * - Reasoning: el razonamiento del modelo plegado ("Pensó 4 segundos").
 * - ToolCard: cada herramienta en una línea con su estado (girando, ✓ o ✗)
 *   y una etiqueta corta; se abre con lo que pidió y lo que volvió.
 * - AssistantMarkdown: la respuesta en Markdown, escrita de a poco con un
 *   cursor, con copiar en los bloques de código.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { renderAssistantMarkdown } from '@/lib/assistant/markdown';
import type { ChatPart } from './client';

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

/** Esperando al modelo: "0 0 0" que laten de a uno. */
export function Thinking({ label }: { label: string }) {
  return (
    <p className="asst-thinking" role="status" data-testid="assistant-thinking">
      <span className="asst-zeros" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span className="asst-thinking-label">{label}</span>
    </p>
  );
}

/** Razonamiento plegado. Mientras piensa dice "Pensando" con la animación; después, cuánto tardó. */
export function Reasoning({ part }: { part: Extract<ChatPart, { type: 'reasoning' }> }) {
  const t = useTranslations('assistant');
  const live = part.ms === null;
  const seconds = Math.max(1, Math.round((part.ms ?? 0) / 1000));
  return (
    <details className="asst-reason" data-testid="assistant-reasoning" data-live={live ? '' : undefined}>
      <summary>
        {live ? (
          <>
            <span className="asst-zeros" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span>{t('reasoning.thinking')}</span>
          </>
        ) : (
          <span>{t('reasoning.thought', { seconds })}</span>
        )}
      </summary>
      <div className="asst-reason-body">{part.text}</div>
    </details>
  );
}

type ToolPart = Extract<ChatPart, { type: 'tool' }>;

/** Etiqueta corta de una herramienta según su estado. */
function useToolLabel() {
  const t = useTranslations('assistant');
  return useCallback(
    (part: ToolPart, state: 'running' | 'ok' | 'failed'): string => {
      const out = (part.output ?? {}) as { summary?: unknown; error?: unknown };
      const summary = typeof out.summary === 'string' ? out.summary : '';
      if (part.tool === 'propose_folders_from_json') {
        if (state === 'running') return t('toolLabel.foldersRunning');
        if (out.error === 'nothing_to_do') return t('toolLabel.foldersNothing');
        return state === 'ok' ? t('toolLabel.foldersOk', { summary }) : t('toolLabel.foldersFailed');
      }
      if (part.tool.startsWith('propose_')) {
        if (state === 'running') return t('toolLabel.proposeRunning');
        return state === 'ok' && summary ? t('toolLabel.proposeOk', { summary }) : t('toolLabel.proposeFailed');
      }
      const key = `toolLabel.names.${part.tool}`;
      const tool = t.has(key) ? t(key) : part.tool.replace(/_/g, ' ');
      return t(`toolLabel.${state}`, { tool });
    },
    [t],
  );
}

/** Una herramienta: estado y etiqueta en una línea; se abre con el pedido y el resultado. */
export function ToolCard({ part }: { part: ToolPart }) {
  const t = useTranslations('assistant');
  const label = useToolLabel();
  const out = (part.output ?? {}) as { error?: unknown };
  // "Ya estaba todo" no es una falla.
  const ok = Boolean(part.ok) || out.error === 'nothing_to_do';
  const state = part.running ? 'running' : ok ? 'ok' : 'failed';
  const status = part.running ? t('tool.running') : ok ? t('tool.ok') : t('tool.failed');
  return (
    <details className="asst-tool" data-testid="assistant-tool-card" data-tool={part.tool} data-state={state}>
      <summary>
        <span className="asst-tool-icon" data-state={state} aria-hidden="true">
          {state === 'ok' ? '✓' : state === 'failed' ? '✗' : null}
        </span>
        <span className="asst-tool-text">{label(part, state)}</span>
        <span className="sr-only">{status}</span>
      </summary>
      <div className="asst-tool-body">
        <p className="asst-tool-label">
          {t('tool.input')} <code className="asst-tool-name">{part.tool}</code>
        </p>
        <pre>{short(part.input)}</pre>
        {!part.running && (
          <>
            <p className="asst-tool-label">{t('tool.output')}</p>
            <pre>{short(part.output)}</pre>
          </>
        )}
      </div>
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
  const html = useMemo(() => renderAssistantMarkdown(shown, { cursor: writing, copy: t('code.copy') }), [shown, writing, t]);
  const onClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = e.target as HTMLElement;
      const copy = el.closest<HTMLButtonElement>('[data-copy-code]');
      if (copy) {
        const code = copy.closest('.asst-code')?.querySelector('code')?.textContent ?? '';
        const done = (ok: boolean) => {
          copy.textContent = ok ? t('code.copied') : t('code.copyFailed');
          window.setTimeout(() => {
            copy.textContent = t('code.copy');
          }, 1500);
        };
        void navigator.clipboard?.writeText(code).then(
          () => done(true),
          () => done(false),
        );
        return;
      }
      // Links de la app: se navega dentro (con el idioma), sin recargar.
      const a = el.closest<HTMLAnchorElement>('a[href^="/"]');
      if (a && !a.target && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
        e.preventDefault();
        router.push(a.getAttribute('href')!);
      }
    },
    [router, t],
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
