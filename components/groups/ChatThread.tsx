'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { useKeyShortcut } from '@/components/app/QuickModal';
import type { ChatDto, GroupsPerson, LabelDto, MemberDto, MessageDto, PropertyDef, QuickReply } from '@/lib/groups';
import type { ProviderCaps } from '@/lib/groups-provider';
import { useGroupsInbox } from './InboxShell';
import ChatDetails from './ChatDetails';
import TaskModal from './TaskModal';
import { ChatPlate, Modal, api, useErrorText, useMediaText, useToast } from './ui';

const QUICK_EMOJIS = ['👍', '❤️', '😂', '🙏', '✅'];

export interface ThreadProps {
  chat: ChatDto;
  messages: MessageDto[];
  members: MemberDto[];
  people: GroupsPerson[];
  labels: LabelDto[];
  quickReplies: QuickReply[];
  properties: PropertyDef[];
  agents: Array<{ id: string; name: string }>;
  crm: { contact: { id: string; name: string } | null; company: { id: string; name: string } | null };
  me: string;
  numberName: string;
  caps: ProviderCaps;
  ticketEmoji: string;
}

function dayKey(iso: string) {
  return iso.slice(0, 10);
}

/**
 * Un chat o grupo: mensajes, composer (respuesta o nota interna) y el panel
 * de detalles. Trae lo nuevo cada 4 s. Teclado: R responder, N nota,
 * E cerrar o reabrir, A asignarme, T ticket del último mensaje del cliente.
 */
