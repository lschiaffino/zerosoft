'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { fillSnippet, type MessageDto, type SnippetDto, type ThreadDto } from '@/lib/inbox/types';
import EmojiPicker from '@/components/groups/wa/EmojiPicker';
import { MessageMenu, type MenuItem } from '@/components/groups/wa/Menu';
import { ClockIcon, Close, Mic, Plus, SendIcon, Smiley } from '@/components/groups/wa/icons';
import { api } from '../api';
import AiComposeBar, { AiComposeButton, PencilSparkle } from '@/components/ai/AiComposeBar';
import { useAiCompose, type ComposeAdapter } from '@/components/ai/useAiCompose';
import { INBOX_TRANSLATE_LANGS, inboxCompose } from '../ai-compose';
import type { ComposerHandle } from '../Composer';

/**
 * Campo de WhatsApp como en WhatsApp Web: emoji, el campo que crece, y
 * enviar (o el micrófono con el campo vacío). Arriba, la cita de la
 * respuesta o el mensaje que se edita. Lo de Inbox va en íconos al lado:
 * "Ayudame a escribir" (el lápiz, ⌘J; components/ai/AiComposeBar), enviar
 * más tarde, y un menú con dictar y snippets.
 * Enter manda, Shift+Enter baja de línea, Esc cancela la cita o la edición.
 */
const WaComposer = forwardRef<
  ComposerHandle,
  {
    thread: ThreadDto;
    snippets: SnippetDto[];
    disabled: boolean;
    /** Barra de la cita o de la edición (la arma la conversación). */
    banner?: ReactNode;
    editing: MessageDto | null;
    replyToId: string | null;
    /** Adjuntar (lo agrega la conversación cuando hay envío de archivos). Recibe lo que el composer suma a ese menú. */
    attach?: (extra: MenuItem[]) => ReactNode;
    onCancelBanner: () => void;
    onSent: (messages: MessageDto[]) => void;
    onSaveEdit: (m: MessageDto, body: string) => Promise<boolean>;
    onSendLater: (text: string) => void;
    onError: (code: string) => void;
    onMic?: () => void;
    /** Pegar fotos o archivos en el campo (van a la vista previa). */
    onPasteFiles?: (files: File[]) => void;
    /** Participantes para mencionar con "@" (grupos). */
    mentionables?: Array<{ phone: string; name: string }>;
    /** Se escribió algo (para mandar "escribiendo"). */
    onTyping?: () => void;
  }
