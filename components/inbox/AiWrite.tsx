'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

/** Marca de error al final de un stream (igual que STREAM_ERROR_MARK en lib/inbox/ai.ts). */
const ERROR_MARK = '\u0000error:';

export type AiAsk =
  | { action: 'draft'; threadId: string; instruction?: string }
  | { action: 'rewrite'; text: string; mode: 'shorter' | 'friendlier' | 'formal' | 'fix' | 'custom'; instruction?: string; threadId?: string };

/**
 * Pide texto a la IA de Inbox y lo va pasando a `onText` (el texto entero
 * hasta ahora) a medida que llega. Nunca lanza: devuelve el texto final o el
 * código de error.
 */
export async function streamAi(ask: AiAsk, onText: (full: string) => void, signal?: AbortSignal): Promise<{ ok: true; text: string } | { ok: false; code: string }> {
  let res: Response;
  try {
    res = await fetch('/api/inbox/ai', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...ask, stream: true }), signal });
  } catch {
    return { ok: false, code: signal?.aborted ? 'aborted' : 'network' };
  }
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, code: data.error ?? (res.status === 429 ? 'rate_limited' : 'ai_failed') };
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let full = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      full += dec.decode(value, { stream: true });
      const at = full.indexOf(ERROR_MARK);
      if (at >= 0) return { ok: false, code: full.slice(at + ERROR_MARK.length).trim() || 'ai_failed' };
      onText(full.trimStart());
    }
  } catch {
    return { ok: false, code: signal?.aborted ? 'aborted' : 'network' };
  }
  return { ok: true, text: full.trim() };
}

type Refine = 'shorter' | 'formal' | 'friendlier';
const REFINES: Refine[] = ['shorter', 'formal', 'friendlier'];

/**
 * "¿Qué querés decir?": la persona escribe una instrucción, la IA arma el
 * mensaje con su tono (aprendido de lo que escribe en ese chat), se puede
 * refinar ("más corto", "más formal" o un cambio propio) y se inserta en el
 * campo. Enter genera, ⌘Enter inserta, Esc cierra.
 */
export default function AiWrite({ threadId, onInsert, onClose }: { threadId: string; onInsert: (text: string) => void; onClose: () => void }) {
  const t = useTranslations('inbox.ai');
  const te = useTranslations('inbox.errors');
  const [instruction, setInstruction] = useState('');
  const [draft, setDraft] = useState('');
  const [prev, setPrev] = useState<string | null>(null);
  const [refine, setRefine] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [state, setState] = useState<'ready' | 'not_configured' | 'disabled' | ''>('');
  const ask = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    ask.current?.focus();
    let live = true;
    void fetch('/api/inbox/ai')
      .then((r) => r.json())
      .then((d: { state?: 'ready' | 'not_configured' | 'disabled' }) => live && setState(d.state ?? 'ready'))
      .catch(() => live && setState('ready'));
    return () => {
      live = false;
      abort.current?.abort();
    };
  }, []);

  const errText = (code: string) => (code === 'ai_not_configured' ? t('notConfigured') : te.has(code) ? te(code) : te('ai_failed'));

  const run = useCallback(
    async (req: AiAsk) => {
      if (busy) return;
      abort.current?.abort();
      const ctl = new AbortController();
      abort.current = ctl;
      setBusy(true);
      setError('');
      const before = draft;
      const r = await streamAi(req, setDraft, ctl.signal);
      if (ctl.signal.aborted) return;
      setBusy(false);
      if (!r.ok) {
        setDraft(before);
        setError(errText(r.code));
        return;
      }
      setPrev(before || null);
      setDraft(r.text);
    },
    [busy, draft], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const generate = () => {
    if (!instruction.trim()) return;
    void run({ action: 'draft', threadId, instruction: instruction.trim() });
  };
  const refineWith = (mode: Refine | 'custom', extra = '') => {
    if (!draft.trim()) return;
    void run({ action: 'rewrite', threadId, text: draft, mode, instruction: extra || undefined });
    if (mode === 'custom') setRefine('');
  };
  const insert = () => {
    if (!draft.trim() || busy) return;
    onInsert(draft.trim());
  };

  const blocked = state === 'not_configured' || state === 'disabled';

  return (
    <section
      className="ib-ai"
      aria-label={t('title')}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && draft.trim()) {
          e.preventDefault();
          insert();
        }
      }}
    >
      <div className="ib-ai-head">
        <label className="ib-ai-label" htmlFor={`ib-ai-ask-${threadId}`}>
          {t('ask')}
        </label>
        <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={t('close')} onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <div className="ib-ai-row">
        <input
          id={`ib-ai-ask-${threadId}`}
          ref={ask}
          className="input"
          value={instruction}
          maxLength={2000}
          placeholder={t('askPlaceholder')}
          disabled={blocked}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              generate();
            }
          }}
        />
        <button type="button" className="btn btn-primary btn-sm" disabled={blocked || busy || !instruction.trim()} onClick={generate}>
          {busy && !draft ? t('writing') : draft ? t('again') : t('write')}
        </button>
      </div>
      {blocked && (
        <p className="ib-error" role="alert">
          {state === 'disabled' ? te('ai_disabled') : t('notConfigured')}
        </p>
      )}
      {error && (
        <p className="ib-error" role="alert">
          {error}
        </p>
      )}
      {(draft || busy) && (
        <>
          <div className="ib-ai-draft" aria-live="polite" aria-busy={busy || undefined} data-testid="inbox-ai-draft">
            {draft || <span className="ib-dim">{t('writing')}</span>}
          </div>
          <div className="ib-ai-tools">
            {REFINES.map((m) => (
              <button key={m} type="button" className="btn btn-ghost btn-sm" disabled={busy || !draft.trim()} onClick={() => refineWith(m)}>
                {t(`refine.${m}`)}
              </button>
            ))}
            <input
              className="input ib-ai-refine"
              aria-label={t('refineLabel')}
              placeholder={t('refinePlaceholder')}
              value={refine}
              maxLength={1000}
              disabled={busy || !draft.trim()}
              onChange={(e) => setRefine(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && refine.trim()) {
                  e.preventDefault();
                  refineWith('custom', refine.trim());
                }
              }}
            />
          </div>
          <div className="ib-ai-actions">
            {prev !== null && !busy && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setDraft(prev);
                  setPrev(null);
                }}
              >
                {t('previous')}
              </button>
            )}
            <button type="button" className="btn btn-primary btn-sm" disabled={busy || !draft.trim()} onClick={insert} title={t('insertHint')}>
              {t('insert')}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