export default function ChatThread(props: ThreadProps) {
  const t = useTranslations('groups');
  const locale = useLocale();
  const errText = useErrorText();
  const mediaText = useMediaText();
  const { refresh } = useGroupsInbox();
  const [toast, showToast] = useToast();
  const [chat, setChat] = useState(props.chat);
  const [messages, setMessages] = useState(props.messages);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'reply' | 'note'>('reply');
  const [replyTo, setReplyTo] = useState<MessageDto | null>(null);
  const [attachment, setAttachment] = useState<{ url: string; mimetype: string; filename: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sendError, setSendError] = useState('');
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [summary, setSummary] = useState<{ text: string; error: string; busy: boolean } | null>(null);
  const [schedule, setSchedule] = useState<{ open: boolean; at: string; busy: boolean; error: string }>({ open: false, at: '', busy: false, error: '' });
  const [ticketFor, setTicketFor] = useState<MessageDto | null>(null);
  const [ticketTitle, setTicketTitle] = useState('');
  const [ticketPriority, setTicketPriority] = useState('medium');
  const [ticketBusy, setTicketBusy] = useState(false);
  const [taskFor, setTaskFor] = useState<MessageDto | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const peopleById = useMemo(() => new Map(props.people.map((p) => [p.id, p.name || p.email])), [props.people]);
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);

  // Abrir el chat lo marca leído.
  useEffect(() => {
    if (props.chat.unread > 0) void api(`/api/groups/chats/${props.chat.id}`, { method: 'PATCH', body: { read: true } }).then(() => refresh());
  }, [props.chat.id, props.chat.unread, refresh]);

  // Con #m-<id> (Cmd+K, tickets) va a ese mensaje y lo marca; si no, al final.
  const jumped = useRef(false);
  useEffect(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash.slice(1) : '';
    const target = !jumped.current && hash.startsWith('m-') ? document.getElementById(hash) : null;
    if (target) {
      jumped.current = true;
      target.scrollIntoView({ block: 'center' });
      target.classList.add('is-target');
      return;
    }
    jumped.current = true;
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  const merge = useCallback((incoming: MessageDto[]) => {
    if (incoming.length === 0) return;
    setMessages((prev) => {
      const map = new Map(prev.map((m) => [m.id, m]));
      for (const m of incoming) map.set(m.id, m);
      return [...map.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    });
  }, []);

  // Cada 4 s, los últimos 60: lo nuevo y los cambios en lo reciente (estado, reacciones, ticket por emoji).
  useEffect(() => {
    const id = setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      const res = await api<{ messages: MessageDto[] }>(`/api/groups/chats/${chat.id}/messages?limit=60`);
      if (res.data) merge(res.data.messages);
    }, 4000);
    return () => clearInterval(id);
  }, [chat.id, merge]);

  const patchChat = useCallback(
    async (body: Record<string, unknown>) => {
      const res = await api<ChatDto>(`/api/groups/chats/${chat.id}`, { method: 'PATCH', body });
      if (res.data) {
        setChat(res.data);
        refresh();
      } else showToast(errText(res.error), true);
      return res.data;
    },
    [chat.id, refresh, showToast, errText],
  );

  // "/" al principio abre las respuestas rápidas.
  const slash = /^\/([a-z0-9_-]*)$/i.exec(text.trim());
  const quickMatches = slash ? props.quickReplies.filter((q) => q.shortcut.startsWith(slash[1].toLowerCase())).slice(0, 6) : [];

  async function send() {
    if (sending || (!text.trim() && !attachment)) return;
    setSending(true);
    setSendError('');
    const res = await api<MessageDto>(`/api/groups/chats/${chat.id}/messages`, {
      body: { body: text, note: mode === 'note', replyToId: replyTo?.id ?? null, media: mode === 'note' ? null : attachment },
    });
    setSending(false);
    if (!res.data) {
      setSendError(errText(res.error));
      return;
    }
    merge([res.data]);
    if (res.data.status === 'failed') setSendError(errText(res.data.error || 'send_failed'));
    // Respondido: el chat deja de esperar (el servidor ya lo marcó).
    else if (mode === 'reply') setChat((c) => ({ ...c, awaitingSince: null, flagged: false }));
    setText('');
    setReplyTo(null);
    setAttachment(null);
    refresh();
    inputRef.current?.focus();
  }

  function onComposerKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (quickMatches.length > 0 && (e.key === 'Enter' || e.key === 'Tab')) {
      e.preventDefault();
      setText(quickMatches[0].body);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
    if (e.key === 'Escape') {
      if (replyTo) setReplyTo(null);
      else (e.target as HTMLTextAreaElement).blur();
    }
  }

  async function upload(file: File) {
    setUploading(true);
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetch('/api/groups/upload', { method: 'POST', body: form });
      const data = (await res.json().catch(() => ({}))) as { url?: string; mimetype?: string; filename?: string; error?: string };
      if (!res.ok || !data.url) setSendError(errText(data.error ?? 'upload_failed'));
      else setAttachment({ url: data.url, mimetype: data.mimetype ?? file.type, filename: data.filename ?? file.name });
    } finally {
      setUploading(false);
    }
  }

  async function react(m: MessageDto, emoji: string) {
    setPickerFor(null);
    const mine = m.reactions.find((r) => r.fromMe && r.emoji === emoji);
    const res = await api<MessageDto>(`/api/groups/messages/${m.id}`, { body: { action: 'react', emoji: mine ? '' : emoji } });
    if (res.data) {
      merge([res.data]);
      if (!mine && emoji === props.ticketEmoji) showToast(t('thread.ticketByReaction'));
    } else showToast(errText(res.error), true);
  }

  function openTicket(m: MessageDto) {
    setTicketFor(m);
    setTicketTitle((m.body.split('\n').find((l) => l.trim()) ?? '').slice(0, 120));
    setTicketPriority('medium');
  }

  async function createTicket() {
    if (!ticketFor) return;
    setTicketBusy(true);
    const res = await api<{ ticket: { id: string; number: number }; created: boolean }>(`/api/groups/messages/${ticketFor.id}`, {
      body: { action: 'ticket', title: ticketTitle, priority: ticketPriority },
    });
    setTicketBusy(false);
    if (!res.data) {
      showToast(errText(res.error), true);
      return;
    }
    merge([{ ...ticketFor, ticketId: res.data.ticket.id }]);
    setTicketFor(null);
    showToast(res.data.created ? t('thread.ticketCreated', { n: res.data.ticket.number }) : t('thread.ticketExists', { n: res.data.ticket.number }));
  }

  async function summarize() {
    setSummary({ text: '', error: '', busy: true });
    const res = await api<{ summary: string }>(`/api/groups/chats/${chat.id}/summary`, { body: { days: 7, locale } });
    setSummary({ text: res.data?.summary ?? '', error: res.error ? errText(res.error) : '', busy: false });
  }

  async function scheduleSend() {
    if (!text.trim()) {
      setSchedule((s) => ({ ...s, error: errText('empty_message') }));
      return;
    }
    const when = Date.parse(schedule.at);
    if (!Number.isFinite(when) || when < Date.now()) {
      setSchedule((s) => ({ ...s, error: errText('invalid_date') }));
      return;
    }
    setSchedule((s) => ({ ...s, busy: true, error: '' }));
    const res = await api('/api/groups/broadcasts', {
      body: { chatIds: [chat.id], body: text, media: attachment, scheduledAt: new Date(when).toISOString(), kind: 'scheduled' },
    });
    if (!res.data) {
      setSchedule((s) => ({ ...s, busy: false, error: errText(res.error) }));
      return;
    }
    setSchedule({ open: false, at: '', busy: false, error: '' });
    setText('');
    setAttachment(null);
    showToast(t('thread.scheduled', { when: new Date(when).toLocaleString(locale) }));
  }

  useKeyShortcut('r', () => {
    setMode('reply');
    inputRef.current?.focus();
  });
  useKeyShortcut('n', () => {
    setMode('note');
    inputRef.current?.focus();
  });
  useKeyShortcut('e', () => void patchChat({ status: chat.status === 'open' ? 'closed' : 'open' }));
  useKeyShortcut('a', () => void patchChat({ assignedTo: chat.assignedTo === props.me ? null : props.me }));
  useKeyShortcut('t', () => {
    const last = [...messages].reverse().find((m) => m.direction === 'in');
    if (last) openTicket(last);
  });

  let prevDay = '';

  return (
    <>
      <section className="gr-thread" aria-label={chat.name}>
        <header className="gr-thread-head">
          <Link href="/app/groups/inbox" className="btn btn-ghost btn-sm gr-back">
            {t('thread.back')}
          </Link>
          <ChatPlate name={chat.name} kind={chat.kind} />
          <div className="gr-thread-title">
            <h2>{chat.name}</h2>
            <p className="ui-help">
              {chat.kind === 'group' ? t('thread.groupMeta', { n: chat.memberCount }) : `+${chat.phone}`} · {props.numberName}
            </p>
          </div>
          <div className="gr-thread-actions">
            <select
              className="select"
              value={chat.assignedTo ?? ''}
              onChange={(e) => void patchChat({ assignedTo: e.target.value || null })}
              aria-label={t('thread.assignee')}
            >
              <option value="">{t('thread.unassigned')}</option>
              {props.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name || p.email}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void summarize()} aria-busy={summary?.busy || undefined}>
              {t('thread.summary')}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void patchChat({ status: chat.status === 'open' ? 'closed' : 'open' })}>
              {chat.status === 'open' ? t('thread.close') : t('thread.reopen')} <kbd className="kbd">E</kbd>
            </button>
            <button type="button" className="btn btn-ghost btn-sm gr-details-toggle" onClick={() => setDetailsOpen((v) => !v)} aria-expanded={detailsOpen}>
              {t('thread.details')}
            </button>
          </div>
        </header>

        {(chat.flagged || chat.awaitingSince) && (
          <div className={`gr-banner${chat.flagged ? ' is-bad' : ''}`} role="status">
            {chat.flagged ? t('thread.flaggedBanner') : t('thread.waitingBanner')}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void patchChat({ flagged: false })}>
              {t('thread.clearFlag')}
            </button>
          </div>
        )}

        {summary && (
          <div className="gr-summary" role="region" aria-label={t('thread.summary')}>
            <div className="gr-summary-head">
              <strong>{t('thread.summaryTitle')}</strong>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSummary(null)} aria-label={t('common.close')}>
                ×
              </button>
            </div>
            {summary.busy ? <p className="ui-help">{t('thread.summaryBusy')}</p> : summary.error ? <p className="ui-error">{summary.error}</p> : <p className="gr-pre">{summary.text}</p>}
          </div>
        )}

        <div className="gr-messages" role="log" aria-live="polite">
          {messages.length === 0 && <p className="gr-list-empty">{t('thread.noMessages')}</p>}
          {messages.map((m) => {
            const day = dayKey(m.createdAt);
            const showDay = day !== prevDay;
            prevDay = day;
            const quoted = m.replyToId ? byId.get(m.replyToId) : null;
            const author =
              m.direction === 'in'
                ? chat.kind === 'group'
                  ? m.senderName || (m.senderPhone ? `+${m.senderPhone}` : '')
                  : ''
                : m.authorKind === 'agent'
                  ? t('thread.byAgent')
                  : m.authorKind === 'phone'
                    ? t('thread.byPhone')
                    : m.authorKind === 'broadcast'
                      ? t('thread.byBroadcast')
                      : m.authorKind === 'scheduled'
                        ? t('thread.byScheduled')
                      : m.authorKind === 'flow'
                        ? 'Flow'
                        : m.authorKind === 'api'
                          ? 'API'
                          : m.authorId
                            ? peopleById.get(m.authorId) ?? ''
                            : '';
            return (
              <div key={m.id}>
                {showDay && <p className="gr-day">{new Date(m.createdAt).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })}</p>}
                <article className={`gr-msg gr-msg-${m.direction}`} id={`m-${m.id}`}>
                  <div className="gr-bubble">
                    {(author || m.direction === 'note') && (
                      <p className="gr-msg-author">
                        {m.direction === 'note' ? t('thread.noteBy', { name: author || '' }) : author}
                      </p>
                    )}
                    {quoted && <p className="gr-quote">{quoted.body.slice(0, 140) || mediaText({ media: quoted.media })}</p>}
                    {m.media && (
                      <p className="gr-media">
                        {m.media.url && m.media.type.startsWith('image/') ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={m.media.url} alt={m.media.name || t('thread.image')} loading="lazy" />
                        ) : m.media.url ? (
                          <a href={m.media.url} target="_blank" rel="noreferrer">
                            {mediaText({ media: m.media })}
                          </a>
                        ) : (
                          <span className="ui-help">{mediaText({ media: m.media })}</span>
                        )}
                      </p>
                    )}
                    {m.body && <p className="gr-pre">{m.body}</p>}
                    <p className="gr-msg-foot">
                      <time dateTime={m.createdAt}>{new Date(m.createdAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</time>
                      {m.direction === 'out' && <span className={m.status === 'failed' ? 'gr-failed' : ''}>{t(`status.${m.status}`)}</span>}
                      {m.ticketId && (
                        <Link href={`/app/groups/tickets?open=${m.ticketId}`} className="gr-ticket-tag">
                          {t('thread.hasTicket')}
                        </Link>
                      )}
                      {m.direction === 'in' && m.needsReply === true && <span className="gr-question-tag">{t('thread.question')}</span>}
                    </p>
                    {m.reactions.length > 0 && (
                      <p className="gr-reactions" aria-label={t('thread.reactions')}>
                        {m.reactions.map((r, i) => (
                          <span key={`${r.by}-${i}`}>{r.emoji}</span>
                        ))}
                      </p>
                    )}
                  </div>
                  {m.direction !== 'note' && m.direction !== 'system' && (
                    <div className="gr-msg-actions">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setReplyTo(m); setMode('reply'); inputRef.current?.focus(); }}>
                        {t('thread.reply')}
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPickerFor(pickerFor === m.id ? null : m.id)} aria-expanded={pickerFor === m.id}>
                        {t('thread.react')}
                      </button>
                      {!m.ticketId && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => openTicket(m)}>
                          {t('thread.ticket')}
                        </button>
                      )}
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTaskFor(m)}>
                        {t('thread.task')}
                      </button>
                      {pickerFor === m.id && (
                        <span className="gr-emoji-picker" role="group" aria-label={t('thread.react')}>
                          {[...new Set([...QUICK_EMOJIS, props.ticketEmoji].filter(Boolean))].map((e) => (
                            <button key={e} type="button" className="btn btn-ghost btn-sm" onClick={() => void react(m, e)} aria-label={e === props.ticketEmoji ? t('thread.reactTicket', { emoji: e }) : e}>
                              {e}
                            </button>
                          ))}
                        </span>
                      )}
                    </div>
                  )}
                </article>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>

        <div className={`gr-composer${mode === 'note' ? ' is-note' : ''}`}>
          <div className="gr-composer-tabs ui-tabs" role="tablist">
            <button type="button" role="tab" className="ui-tab" aria-selected={mode === 'reply'} onClick={() => setMode('reply')}>
              {t('thread.modeReply')} <kbd className="kbd">R</kbd>
            </button>
            <button type="button" role="tab" className="ui-tab" aria-selected={mode === 'note'} onClick={() => setMode('note')}>
              {t('thread.modeNote')} <kbd className="kbd">N</kbd>
            </button>
          </div>
          {replyTo && (
            <p className="gr-replying">
              {t('thread.replyingTo')} <span>{replyTo.body.slice(0, 80) || mediaText({ media: replyTo.media })}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReplyTo(null)}>
                {t('common.cancel')}
              </button>
            </p>
          )}
          {quickMatches.length > 0 && (
            <ul className="gr-quick" role="listbox" aria-label={t('thread.quickReplies')}>
              {quickMatches.map((q, i) => (
                <li key={q.id} role="option" aria-selected={i === 0}>
                  <button type="button" onClick={() => { setText(q.body); inputRef.current?.focus(); }}>
                    <strong>/{q.shortcut}</strong> {q.body.slice(0, 80)}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <textarea
            ref={inputRef}
            className="textarea gr-input"
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onComposerKey}
            placeholder={mode === 'note' ? t('thread.notePlaceholder') : t('thread.replyPlaceholder')}
            aria-label={mode === 'note' ? t('thread.modeNote') : t('thread.modeReply')}
          />
          {attachment && (
            <p className="gr-attachment">
              {attachment.filename}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAttachment(null)}>
                {t('common.remove')}
              </button>
            </p>
          )}
          {sendError && (
            <p className="ui-error" role="alert">
              {sendError}
            </p>
          )}
          <div className="gr-composer-foot">
            {mode === 'reply' && (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void upload(f);
                    e.target.value = '';
                  }}
                />
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()} aria-busy={uploading || undefined}>
                  {t('thread.attach')}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSchedule({ open: true, at: '', busy: false, error: '' })}>
                  {t('thread.schedule')}
                </button>
              </>
            )}
            <span className="ui-help gr-composer-hint">{t('thread.hint')}</span>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void send()} disabled={sending || (!text.trim() && !attachment)} aria-busy={sending || undefined}>
              {mode === 'note' ? t('thread.saveNote') : t('thread.send')}
            </button>
          </div>
        </div>
      </section>

      <aside className={`gr-details${detailsOpen ? ' is-open' : ''}`} aria-label={t('thread.details')}>
        <ChatDetails
          chat={chat}
          onChange={setChat}
          members={props.members}
          people={props.people}
          labels={props.labels}
          properties={props.properties}
          agents={props.agents}
          crm={props.crm}
          caps={props.caps}
          me={props.me}
          compact
        />
      </aside>

      <TaskModal
        open={!!taskFor}
        chatId={chat.id}
        message={taskFor}
        people={props.people}
        me={props.me}
        onClose={() => setTaskFor(null)}
        onCreated={() => {
          setTaskFor(null);
          showToast(t('tasks.created'));
        }}
      />

      <Modal
        open={!!ticketFor}
        title={t('thread.ticketTitle')}
        onClose={() => setTicketFor(null)}
        onSubmit={() => void createTicket()}
        busy={ticketBusy}
        foot={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setTicketFor(null)}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary" aria-busy={ticketBusy || undefined}>
              {t('thread.ticketCreate')}
            </button>
          </>
        }
      >
        <div className="ui-fields">
          {ticketFor?.body && <p className="gr-quote">{ticketFor.body.slice(0, 280)}</p>}
          <label className="ui-field">
            <span className="label">{t('tickets.title')}</span>
            <input className="input" value={ticketTitle} onChange={(e) => setTicketTitle(e.target.value)} maxLength={200} autoFocus />
          </label>
          <label className="ui-field">
            <span className="label">{t('tickets.priority')}</span>
            <select className="select" value={ticketPriority} onChange={(e) => setTicketPriority(e.target.value)}>
              {['low', 'medium', 'high', 'urgent'].map((p) => (
                <option key={p} value={p}>
                  {t(`priority.${p}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Modal>

      <Modal
        open={schedule.open}
        title={t('thread.scheduleTitle')}
        onClose={() => setSchedule((s) => ({ ...s, open: false }))}
        onSubmit={() => void scheduleSend()}
        busy={schedule.busy}
        foot={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setSchedule((s) => ({ ...s, open: false }))}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary" aria-busy={schedule.busy || undefined}>
              {t('thread.scheduleConfirm')}
            </button>
          </>
        }
      >
        <div className="ui-fields">
          <p className="ui-help">{text.trim() ? text.slice(0, 200) : t('thread.scheduleNeedsText')}</p>
          <label className="ui-field">
            <span className="label">{t('thread.scheduleAt')}</span>
            <input className="input" type="datetime-local" value={schedule.at} onChange={(e) => setSchedule((s) => ({ ...s, at: e.target.value }))} autoFocus required />
          </label>
          {schedule.error && (
            <p className="ui-error" role="alert">
              {schedule.error}
            </p>
          )}
        </div>
      </Modal>
      {toast}
    </>
  );
}
