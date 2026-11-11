'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { fillSnippet, type MessageDto, type SnippetDto, type ThreadDto } from '@/lib/inbox/types';
import { api } from './api';
import AiComposeBar, { AiComposeButton } from '@/components/ai/AiComposeBar';
import { useAiCompose, type ComposeAdapter } from '@/components/ai/useAiCompose';
import { INBOX_TRANSLATE_LANGS, inboxCompose } from './ai-compose';

export interface ComposerHandle {
  focus: () => void;
  /** Abre "Ayudame a escribir". */
  draft: () => void;
  /** Vacía el campo y el borrador guardado (después de programar el envío). */
  clear: () => void;
}

/**
 * Campo de respuesta. WhatsApp: Enter manda y Shift+Enter baja de línea (como
 * WhatsApp Web); correo: ⌘Enter manda. ";" abre los snippets, ⌘J abre
 * "Ayudame a escribir" (components/ai/AiComposeBar), el micrófono dicta con
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
  const tc = useTranslations('common.aiCompose');
  const [busy, setBusy] = useState<'' | 'send'>('');
  const [snipQ, setSnipQ] = useState<string | null>(null);
  const [snipIdx, setSnipIdx] = useState(0);
  const area = useRef<HTMLTextAreaElement>(null);
  const saved = useRef(thread.draft);
  const email = thread.channel === 'gmail';

  // Otro chat: su borrador.
  useEffect(() => {
    setText(thread.draft);
    saved.current = thread.draft;
    setSnipQ(null);
  }, [thread.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Ayudame a escribir": el borrador sale con el contexto de este chat y vuelve al campo para revisarlo.
  const aiAdapter = useMemo<ComposeAdapter>(
    () => ({
      canSuggest: true,
      languages: INBOX_TRANSLATE_LANGS.map((code) => ({ code, label: tc(`langs.${code}`) })),
      run: (request, onText, signal) => inboxCompose(request, { threadId: thread.id }, onText, signal),
    }),
    [thread.id, tc],
  );
  const ai = useAiCompose({ adapter: aiAdapter, text, setText, focusComposer: () => area.current?.focus(), resetKey: thread.id });

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
    ai.clearUndo();
    onSent(r.data.messages);
  }, [text, busy, disabled, thread.id, onSent, onError, ai.clearUndo]); // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(
    ref,
    () => ({
      focus: () => area.current?.focus(),
      draft: () => ai.openBar(),
      clear: () => {
        setText('');
        saved.current = '';
        ai.clearUndo();
        void api(`/api/inbox/threads/${thread.id}`, { method: 'PATCH', json: { draft: '' } });
      },
    }),
    [ai.openBar, ai.clearUndo, thread.id], // eslint-disable-line react-hooks/exhaustive-deps
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
      <AiComposeBar ai={ai} tone="app" />
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
            if (!disabled) ai.openBar();
            return;
          }
          const mod = e.metaKey || e.ctrlKey;
          // ⌘⇧Enter (Ctrl+Shift+Enter): enviar más tarde.
          if (e.key === 'Enter' && mod && e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (!disabled && busy === '' && text.trim()) onSendLater(text.trim());
            return;
          }
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
          <AiComposeButton ai={ai} className="btn btn-ghost btn-sm aic-open-label" showLabel size={15} disabled={disabled} />
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
