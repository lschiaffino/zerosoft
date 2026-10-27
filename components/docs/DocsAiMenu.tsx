'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { markdownToBlocks } from '@/lib/docs-import';
import { sanitizeHtml as sanitizeRichHtml } from '@/lib/docs-richtext';
import type { DocsBlock } from '@/lib/docs-types';
import DocsBlocksView from './DocsBlocksView';
import DocsGlyph from './DocsGlyphs';

type Action =
  | 'continue'
  | 'summarize'
  | 'improve'
  | 'fix'
  | 'shorter'
  | 'longer'
  | 'simplify'
  | 'tone'
  | 'translate'
  | 'explain'
  | 'action_items'
  | 'brainstorm'
  | 'custom';

const TONES = ['professional', 'casual', 'friendly', 'confident', 'direct'] as const;
const LANGUAGES = ['en', 'es', 'pt', 'fr', 'de', 'it', 'ja', 'zh'] as const;

const SELECTION_ACTIONS: Action[] = ['improve', 'fix', 'shorter', 'longer', 'simplify', 'tone', 'translate', 'explain', 'summarize', 'continue'];
const LINE_ACTIONS: Action[] = ['continue', 'summarize', 'action_items', 'brainstorm', 'translate', 'explain'];

interface Request {
  action: Action;
  tone?: string;
  language?: string;
  prompt?: string;
}

export interface DocsAiMenuProps {
  pageId: string;
  /** Ruta que responde (Notes usa /api/notes/ai). */
  endpoint?: string;
  pageTitle: string;
  /** Texto de la página como está en el editor. */
  pageText: () => string;
  /** Texto seleccionado (null: línea vacía, trabaja sobre la página). */
  selection: string | null;
  /** Texto antes del cursor (continuar escribiendo). */
  before?: string;
  anchor: { top: number; left: number };
  onReplace?: (blocks: DocsBlock[], markdown: string) => void;
  onInsert: (blocks: DocsBlock[]) => void;
  /** `outside`: clic afuera (no devuelve el cursor a la línea). */
  onClose: (reason?: 'outside') => void;
}

/**
 * "Ask AI" del editor (como Notion AI): sobre la selección (mejorar,
 * corregir, acortar, alargar, simplificar, cambiar el tono, traducir,
 * explicar, resumir) o en una línea vacía (continuar, resumir la página,
 * sacar tareas, ideas, traducir), o lo que se escriba en el campo. El
 * resultado se ve primero y se reemplaza, se inserta debajo, se vuelve a
 * intentar o se descarta: nada toca la página hasta aceptar.
 */
