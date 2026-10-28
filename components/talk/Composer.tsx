'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { decodeMentions, encodeMentions } from '@/lib/talk-markdown';
import { searchEmoji } from '@/lib/talk-emoji';
import { parseRemindCommand } from '@/lib/talk-time';
import type { TalkChannelDto, TalkFileDto, TalkMessageDto } from '@/lib/talk';
import { TalkApiError, useTalk } from './talk-context';

type Suggest = { kind: 'user' | 'group' | 'special' | 'channel' | 'emoji' | 'command'; id: string; label: string; detail?: string; insert: string };

interface Props {
  channel: TalkChannelDto;
  parentId: string | null;
  initialDraft?: string;
  /** Cambia para pedir foco (abrir canal, responder). */
  focusKey?: string | number;
  onSent?: (m: TalkMessageDto) => void;
  onEditLast?: () => void;
  onDraftChange?: (body: string) => void;
  /** Respuesta de una app que solo ve esta persona (slash commands). */
  onEphemeral?: (e: { id: string; botName: string; text: string }) => void;
  compact?: boolean;
}

const MAX_FILES = 10;

export default function Composer({ channel, parentId, initialDraft = '', focusKey, onSent, onEditLast, onDraftChange, onEphemeral, compact }: Props) {
  const t = useTranslations('talk');
  const ctx = useTalk();
  const { boot, channels, people, api, toast, dialog, channelTitle } = ctx;
  const decoded = useMemo(() => decodeMentions(initialDraft, namesFrom(ctx)), [initialDraft]); // eslint-disable-line react-hooks/exhaustive-deps
  const [text, setText] = useState(decoded.text);
  const picked = useRef({ users: decoded.users, groups: decoded.groups, channels: decoded.channels });
  const [files, setFiles] = useState<Array<TalkFileDto & { uploading?: boolean; tmp?: string }>>([]);
  const [also, setAlso] = useState(false);
  const [sending, setSending] = useState(false);
  const [suggest, setSuggest] = useState<{ items: Suggest[]; sel: number; start: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  // Enter con archivos subiendo: se manda apenas terminan (como Slack).
  const [queued, setQueued] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTyping = useRef(0);
  const where = channel.kind === 'public' || channel.kind === 'private' ? `#${channel.name}` : channelTitle(channel);

  useEffect(() => {
    ref.current?.focus();
  }, [focusKey]);

  // El borrador guardado puede llegar después de montar (se piden al abrir Talk).
  useEffect(() => {
    if (text || !initialDraft) return;
    const d = decodeMentions(initialDraft, namesFrom(ctx));
    picked.current = { users: d.users, groups: d.groups, channels: d.channels };
    setText(d.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDraft]);

  useEffect(() => {
    autosize(ref.current);
  }, [text]);

  const saveDraft = useCallback(
    (body: string) => {
      if (draftTimer.current) clearTimeout(draftTimer.current);
      draftTimer.current = setTimeout(() => {
        const encoded = encodeMentions(body, picked.current);
        onDraftChange?.(encoded);
        void api('/api/talk/drafts', { method: 'PUT', json: { channelId: channel.id, parentId, body: encoded } }).catch(() => undefined);
      }, 700);
    },
    [api, channel.id, parentId, onDraftChange],
  );

  function sendTyping() {
    const now = Date.now();
    if (now - lastTyping.current < 3000) return;
    lastTyping.current = now;
    void api(`/api/talk/channels/${channel.id}/typing`, { method: 'POST', json: { parentId } }).catch(() => undefined);
  }

  function update(value: string, caret?: number) {
    setText(value);
    saveDraft(value);
    if (value.trim()) sendTyping();
    computeSuggest(value, caret ?? ref.current?.selectionStart ?? value.length);
  }

  function computeSuggest(value: string, caret: number) {
    const before = value.slice(0, caret);
    // "/" al principio: comandos de Talk y de las apps del workspace (como Slack).
    const cmd = /^\/([\w-]*)$/.exec(before);
    if (cmd) {
      const q = cmd[1].toLowerCase();
      const builtIn: Suggest[] = [
        { kind: 'command', id: 'remind', label: '/remind', detail: t('composer.cmdRemind'), insert: '/remind' },
        { kind: 'command', id: 'topic', label: '/topic', detail: t('composer.cmdTopic'), insert: '/topic' },
        { kind: 'command', id: 'status', label: '/status', detail: t('composer.cmdStatus'), insert: '/status' },
        { kind: 'command', id: 'summarize', label: '/summarize', detail: t('composer.cmdSummarize'), insert: '/summarize' },
        { kind: 'command', id: 'huddle', label: '/huddle', detail: t('composer.cmdHuddle'), insert: '/huddle' },
        { kind: 'command', id: 'leave', label: '/leave', detail: t('composer.cmdLeave'), insert: '/leave' },
      ];
      const apps: Suggest[] = (boot.commands ?? []).map((c) => ({
        kind: 'command',
        id: c.id,
        label: c.usageHint ? `${c.command} ${c.usageHint}` : c.command,
        detail: c.description || t('composer.cmdApp'),
        insert: c.command,
      }));
      const items = [...apps, ...builtIn].filter((x) => x.insert.slice(1).startsWith(q)).slice(0, 8);
      return setSuggest(items.length ? { items, sel: 0, start: 0 } : null);
    }
    const m = /(^|[\s(])([@#:])([\p{L}\p{N}_.+-]*)$/u.exec(before);
    if (!m) return setSuggest(null);
    const trigger = m[2];
    const q = m[3].toLowerCase();
    const start = caret - m[3].length - 1;
    let items: Suggest[] = [];
    if (trigger === '@') {
      const specials: Suggest[] = [
        { kind: 'special', id: 'channel', label: '@channel', detail: t('composer.notifyAll'), insert: '@channel' },
        { kind: 'special', id: 'here', label: '@here', detail: t('composer.notifyActive'), insert: '@here' },
      ];
      const ppl = [...people.values()]
        .filter((p) => !q || p.name.toLowerCase().includes(q) || p.email.toLowerCase().startsWith(q))
        .slice(0, 8)
        .map<Suggest>((p) => ({ kind: 'user', id: p.id, label: p.name, detail: p.email, insert: `@${p.name}` }));
      const groups = boot.groups
        .filter((g) => !q || g.handle.includes(q) || g.name.toLowerCase().includes(q))
        .slice(0, 4)
        .map<Suggest>((g) => ({ kind: 'group', id: g.id, label: `@${g.handle}`, detail: t('composer.groupMembers', { count: g.members.length }), insert: `@${g.handle}` }));
      items = [...ppl, ...groups, ...specials.filter((s) => !q || s.id.startsWith(q))];
    } else if (trigger === '#') {
      items = channels
        .filter((c) => (c.kind === 'public' || c.kind === 'private') && (!q || c.name.includes(q)))
        .slice(0, 8)
        .map((c) => ({ kind: 'channel', id: c.id, label: `#${c.name}`, insert: `#${c.name}` }));
    } else if (q.length >= 2) {
      items = searchEmoji(q, 8).map((e) => ({ kind: 'emoji', id: e.name, label: `${e.char} :${e.name}:`, insert: `:${e.name}:` }));
    }
    setSuggest(items.length ? { items, sel: 0, start } : null);
  }

  function pick(s: Suggest) {
    const el = ref.current;
    const caret = el?.selectionStart ?? text.length;
    const insert = `${s.insert} `;
    const value = text.slice(0, suggest?.start ?? caret) + insert + text.slice(caret);
    if (s.kind === 'user') picked.current.users[s.label] = s.id;
    if (s.kind === 'group') picked.current.groups[s.insert.slice(1)] = s.id;
    if (s.kind === 'channel') picked.current.channels[s.insert.slice(1)] = s.id;
    const pos = (suggest?.start ?? caret) + insert.length;
    setSuggest(null);
    setText(value);
    saveDraft(value);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  }

  function wrap(before: string, after = before, placeholder = '') {
    const el = ref.current;
    if (!el) return;
    const s = el.selectionStart;
    const e = el.selectionEnd;
    const sel = text.slice(s, e) || placeholder;
    const value = text.slice(0, s) + before + sel + after + text.slice(e);
    update(value);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + before.length, s + before.length + sel.length);
    });
  }

  function prefixLines(make: (i: number) => string) {
    const el = ref.current;
    if (!el) return;
    const s = text.lastIndexOf('\n', el.selectionStart - 1) + 1;
    let e = text.indexOf('\n', el.selectionEnd);
    if (e < 0) e = text.length;
    const lines = text.slice(s, e).split('\n');
    const out = lines.map((l, i) => make(i) + l).join('\n');
    update(text.slice(0, s) + out + text.slice(e));
    requestAnimationFrame(() => el.focus());
  }

  function insertAtCaret(insert: string) {
    const el = ref.current;
    const s = el?.selectionStart ?? text.length;
    const e = el?.selectionEnd ?? text.length;
    const value = text.slice(0, s) + insert + text.slice(e);
    update(value);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(s + insert.length, s + insert.length);
    });
  }

  async function upload(list: FileList | File[]) {
    const arr = [...list].slice(0, MAX_FILES - files.length);
    if (!arr.length) return;
    for (const f of arr) {
      const tmp = crypto.randomUUID();
      setFiles((prev) => [...prev, { id: tmp, tmp, name: f.name, mime: f.type, size: f.size, url: '', uploading: true }]);
      const fd = new FormData();
      fd.append('file', f);
      fd.append('channelId', channel.id);
      try {
        const res = await fetch('/api/talk/files', { method: 'POST', body: fd });
        const data = (await res.json().catch(() => ({}))) as TalkFileDto & { error?: string };
        if (!res.ok) throw new TalkApiError(data.error ?? 'upload_failed', res.status);
        setFiles((prev) => prev.map((x) => (x.tmp === tmp ? data : x)));
      } catch (err) {
        setFiles((prev) => prev.filter((x) => x.tmp !== tmp));
        toast(err instanceof TalkApiError && t.has(`errors.${err.code}`) ? t(`errors.${err.code}`) : t('errors.upload_failed'), 'error');
      }
    }
  }

  function removeFile(f: TalkFileDto & { tmp?: string }) {
    setFiles((prev) => prev.filter((x) => x.id !== f.id));
    if (!f.tmp) void api(`/api/talk/files/${f.id}`, { method: 'DELETE' }).catch(() => undefined);
  }

  async function runSlash(raw: string): Promise<boolean> {
    const cmd = raw.trim();
    if (!cmd.startsWith('/')) return false;
    const [name, ...rest] = cmd.split(/\s+/);
    const arg = rest.join(' ');
    const lower = name.toLowerCase();
    if (['/remind', '/recordar', '/recordarme', '/lembrar', '/lembrete'].includes(lower)) {
      const parsed = parseRemindCommand(cmd);
      if (!parsed) {
        toast(t('composer.remindHelp'), 'error');
        return true;
      }
      await api('/api/talk/reminders', { method: 'POST', json: { text: parsed.text, remindAt: parsed.at.toISOString() } });
      toast(t('composer.remindSet', { when: parsed.at.toLocaleString(ctx.locale, { dateStyle: 'medium', timeStyle: 'short' }) }));
      return true;
    }
    if (lower === '/topic' || lower === '/tema') {
      await api(`/api/talk/channels/${channel.id}`, { method: 'PATCH', json: { topic: arg } });
      ctx.refreshBoot();
      return true;
    }
    if (lower === '/leave' || lower === '/salir' || lower === '/sair') {
      await api(`/api/talk/channels/${channel.id}/members`, { method: 'DELETE' });
      ctx.refreshBoot();
      ctx.open({ view: 'channel' });
      return true;
    }
    if (lower === '/status' || lower === '/estado') {
      dialog({ kind: 'status' });
      return true;
    }
    if (lower === '/summarize' || lower === '/resumir') {
      dialog(parentId ? { kind: 'summary', rootId: parentId } : { kind: 'summary', channelId: channel.id });
      return true;
    }
    if (lower === '/huddle') {
      ctx.huddle.join(channel.id);
      return true;
    }
    // Slash commands de las apps del workspace.
    const app = (boot.commands ?? []).find((c) => c.command === lower);
    if (app) {
      const res = await api<{ ephemeral: string | null; ephemeralId?: string | null }>('/api/talk/commands/run', {
        method: 'POST',
        json: { channelId: channel.id, parentId, command: lower, text: arg },
      });
      if (res.ephemeral) onEphemeral?.({ id: res.ephemeralId ?? crypto.randomUUID(), botName: lower, text: res.ephemeral });
      return true;
    }
    if (/^\/[\w-]+$/.test(lower)) {
      toast(t('composer.unknownCommand', { command: lower }), 'error');
      return true;
    }
    return false;
  }

  async function send(override?: string) {
    if (sending) return;
    if (files.some((f) => f.uploading)) {
      setQueued(true);
      return;
    }
    const raw = override ?? text;
    if (!override && raw.trim().startsWith('/')) {
      try {
        if (await runSlash(raw)) {
          reset();
          return;
        }
      } catch (err) {
        toast(errorText(t, err), 'error');
        return;
      }
    }
    const body = encodeMentions(raw, picked.current);
    if (!body.trim() && !files.length) return;
    setSending(true);
    try {
      const msg = await api<TalkMessageDto>(`/api/talk/channels/${channel.id}/messages`, {
        method: 'POST',
        json: { body, parentId, alsoInChannel: parentId ? also : undefined, fileIds: files.map((f) => f.id) },
      });
      reset();
      onSent?.(msg);
    } catch (err) {
      toast(errorText(t, err), 'error');
    } finally {
      setSending(false);
      ref.current?.focus();
    }
  }

  useEffect(() => {
    if (!queued || files.some((f) => f.uploading)) return;
    setQueued(false);
    void send();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queued, files]);

  function reset() {
    setText('');
    setFiles([]);
    setAlso(false);
    picked.current = { users: {}, groups: {}, channels: {} };
    if (draftTimer.current) clearTimeout(draftTimer.current);
    onDraftChange?.('');
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (suggest) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const d = e.key === 'ArrowDown' ? 1 : -1;
        setSuggest({ ...suggest, sel: (suggest.sel + d + suggest.items.length) % suggest.items.length });
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pick(suggest.items[suggest.sel]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setSuggest(null);
        return;
      }
    }
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      return wrap('*');
    }
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      return wrap('_');
    }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'x') {
      e.preventDefault();
      return wrap('~');
    }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      return wrap('`');
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.nativeEvent.isComposing) {
      // Dentro de un bloque de código abierto, Enter es salto de línea.
      const before = text.slice(0, ref.current?.selectionStart ?? text.length);
      if ((before.match(/```/g)?.length ?? 0) % 2 === 1) return;
      e.preventDefault();
      void send();
      return;
    }
    if (e.key === 'ArrowUp' && !text && onEditLast) {
      e.preventDefault();
      onEditLast();
    }
  }

  const canSend = (text.trim().length > 0 || files.length > 0) && !queued;

  return (
    <div
      className={`talk-composer${compact ? ' is-compact' : ''}${dragOver ? ' is-drag' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragOver(false);
        void upload(e.dataTransfer.files);
      }}
    >
      <div className="talk-toolbar" role="toolbar" aria-label={t('composer.formatting')}>
        <ToolBtn label={t('composer.bold')} kbd="⌘B" onClick={() => wrap('*')}>
          <b>B</b>
        </ToolBtn>
        <ToolBtn label={t('composer.italic')} kbd="⌘I" onClick={() => wrap('_')}>
          <i>I</i>
        </ToolBtn>
        <ToolBtn label={t('composer.strike')} kbd="⌘⇧X" onClick={() => wrap('~')}>
          <s>S</s>
        </ToolBtn>
        <ToolBtn label={t('composer.link')} onClick={() => wrap('[', '](https://)', t('composer.linkText'))}>
          <IconLink />
        </ToolBtn>
        <ToolBtn label={t('composer.bullets')} onClick={() => prefixLines(() => '- ')}>
          <IconList />
        </ToolBtn>
        <ToolBtn label={t('composer.numbers')} onClick={() => prefixLines((i) => `${i + 1}. `)}>
          <span className="talk-tool-num">1.</span>
        </ToolBtn>
        <ToolBtn label={t('composer.quote')} onClick={() => prefixLines(() => '> ')}>
          <span className="talk-tool-num">&gt;</span>
        </ToolBtn>
        <ToolBtn label={t('composer.code')} kbd="⌘⇧C" onClick={() => wrap('`')}>
          <span className="talk-tool-mono">{'</>'}</span>
        </ToolBtn>
        <ToolBtn label={t('composer.codeBlock')} onClick={() => wrap('```\n', '\n```')}>
          <span className="talk-tool-mono">{'{ }'}</span>
        </ToolBtn>
      </div>
      <div className="talk-input-wrap">
        <textarea
          ref={ref}
          className="talk-input"
          rows={1}
          value={text}
          aria-label={parentId ? t('composer.replyLabel') : t('composer.label', { where })}
          placeholder={parentId ? t('composer.replyPlaceholder') : t('composer.placeholder', { where })}
          onChange={(e) => update(e.target.value, e.target.selectionStart)}
          onKeyDown={onKeyDown}
          onClick={(e) => computeSuggest(text, e.currentTarget.selectionStart)}
          onBlur={() => setTimeout(() => setSuggest(null), 150)}
          onPaste={(e) => {
            const pasted = [...e.clipboardData.files];
            if (pasted.length) {
              e.preventDefault();
              void upload(pasted);
            }
          }}
          aria-autocomplete="list"
          aria-controls={suggest ? `talk-suggest-${channel.id}-${parentId ?? 'root'}` : undefined}
          aria-activedescendant={suggest ? `talk-sug-${channel.id}-${parentId ?? 'root'}-${suggest.sel}` : undefined}
        />
        {suggest && (
          <ul className="talk-suggest" role="listbox" id={`talk-suggest-${channel.id}-${parentId ?? 'root'}`}>
            {suggest.items.map((s, i) => (
              <li
                key={`${s.kind}-${s.id}`}
                id={`talk-sug-${channel.id}-${parentId ?? 'root'}-${i}`}
                role="option"
                aria-selected={i === suggest.sel}
                className={i === suggest.sel ? 'is-sel' : ''}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(s);
                }}
              >
                <span className="talk-suggest-label">{s.label}</span>
                {s.detail && <span className="talk-suggest-detail">{s.detail}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
      {files.length > 0 && (
        <ul className="talk-attachments">
          {files.map((f) => (
            <li key={f.id} className="talk-attachment">
              <span className="talk-attachment-name">{f.uploading ? t('composer.uploading', { name: f.name }) : f.name}</span>
              <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={t('composer.removeFile', { name: f.name })} onClick={() => removeFile(f)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="talk-composer-foot">
        <div className="talk-composer-tools">
          <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={t('composer.attach')} title={t('composer.attach')} onClick={() => fileRef.current?.click()}>
            <IconClip />
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) void upload(e.target.files);
              e.target.value = '';
            }}
          />
          <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={t('composer.emoji')} title={t('composer.emoji')} onClick={() => dialog({ kind: 'emoji', onPick: (em) => insertAtCaret(em) })}>
            <span aria-hidden="true">☺</span>
          </button>
          <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={t('composer.mention')} title={t('composer.mention')} onClick={() => insertAtCaret('@')}>
            <span aria-hidden="true">@</span>
          </button>
          {!boot.guest && <button type="button" className="btn btn-ghost btn-sm" onClick={() => dialog({ kind: 'share', onPick: (url) => insertAtCaret(`${text && !text.endsWith(' ') ? ' ' : ''}${url} `) })}>
            {t('composer.share')}
          </button>}
          {parentId && channel.kind !== 'dm' && (
            <label className="ui-check talk-also">
              <input type="checkbox" checked={also} onChange={(e) => setAlso(e.target.checked)} />
              <span>{t('composer.alsoSend', { where })}</span>
            </label>
          )}
        </div>
        <div className="btn-group talk-send">
          <button type="button" className="btn btn-primary btn-sm" disabled={!canSend || sending} onClick={() => void send()} aria-label={t('composer.send')}>
            {t('composer.send')}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm btn-icon"
            disabled={!canSend || sending}
            aria-label={t('composer.schedule')}
            title={t('composer.schedule')}
            onClick={() =>
              dialog({
                kind: 'schedule',
                channelId: channel.id,
                parentId,
                body: encodeMentions(text, picked.current),
                fileIds: files.map((f) => f.id),
                onDone: reset,
              })
            }
          >
            <IconClock />
          </button>
        </div>
      </div>
      <p className="talk-hint">{t('composer.hint')}</p>
    </div>
  );
}

export function errorText(t: ReturnType<typeof useTranslations>, err: unknown): string {
  const code = err instanceof TalkApiError ? err.code : 'generic';
  return t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic');
}

function namesFrom(ctx: ReturnType<typeof useTalk>) {
  return {
    user: (id: string) => ctx.personName(id),
    channel: (id: string) => ctx.channelById.get(id)?.name,
    group: (id: string) => ctx.boot.groups.find((g) => g.id === id)?.handle,
  };
}

function autosize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 280)}px`;
}

function ToolBtn({ label, kbd, onClick, children }: { label: string; kbd?: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className="talk-tool" aria-label={label} title={kbd ? `${label} (${kbd})` : label} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {children}
    </button>
  );
}

export function IconClip() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M10.5 4.5 5.8 9.2a1.5 1.5 0 0 0 2.1 2.1l4.9-4.9a3 3 0 0 0-4.2-4.2L3.7 7.1a4.5 4.5 0 0 0 6.4 6.4l3.4-3.4" />
    </svg>
  );
}
function IconLink() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M6.5 9.5 9.5 6.5M7 4.5l1-1a3 3 0 0 1 4.2 4.2l-1 1M9 11.5l-1 1a3 3 0 0 1-4.2-4.2l1-1" />
    </svg>
  );
}
function IconList() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M6 4h8M6 8h8M6 12h8" />
      <circle cx="2.5" cy="4" r="0.9" fill="currentColor" />
      <circle cx="2.5" cy="8" r="0.9" fill="currentColor" />
      <circle cx="2.5" cy="12" r="0.9" fill="currentColor" />
    </svg>
  );
}
export function IconClock() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2.5 1.5" />
    </svg>
  );
}
