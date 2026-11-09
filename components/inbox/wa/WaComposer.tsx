'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { fillSnippet, type MessageDto, type SnippetDto, type ThreadDto } from '@/lib/inbox/types';
import EmojiPicker from '@/components/groups/wa/EmojiPicker';
import { MessageMenu, type MenuItem } from '@/components/groups/wa/Menu';
import { ClockIcon, Close, Mic, SendIcon, Smiley, Sparkle } from '@/components/groups/wa/icons';
import { api } from '../api';
import type { ComposerHandle } from '../Composer';

type Rewrite = 'shorter' | 'friendlier' | 'formal' | 'fix';
const REWRITES: Rewrite[] = ['shorter', 'friendlier', 'formal', 'fix'];

/**
 * Campo de WhatsApp como en WhatsApp Web: emoji, el campo que crece, y
 * enviar (o el micrófono con el campo vacío). Arriba, la cita de la
 * respuesta o el mensaje que se edita. Lo de Inbox (borrador con IA,
 * reescribir, snippets con ";", enviar más tarde) va en íconos al lado.
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
    /** Adjuntar (lo agrega la conversación cuando hay envío de archivos). */
    attach?: ReactNode;
    onCancelBanner: () => void;
    onSent: (messages: MessageDto[]) => void;
    onSaveEdit: (m: MessageDto, body: string) => Promise<boolean>;
    onSendLater: (text: string) => void;
    onError: (code: string) => void;
    onMic?: () => void;
    /** Pegar fotos o archivos en el campo (van a la vista previa). */
    onPasteFiles?: (files: File[]) => void;
  }
>(function WaComposer({ thread, snippets, disabled, banner, editing, replyToId, attach, onCancelBanner, onSent, onSaveEdit, onSendLater, onError, onMic, onPasteFiles }, ref) {
  const t = useTranslations('inbox.composer');
  const w = useTranslations('inboxWa');
  const [text, setText] = useState(thread.draft);
  const [busy, setBusy] = useState<'' | 'send' | 'ai'>('');
  const [undo, setUndo] = useState<string | null>(null);
  const [emoji, setEmoji] = useState(false);
  const [snipQ, setSnipQ] = useState<string | null>(null);
  const [snipIdx, setSnipIdx] = useState(0);
  const area = useRef<HTMLTextAreaElement>(null);
  const saved = useRef(thread.draft);
  const beforeEdit = useRef<string | null>(null);

  useEffect(() => {
    setText(thread.draft);
    saved.current = thread.draft;
    setUndo(null);
    setSnipQ(null);
    setEmoji(false);
  }, [thread.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const r = await api<{ messages: MessageDto[] }>(`/api/inbox/threads/${thread.id}/messages`, { method: 'POST', json: { body, ...(replyToId ? { replyTo: replyToId } : {}) } });
    setBusy('');
    if (!r.ok) {
      onError(r.data.error ?? 'send_failed');
      return;
    }
    setText('');
    saved.current = '';
    setUndo(null);
    if (replyToId) onCancelBanner();
    onSent(r.data.messages);
  }, [text, busy, disabled, editing, thread.id, replyToId, onSaveEdit, onCancelBanner, onSent, onError]);

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

  const aiItems: MenuItem[] = [
    { key: 'draft', label: text.trim() ? t('aiFromText') : t('aiDraft'), onSelect: () => void draft() },
    ...(text.trim() ? REWRITES.map((m) => ({ key: m, label: t(`rewrites.${m}`), onSelect: () => void rewrite(m) })) : []),
    ...(undo !== null
      ? [
          {
            key: 'undo',
            label: t('undoAi'),
            divider: true,
            onSelect: () => {
              setText(undo);
              setUndo(null);
            },
          },
        ]
      : []),
  ];

  const hasText = !!text.trim();
  return (
    <div className="wa-composer ib-wa-composer" aria-busy={busy !== '' || undefined}>
      {banner}
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
        {attach}
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
            const m = /(?:^|\s);([\w-]*)$/.exec(v.slice(0, e.target.selectionStart));
            setSnipQ(m && snippets.length ? m[1] : null);
            setSnipIdx(0);
          }}
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
        {!editing && (
          <MessageMenu
            label={w('aiTools')}
            items={aiItems}
            trigger={<Sparkle size={20} />}
            className={`wa-icon-btn wa-ai-btn${busy === 'ai' ? ' is-on' : ''}`}
            align="right"
          />
        )}
        {hasText && !editing && (
          <button type="button" className="wa-icon-btn" aria-label={t('later')} title={t('later')} disabled={disabled || busy !== ''} onClick={() => onSendLater(text.trim())}>
            <ClockIcon size={20} />
          </button>
        )}
        {hasText || editing || !onMic ? (
          <button type="button" className="wa-send" aria-label={editing ? w('saveEdit') : t('send')} title={editing ? w('saveEdit') : t('send')} disabled={disabled || !hasText || busy !== ''} onClick={() => void send()}>
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