>(function WaComposer({ thread, snippets, disabled, banner, editing, replyToId, attach, onCancelBanner, onSent, onSaveEdit, onSendLater, onError, onMic, onPasteFiles, mentionables, onTyping }, ref) {
  const t = useTranslations('inbox.composer');
  const w = useTranslations('inboxWa');
  const [text, setText] = useState(thread.draft);
  const tc = useTranslations('common.aiCompose');
  const [busy, setBusy] = useState<'' | 'send'>('');
  const [emoji, setEmoji] = useState(false);
  const [snipQ, setSnipQ] = useState<string | null>(null);
  const [snipIdx, setSnipIdx] = useState(0);
  const area = useRef<HTMLTextAreaElement>(null);
  const saved = useRef(thread.draft);
  const beforeEdit = useRef<string | null>(null);
  const [mentionQ, setMentionQ] = useState<string | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);
  const picked = useRef(new Map<string, string>());

  useEffect(() => {
    setText(thread.draft);
    saved.current = thread.draft;
    setSnipQ(null);
    setEmoji(false);
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

  // Editar: el texto del mensaje en el campo; al salir, vuelve lo que había.
  useEffect(() => {
    if (editing) {
      beforeEdit.current = text;
      setText(editing.body);
      requestAnimationFrame(() => {
        area.current?.focus();
        const n = editing.body.length;
        area.current?.setSelectionRange(n, n);
      });
    } else if (beforeEdit.current !== null) {
      setText(beforeEdit.current);
      beforeEdit.current = null;
    }
  }, [editing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (replyToId) area.current?.focus();
  }, [replyToId]);

  // Borrador guardado solo (no mientras se edita un mensaje).
  useEffect(() => {
    if (editing || text === saved.current) return;
    const id = window.setTimeout(() => {
      saved.current = text;
      void api(`/api/inbox/threads/${thread.id}`, { method: 'PATCH', json: { draft: text } });
    }, 700);
    return () => window.clearTimeout(id);
  }, [text, thread.id, editing]);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 148)}px`;
  }, [text]);

  const matches = useMemo(() => {
    if (snipQ === null) return [];
    const q = snipQ.toLowerCase();
    return snippets.filter((s) => !q || s.shortcut.startsWith(q) || s.title.toLowerCase().includes(q)).slice(0, 8);
  }, [snipQ, snippets]);

  const people = useMemo(() => {
    if (mentionQ === null || !mentionables?.length) return [];
    const q = mentionQ.toLowerCase();
    return mentionables.filter((p) => !q || p.name.toLowerCase().includes(q) || p.phone.includes(q)).slice(0, 8);
  }, [mentionQ, mentionables]);

  /** Cambia "@an" por "@Ana " y recuerda a quién se mencionó. */
  const insertMention = (p: { phone: string; name: string }) => {
    const el = area.current;
    const caret = el?.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(/@[^\s@]*$/, '');
    const label = (p.name || p.phone).replace(/\s+/g, ' ').trim();
    picked.current.set(label, p.phone);
    const ins = `@${label} `;
    setText(before + ins + text.slice(caret));
    setMentionQ(null);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = before.length + ins.length;
      el?.setSelectionRange(pos, pos);
    });
  };

  const send = useCallback(async () => {
    const body = text.trim();
    if (!body || busy || disabled) return;
    if (editing) {
      setBusy('send');
      const ok = await onSaveEdit(editing, body);
      setBusy('');
      if (ok) {
        beforeEdit.current = beforeEdit.current ?? '';
        onCancelBanner();
      }
      return;
    }
    setBusy('send');
    // Menciones: "@Ana" sale como "@5491…" con la lista de teléfonos (WhatsApp la muestra con el nombre).
    let out = body;
    const mentions: string[] = [];
    for (const [label, phone] of picked.current) {
      if (!out.includes(`@${label}`)) continue;
      out = out.split(`@${label}`).join(`@${phone}`);
      mentions.push(phone);
    }
    const r = await api<{ messages: MessageDto[] }>(`/api/inbox/threads/${thread.id}/messages`, {
      method: 'POST',
      json: { body: out, ...(replyToId ? { replyTo: replyToId } : {}), ...(mentions.length ? { mentions } : {}) },
    });
    setBusy('');
    if (!r.ok) {
      onError(r.data.error ?? 'send_failed');
      return;
    }
    picked.current.clear();
    setText('');
    saved.current = '';
    ai.clearUndo();
    if (replyToId) onCancelBanner();
    onSent(r.data.messages);
  }, [text, busy, disabled, editing, thread.id, replyToId, onSaveEdit, onCancelBanner, onSent, onError, ai.clearUndo]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Dicta con Voice: el texto entra en el campo. */
  const dictate = () => {
    area.current?.focus();
    window.dispatchEvent(new Event('zs:voice-dictate'));
  };

  /** Abre la lista de snippets (lo mismo que escribir ";"). */
  const openSnippets = () => {
    const el = area.current;
    const caret = el?.selectionStart ?? text.length;
    const sep = caret > 0 && !/\s$/.test(text.slice(0, caret)) ? ' ' : '';
    setText(`${text.slice(0, caret)}${sep};${text.slice(caret)}`);
    setSnipQ('');
    setSnipIdx(0);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret + sep.length + 1, caret + sep.length + 1);
    });
  };

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

  const insertAtCaret = (s: string) => {
    const el = area.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + s + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + s.length, start + s.length);
    });
  };

  const insertSnippet = (s: SnippetDto) => {
    const el = area.current;
    const caret = el?.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(/;[\w-]*$/, '');
    const filled = fillSnippet(s.body, thread.title);
    setText(before + filled + text.slice(caret));
    setSnipQ(null);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = before.length + filled.length;
      el?.setSelectionRange(pos, pos);
    });
  };

  // Van en el menú "+", debajo de adjuntar: "Ayudame a escribir" (en el teléfono no hay lugar para el lápiz en la fila), dictar y snippets.
  const toolItems: MenuItem[] = [
    ...(editing ? [] : [{ key: 'ai', label: tc('open'), icon: <PencilSparkle size={16} />, divider: true, onSelect: ai.openBar }]),
    { key: 'dictate', label: t('dictate'), icon: <Mic size={16} />, divider: !!editing, onSelect: dictate },
    ...(snippets.length ? [{ key: 'snippets', label: t('snippets'), icon: <SnippetIcon />, onSelect: openSnippets }] : []),
  ];

  const hasText = !!text.trim();
  return (
    <div className="wa-composer ib-wa-composer" aria-busy={busy !== '' || undefined}>
      {banner}
      {mentionQ !== null && people.length > 0 && (
        <ul className="ib-snippets ib-wa-mentions" role="listbox" aria-label={w('mention')}>
          {people.map((p, i) => (
            <li key={p.phone} role="option" aria-selected={i === mentionIdx}>
              <button type="button" className={`ib-snippet${i === mentionIdx ? ' is-active' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => insertMention(p)}>
                <span className="ib-snippet-title">{p.name || p.phone}</span>
                <span className="ib-snippet-key">+{p.phone}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
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
      {!editing && <AiComposeBar ai={ai} />}
      <div className="wa-bar">
        <span className="wa-emoji-wrap">
          <button type="button" className="wa-icon-btn" aria-label={w('emoji')} title={w('emoji')} aria-expanded={emoji} onClick={() => setEmoji((v) => !v)} disabled={disabled}>
            <Smiley size={24} />
          </button>
          {emoji && (
            <EmojiPicker
              onPick={(e) => insertAtCaret(e)}
              onClose={() => {
                setEmoji(false);
                area.current?.focus();
              }}
            />
          )}
        </span>
        {attach ? attach(toolItems) : <MessageMenu label={w('moreTools')} items={toolItems} trigger={<Plus size={24} />} className="wa-icon-btn wa-attach" align="left" />}
        <label className="sr-only" htmlFor={`ib-compose-${thread.id}`}>
          {t('label')}
        </label>
        <textarea
          id={`ib-compose-${thread.id}`}
          ref={area}
          className="wa-input"
          rows={1}
          value={text}
          disabled={disabled}
          placeholder={disabled ? t('disconnected') : w('placeholder')}
          onPaste={(e) => {
            if (!onPasteFiles || editing) return;
            const files = [...(e.clipboardData?.files ?? [])];
            if (!files.length) return;
            e.preventDefault();
            onPasteFiles(files);
          }}
          onChange={(e) => {
            const v = e.target.value;
            setText(v);
            if (v.trim()) onTyping?.();
            const m = /(?:^|\s);([\w-]*)$/.exec(v.slice(0, e.target.selectionStart));
            setSnipQ(m && snippets.length ? m[1] : null);
            setSnipIdx(0);
            const at = mentionables?.length ? /(?:^|\s)@([^\s@]{0,30})$/.exec(v.slice(0, e.target.selectionStart)) : null;
            setMentionQ(at ? at[1] : null);
            setMentionIdx(0);
          }}
          onKeyDown={(e) => {
            if (mentionQ !== null && people.length) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                setMentionIdx((i) => (i + (e.key === 'ArrowDown' ? 1 : people.length - 1)) % people.length);
                return;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                insertMention(people[mentionIdx]);
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setMentionQ(null);
                return;
              }
            }
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
              if (!editing && !disabled) ai.openBar();
              return;
            }
            // ⌘⇧Enter (Ctrl+Shift+Enter): enviar más tarde.
            if (e.key === 'Enter' && e.shiftKey && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (!editing && !disabled && busy === '') onSendLater(text.trim());
              return;
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
              return;
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              if (banner) onCancelBanner();
              else area.current?.blur();
            }
          }}
        />
        {!editing && <AiComposeButton ai={ai} className="wa-icon-btn wa-ai-btn" disabled={disabled} />}
        {!editing && (
          <button type="button" className="wa-icon-btn" data-testid="inbox-send-later" aria-label={t('later')} title={t('laterHint')} disabled={disabled || busy !== ''} onClick={() => onSendLater(text.trim())}>
            <ClockIcon size={20} />
          </button>
        )}
        {hasText || editing || !onMic ? (
          <button type="button" className="wa-send" aria-label={editing ? w('saveEdit') : t('send')} title={editing ? w('saveEdit') : t('send')} disabled={disabled || !hasText || busy !== ''} onClick={() => void send()} onContextMenu={(e) => {
            // Clic derecho en Enviar: programar el envío (como en WhatsApp).
            if (editing || !hasText) return;
            e.preventDefault();
            onSendLater(text.trim());
          }}>
            {editing ? <span aria-hidden="true">✓</span> : <SendIcon size={20} />}
          </button>
        ) : (
          <button type="button" className="wa-send is-mic" aria-label={w('recordVoice')} title={w('recordVoice')} disabled={disabled} onClick={onMic}>
            <Mic size={22} />
          </button>
        )}
      </div>
    </div>
  );
});

export default WaComposer;

/** Ícono de snippets: un bloque de texto guardado. */
function SnippetIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 6h14M5 12h14M5 18h8" />
    </svg>
  );
}

/** Barra arriba del campo: la cita de la respuesta o el mensaje que se edita, con la X para cancelar. */
export function ComposerBanner({ children, onClose, label }: { children: ReactNode; onClose: () => void; label: string }) {
  return (
    <div className="wa-replying">
      {children}
      <button type="button" className="wa-icon-btn" aria-label={label} title={label} onClick={onClose}>
        <Close size={20} />
      </button>
    </div>
  );
}