export default function DocsAiMenu({ pageId, endpoint = '/api/docs/ai', pageTitle, pageText, selection, before, anchor, onReplace, onInsert, onClose }: DocsAiMenuProps) {
  const t = useTranslations('docs.ai');
  const [prompt, setPrompt] = useState('');
  const [view, setView] = useState<'menu' | 'tone' | 'translate' | 'loading' | 'result' | 'error'>('menu');
  const [active, setActive] = useState(-1);
  const [markdown, setMarkdown] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<Request | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const hasSelection = Boolean(selection?.trim());

  const base = hasSelection ? SELECTION_ACTIONS : LINE_ACTIONS;
  const items = useMemo(() => {
    if (view === 'tone') return TONES.map((v) => ({ key: `tone:${v}`, label: t(`tones.${v}`) }));
    if (view === 'translate') return LANGUAGES.map((v) => ({ key: `lang:${v}`, label: t(`languages.${v}`) }));
    const q = prompt.trim().toLowerCase();
    return base
      .map((a) => ({ key: a, label: t(`actions.${a}`) }))
      .filter((i) => !q || i.label.toLowerCase().includes(q));
  }, [view, base, prompt, t]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [view]);
  useEffect(() => () => abortRef.current?.abort(), []);
  // Clic afuera: cierra (salvo con un resultado, que se descarta solo a propósito).
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node) && view !== 'result' && view !== 'loading') onClose('outside');
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose, view]);

  const run = async (req: Request) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLast(req);
    setView('loading');
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          pageId,
          pageTitle,
          pageText: pageText().slice(0, 60_000),
          selection: hasSelection ? selection : undefined,
          before: before?.slice(-20_000),
          ...req,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { markdown?: string; error?: string };
      if (!res.ok || !data.markdown) {
        setError(data.error ?? 'ai_error');
        setView('error');
        return;
      }
      setMarkdown(data.markdown);
      setView('result');
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError('network');
      setView('error');
    }
  };

  const pick = (key: string) => {
    if (key === 'tone' || key === 'translate') {
      setView(key);
      setActive(0);
      return;
    }
    if (key.startsWith('tone:')) return void run({ action: 'tone', tone: key.slice(5), prompt: prompt.trim() || undefined });
    if (key.startsWith('lang:')) return void run({ action: 'translate', language: key.slice(5) });
    void run({ action: key as Action, prompt: key === 'brainstorm' ? prompt.trim() || undefined : undefined });
  };

  const blocks = useMemo(
    () => (markdown ? markdownToBlocks(markdown, { sanitize: sanitizeRichHtml }).map((b) => ({ ...b, id: crypto.randomUUID() })) : []),
    [markdown],
  );

  const accept = (mode: 'replace' | 'insert') => {
    if (!blocks.length) return;
    if (mode === 'replace' && onReplace) onReplace(blocks, markdown);
    else onInsert(blocks);
    onClose();
  };

  const onKey = (e: React.KeyboardEvent) => {
    // El menú vive (por portal) dentro del árbol del editor: sus teclas no llegan a los atajos del editor.
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (view === 'tone' || view === 'translate') setView('menu');
      else if (view === 'loading') {
        abortRef.current?.abort();
        setView('menu');
      } else onClose();
      return;
    }
    if (view === 'result') {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        accept(hasSelection && onReplace ? 'replace' : 'insert');
      }
      return;
    }
    if (view === 'loading') return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i < 0 ? (dir > 0 ? 0 : items.length - 1) : (i + dir + items.length) % items.length));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (active >= 0 && items[active]) pick(items[active].key);
      else if (prompt.trim()) void run({ action: 'custom', prompt: prompt.trim() });
      else if (items.length) pick(items[0].key);
    }
  };

  const errorText = (code: string | null) => {
    switch (code) {
      case 'ai_disabled':
      case 'quota_exceeded':
      case 'rate_limited':
      case 'network':
        return t(`errors.${code}`);
      default:
        return t('errors.generic');
    }
  };

  const left = Math.max(16, Math.min(anchor.left, (typeof window !== 'undefined' ? window.innerWidth : 1024) - 16 - Math.min(560, (typeof window !== 'undefined' ? window.innerWidth : 1024) - 32)));

  return createPortal(
    <div
      ref={boxRef}
      className="docs-ai-menu"
      role="dialog"
      aria-label={t('title')}
      data-testid="docs-ai-menu"
      style={{ top: anchor.top, left }}
      onKeyDown={onKey}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {(view === 'result' || view === 'loading' || view === 'error') && (
        <div className="docs-ai-result" aria-live="polite">
          {view === 'loading' && (
            <p className="docs-ai-status" role="status">
              <DocsGlyph name="sparkle" size={14} />
              {t('writing')}
            </p>
          )}
          {view === 'error' && (
            <p className="ui-error" role="alert" data-testid="docs-ai-error">
              {errorText(error)}
            </p>
          )}
          {view === 'result' && (
            <div className="docs-ai-preview" data-testid="docs-ai-preview">
              <DocsBlocksView blocks={blocks} boards={false} />
            </div>
          )}
        </div>
      )}
      <div className="docs-ai-input-row">
        <DocsGlyph name="sparkle" size={16} />
        <input
          ref={inputRef}
          className="docs-ai-input"
          value={prompt}
          placeholder={view === 'result' ? t('followUp') : hasSelection ? t('placeholderSelection') : t('placeholder')}
          aria-label={t('title')}
          disabled={view === 'loading'}
          onChange={(e) => {
            setPrompt(e.target.value);
            setActive(-1);
            if (view === 'error') setView('menu');
          }}
          onKeyDown={(e) => {
            // Con un resultado, escribir y Enter pide otra versión con esa instrucción.
            if (view === 'result' && e.key === 'Enter' && prompt.trim()) {
              e.preventDefault();
              e.stopPropagation();
              void run({ action: 'custom', prompt: `${prompt.trim()}\n\nCurrent draft:\n${markdown}` });
              setPrompt('');
            }
          }}
        />
        {view === 'loading' ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              abortRef.current?.abort();
              setView('menu');
            }}
          >
            {t('stop')}
          </button>
        ) : (
          prompt.trim() &&
          view !== 'result' && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void run({ action: 'custom', prompt: prompt.trim() })}>
              {t('ask')}
            </button>
          )
        )}
      </div>
      {view === 'result' && (
        <div className="docs-ai-actions" role="group" aria-label={t('resultActions')}>
          {hasSelection && onReplace && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => accept('replace')} data-testid="docs-ai-replace">
              {t('replace')}
            </button>
          )}
          <button
            type="button"
            className={`btn btn-sm ${hasSelection && onReplace ? 'btn-secondary' : 'btn-primary'}`}
            onClick={() => accept('insert')}
            data-testid="docs-ai-insert"
          >
            {t('insertBelow')}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => last && void run(last)}>
            {t('tryAgain')}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onClose()} data-testid="docs-ai-discard">
            {t('discard')}
          </button>
        </div>
      )}
      {(view === 'menu' || view === 'tone' || view === 'translate' || view === 'error') && (
        <div className="docs-ai-list" role="listbox" aria-label={t('suggestions')}>
          {(view === 'tone' || view === 'translate') && (
            <button type="button" className="docs-menu-item docs-ai-back" onClick={() => setView('menu')}>
              ‹ {t(view === 'tone' ? 'actions.tone' : 'actions.translate')}
            </button>
          )}
          {view !== 'tone' && view !== 'translate' && <p className="docs-ai-group">{hasSelection ? t('groupEdit') : t('groupWrite')}</p>}
          {items.map((i, n) => (
            <button
              key={i.key}
              type="button"
              role="option"
              aria-selected={n === active}
              className={`docs-menu-item${n === active ? ' sel' : ''}`}
              onMouseEnter={() => setActive(n)}
              onClick={() => pick(i.key)}
            >
              <span>{i.label}</span>
              {(i.key === 'tone' || i.key === 'translate') && <span className="docs-ai-more" aria-hidden>›</span>}
            </button>
          ))}
          {items.length === 0 && <p className="docs-ai-empty">{t('askHint')}</p>}
        </div>
      )}
      <p className="docs-ai-note">{t('note')}</p>
    </div>,
    document.body,
  );
}
