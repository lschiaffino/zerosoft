'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { fillSnippet, type MessageDto, type SnippetDto, type ThreadDto } from '@/lib/inbox/types';
import { api } from './api';

export interface ComposerHandle {
  focus: () => void;
  draft: () => void;
  /** Vacía el campo y el borrador guardado (después de programar el envío). */
  clear: () => void;
}

type Rewrite = 'shorter' | 'friendlier' | 'formal' | 'fix';
const REWRITES: Rewrite[] = ['shorter', 'friendlier', 'formal', 'fix'];

/**
 * Campo de respuesta. WhatsApp: Enter manda y Shift+Enter baja de línea (como
 * WhatsApp Web); correo: ⌘Enter manda. ";" abre los snippets, ⌘J pide un
 * borrador a la IA (con lo escrito como instrucción), el micrófono dicta con
 * Voice y "Más tarde" programa el envío. El borrador se guarda solo.
 */
const Composer = forwardRef<
  ComposerHandle,
  {
    thread: ThreadDto;
    snippets: SnippetDto[];
    disabled: boolean;
    onSent: (messages: MessageDto[]) => void;
    onSendLater: (text: string) => void;
    onError: (code: string) => void;
  }
>(function Composer({ thread, snippets, disabled, onSent, onError, onSendLater }, ref) {
  const t = useTranslations('inbox.composer');
  const [text, setText] = useState(thread.draft);
  const [busy, setBusy] = useState<'' | 'send' | 'ai'>('');
  const [undo, setUndo] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [snipQ, setSnipQ] = useState<string | null>(null);
  const [snipIdx, setSnipIdx] = useState(0);
  const area = useRef<HTMLTextAreaElement>(null);
  const saved = useRef(thread.draft);
  const email = thread.channel === 'gmail';

  // Otro chat: su borrador.
  useEffect(() => {
    setText(thread.draft);
    saved.current = thread.draft;
    setUndo(null);
    setSnipQ(null);
  }, [thread.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Borrador guardado solo (se escribe en el chat, lo ven las otras pestañas al recargar).
  useEffect(() => {
    if (text === saved.current) return;
    const id = window.setTimeout(() => {
      saved.current = text;
      void api(`/api/inbox/threads/${thread.id}`, { method: 'PATCH', json: { draft: text } });
    }, 700);
    return () => window.clearTimeout(id);
  }, [text, thread.id]);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  const matches = useMemo(() => {
    if (snipQ === null) return [];
    const q = snipQ.toLowerCase();
    return snippets.filter((s) => !q || s.shortcut.startsWith(q) || s.title.toLowerCase().includes(q)).slice(0, 8);
  }, [snipQ, snippets]);

  const send = useCallback(async () => {
    const body = text.trim();
    if (!body || busy || disabled) return;
    setBusy('send');
    const r = await api<{ messages: MessageDto[] }>(`/api/inbox/threads/${thread.id}/messages`, { method: 'POST', json: { body } });
    setBusy('');
    if (!r.ok) {
      onError(r.data.error ?? 'send_failed');
      return;
    }
    setText('');
    saved.current = '';
    setUndo(null);
    onSent(r.data.messages);
  }, [text, busy, disabled, thread.id, onSent, onError]);

  const draft = useCallback(async () => {
    if (busy) return;
    setBusy('ai');
    const r = await api<{ text: string }>('/api/inbox/ai', { method: 'POST', json: { action: 'draft', threadId: thread.id, instruction: text.trim() || undefined } });
    setBusy('');
    if (!r.ok) {
      onError(r.data.error ?? 'ai_failed');
      return;
    }
    setUndo(text);
    setText(r.data.text);
    area.current?.focus();
  }, [busy, text, thread.id, onError]);

  const rewrite = async (mode: Rewrite) => {
    setMenu(false);
    if (!text.trim() || busy) return;
    setBusy('ai');
    const r = await api<{ text: string }>('/api/inbox/ai', { method: 'POST', json: { action: 'rewrite', text, mode } });
    setBusy('');
    if (!r.ok) {
      onError(r.data.error ?? 'ai_failed');
      return;
    }
    setUndo(text);
    setText(r.data.text);
    area.current?.focus();
  };

  useImperativeHandle(
    ref,
    () => ({
      focus: () => area.current?.focus(),
      draft: () => void draft(),
      clear: () => {
        setText('');
        saved.current = '';
        setUndo(null);
        void api(`/api/inbox/threads/${thread.id}`, { method: 'PATCH', json: { draft: '' } });
      },
    }),
    [draft, thread.id],
  );

  const insertSnippet = (s: SnippetDto) => {
    const el = area.current;
    const caret = el?.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(/;[\w-]*$/, '');
    const filled = fillSnippet(s.body, thread.title);
    const next = before + filled + text.slice(caret);
    setText(next);
    setSnipQ(null);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = before.length + filled.length;
      el?.setSelectionRange(pos, pos);
    });
  };

  const onChange = (v: string, caret: number) => {
    setText(v);
    const m = /(?:^|\s);([\w-]*)$/.exec(v.slice(0, caret));
    setSnipQ(m && snippets.length ? m[1] : null);
    setSnipIdx(0);
  };

  return (
    <div className="ib-composer" aria-busy={busy !== '' || undefined}>
      {snipQ !== null && matches.length > 0 && (
        <ul className="ib-snippets" role="listbox" aria-label={t('snippets')}>
          {matches.map((s, i) => (
            <li key={s.id} role="option" aria-selected={i === snipIdx}>
              <button type="button" className={`ib-snippet${i === snipIdx ? ' is-active' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => insertSnippet(s)}>
                <span className="ib-snippet-title">{s.title}</span>
                {s.shortcut && <span className="ib-snippet-key">;{s.shortcut}</span>}
                <span className="ib-snippet-body">{s.body}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className="sr-only" htmlFor={`ib-compose-${thread.id}`}>
        {email ? t('labelEmail') : t('label')}
      </label>
      <textarea
        id={`ib-compose-${thread.id}`}
        ref={area}
        className="textarea ib-textarea"
        rows={1}
        value={text}
        disabled={disabled}
        placeholder={disabled ? t('disconnected') : email ? t('placeholderEmail') : t('placeholder')}
        onChange={(e) => onChange(e.target.value, e.target.selectionStart)}
        onKeyDown={(e) => {
          if (snipQ !== null && matches.length) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setSnipIdx((i) => (i + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length);
              return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              insertSnippet(matches[snipIdx]);
              return;
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setSnipQ(null);
              return;
            }
          }
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
            e.preventDefault();
            e.stopPropagation();
            void draft();
            return;
          }
          const mod = e.metaKey || e.ctrlKey;
          if (e.key === 'Enter' && !e.nativeEvent.isComposing && ((mod && !e.shiftKey) || (!email && !mod && !e.shiftKey && !e.altKey))) {
            e.preventDefault();
            void send();
            return;
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            area.current?.blur();
          }
        }}
      />
      <div className="ib-composer-bar">
        <div className="ib-composer-tools">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void draft()} disabled={disabled || busy !== ''} title={t('aiDraftHint')}>
            {busy === 'ai' ? t('aiWorking') : text.trim() ? t('aiFromText') : t('aiDraft')}
          </button>
          <div className="ib-menu-wrap">
            <button type="button" className="btn btn-ghost btn-sm" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)} disabled={disabled || !text.trim() || busy !== ''}>
              {t('rewrite')}
            </button>
            {menu && (
              <ul
                className="ib-menu"
                role="menu"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.stopPropagation();
                    setMenu(false);
                  }
                }}
              >
                {REWRITES.map((m, i) => (
                  <li key={m} role="none">
                    <button type="button" role="menuitem" className="ib-menu-item" autoFocus={i === 0} onClick={() => void rewrite(m)}>
                      {t(`rewrites.${m}`)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {undo !== null && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setText(undo);
                setUndo(null);
              }}
            >
              {t('undoAi')}
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon"
            aria-label={t('dictate')}
            title={t('dictateHint')}
            disabled={disabled}
            onClick={() => {
              area.current?.focus();
              window.dispatchEvent(new Event('zs:voice-dictate'));
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
          </button>
          {snippets.length > 0 && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                const el = area.current;
                const caret = el?.selectionStart ?? text.length;
                const sep = caret > 0 && !/\s$/.test(text.slice(0, caret)) ? ' ' : '';
                const next = `${text.slice(0, caret)}${sep};${text.slice(caret)}`;
                setText(next);
                setSnipQ('');
                requestAnimationFrame(() => {
                  el?.focus();
                  el?.setSelectionRange(caret + sep.length + 1, caret + sep.length + 1);
                });
              }}
            >
              {t('snippets')}
            </button>
          )}
        </div>
        <div className="ib-composer-send">
          <button type="button" className="btn btn-secondary btn-sm" disabled={disabled || !text.trim() || busy !== ''} onClick={() => onSendLater(text.trim())}>
            {t('later')}
          </button>
          <button type="button" className="btn btn-primary btn-sm" disabled={disabled || !text.trim() || busy !== ''} onClick={() => void send()}>
            {busy === 'send' ? t('sending') : t('send')}
          </button>
        </div>
      </div>
      <p className="ib-composer-hint" aria-hidden>
        {email ? t('hintEmail') : t('hint')}
      </p>
    </div>
  );
});

export default Composer;
