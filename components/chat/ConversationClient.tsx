'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { useKeyShortcut } from '@/components/app/QuickModal';
import { useTranslations, useLocale } from 'next-intl';
import type {
  ChatAgent,
  ChatAttachment,
  ChatCannedResponseRow,
  ChatConversationWithVisitor,
  ChatConversationListRow,
  ChatMessageWithUser,
  ConversationUpdatePayload,
} from '@/lib/chat-data';
import { formatTimeAgo, formatDateTime } from '@/lib/datetime';
import { CHAT_MESSAGE_MAX, CHAT_UPLOAD_MAX, sendErrorKey } from '@/lib/chat-schema';
import ConversationList from './ConversationList';
import VisitorPanel from './VisitorPanel';

interface CurrentUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
}

interface ConversationClientProps {
  conversationId: string;
  initialConversation: ChatConversationWithVisitor;
  initialMessages: ChatMessageWithUser[];
  agents: ChatAgent[];
  currentUser: CurrentUser;
}

function initials(name: string | null, email: string | null): string {
  const base = (name || email || '?').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim() || '?';
  const parts = base.split(/\s+/);
  if (parts.length > 1) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

function senderName(
  m: ChatMessageWithUser,
  visitor: ChatConversationWithVisitor['visitor'],
  currentUser: CurrentUser,
  t: (k: string) => string,
): string {
  if (m.sender_type === 'visitor') return visitor.name || visitor.email || visitor.external_id;
  if (m.sender_type === 'system') return t('conversation.system');
  if (m.sender_type === 'bot') return t('conversation.bot');
  if (m.user_id === currentUser.id) return t('conversation.you');
  return m.user_name || m.user_email || t('conversation.you');
}

const SNOOZE_OPTIONS = [
  { value: 60 * 60 * 1000, key: '1h' },
  { value: 4 * 60 * 60 * 1000, key: '4h' },
  { value: 24 * 60 * 60 * 1000, key: '24h' },
  { value: 3 * 24 * 60 * 60 * 1000, key: '3d' },
  { value: 7 * 24 * 60 * 60 * 1000, key: '7d' },
] as const;

function formatBytes(n: number): string {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / 1024 ** i).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function attachmentType(mime: string): ChatAttachment['type'] {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

export default function ConversationClient({
  conversationId,
  initialConversation,
  initialMessages,
  agents,
  currentUser,
}: ConversationClientProps) {
  const t = useTranslations('chat');
  const locale = useLocale();

  const [conversation, setConversation] = useState<ChatConversationWithVisitor>(initialConversation);
  const [messages, setMessages] = useState<ChatMessageWithUser[]>(initialMessages);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  /** Error del último envío (aria-live): antes un rechazo del servidor no avisaba nada. */
  const [sendError, setSendError] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [listRows, setListRows] = useState<ChatConversationListRow[] | null>(null);
  const router = useRouter();
  const [canned, setCanned] = useState<ChatCannedResponseRow[]>([]);
  const [cannedIndex, setCannedIndex] = useState(0);
  const [visitorTyping, setVisitorTyping] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const lastMessageId = useRef<string | null>(null);
  const typingSentAt = useRef<number>(0);
  // Composer: respuesta al visitante o nota interna (solo agentes).
  const [mode, setMode] = useState<'reply' | 'note'>('reply');
  const [mentions, setMentions] = useState<string[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [macroApplied, setMacroApplied] = useState<string | null>(null);

  async function fetchTags() {
    try {
      const res = await fetch(`/api/chat/conversations/${conversationId}/tags`);
      if (!res.ok) return;
      const data = (await res.json()) as { tags: string[] };
      setTags(data.tags);
    } catch {
      // ignore
    }
  }

  async function addTag(raw: string) {
    const tag = raw.trim();
    if (!tag) return;
    const res = await fetch(`/api/chat/conversations/${conversationId}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag }),
    });
    if (res.ok) {
      setTags(((await res.json()) as { tags: string[] }).tags);
      setTagInput('');
      fetchList();
    }
  }

  async function removeTag(tag: string) {
    setTags((prev) => prev.filter((x) => x !== tag));
    await fetch(`/api/chat/conversations/${conversationId}/tags?tag=${encodeURIComponent(tag)}`, { method: 'DELETE' }).catch(() => {});
    fetchList();
  }

  async function fetchMessages() {
    try {
      const res = await fetch(`/api/chat/conversations/${conversationId}/messages`);
      if (!res.ok) return;
      const data = (await res.json()) as { messages: ChatMessageWithUser[] };
      setMessages(data.messages);
    } catch {
      // ignore polling errors
    }
  }

  // Estado, asignación y prioridad pueden cambiarlos otros agentes (o una
  // respuesta que reabre la conversación): se refrescan junto con el hilo.
  async function fetchConversation() {
    try {
      const res = await fetch(`/api/chat/conversations/${conversationId}`);
      if (!res.ok) return;
      const data = (await res.json()) as Partial<ChatConversationWithVisitor>;
      setConversation((prev) => ({ ...prev, ...data }));
    } catch {
      // ignore polling errors
    }
  }

  async function fetchList() {
    try {
      // Todas las conversaciones del workspace (como el inbox), no solo las
      // del widget de esta conversación.
      const params = new URLSearchParams({ limit: '50' });
      const res = await fetch(`/api/chat/conversations?${params.toString()}`);
      if (!res.ok) return;
      const data = (await res.json()) as { rows: ChatConversationListRow[] };
      setListRows(data.rows);
    } catch {
      // ignore
    }
  }

  async function fetchCanned() {
    try {
      const res = await fetch(`/api/chat/widgets/${conversation.widget_id}/canned`);
      if (!res.ok) return;
      const data = (await res.json()) as { responses: ChatCannedResponseRow[] };
      setCanned(data.responses);
    } catch {
      // ignore
    }
  }

  async function markRead() {
    try {
      const res = await fetch(`/api/chat/conversations/${conversationId}/read`, { method: 'POST' });
      if (!res.ok) return;
      const data = (await res.json()) as { messages: ChatMessageWithUser[] };
      setMessages(data.messages);
    } catch {
      // ignore
    }
  }

  async function fetchTyping() {
    try {
      const res = await fetch(`/api/chat/conversations/${conversationId}/typing`);
      if (!res.ok) return;
      const data = (await res.json()) as { typing: Array<{ sender_type: 'visitor' | 'user' }> };
      setVisitorTyping(data.typing.some((t) => t.sender_type === 'visitor'));
    } catch {
      // ignore
    }
  }

  async function sendTyping() {
    const now = Date.now();
    if (now - typingSentAt.current < 2000) return;
    typingSentAt.current = now;
    try {
      await fetch(`/api/chat/conversations/${conversationId}/typing`, { method: 'POST' });
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    fetchMessages();
    fetchList();
    fetchCanned();
    fetchTags();
    markRead();
    let tick = 0;
    const interval = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      fetchMessages();
      fetchTyping();
      fetchConversation();
      tick += 1;
      if (tick % 5 === 0) fetchList();
    }, 3000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // Bajar al último mensaje solo cuando llega uno nuevo, y scrolleando el
  // contenedor del hilo (scrollIntoView movía toda la página y además se
  // disparaba en cada poll de 3 s aunque no hubiera nada nuevo).
  useEffect(() => {
    const last = messages[messages.length - 1]?.id ?? null;
    if (last === lastMessageId.current) return;
    const first = lastMessageId.current === null;
    lastMessageId.current = last;
    const el = messagesRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: first ? 'auto' : 'smooth' });
  }, [messages]);

  // J / K: conversación siguiente / anterior de la lista (como Intercom).
  function step(delta: 1 | -1) {
    if (!listRows || listRows.length === 0) return;
    const index = listRows.findIndex((c) => c.id === conversationId);
    const next = listRows[index < 0 ? 0 : index + delta];
    if (next) router.push(`/app/chat/inbox/${next.id}`);
  }
  useKeyShortcut('j', () => step(1));
  useKeyShortcut('k', () => step(-1));

  async function updateConversation(payload: ConversationUpdatePayload) {
    const res = await fetch(`/api/chat/conversations/${conversationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return;
    const updated = (await res.json()) as ChatConversationWithVisitor;
    setConversation((prev) => ({ ...prev, ...updated }));
    fetchList();
  }

  async function sendReply() {
    const body = reply.trim();
    if ((!body && !selectedFile) || sending) return;
    const tooBig = selectedFile && mode === 'reply' && selectedFile.size > CHAT_UPLOAD_MAX;
    if (tooBig || body.length > CHAT_MESSAGE_MAX) {
      setSendError(t(tooBig ? 'errors.fileTooLarge' : 'errors.messageTooLong'));
      return;
    }
    setSendError(null);
    setSending(true);
    const fail = async (res: Response) => {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setSendError(t(sendErrorKey(data.error)));
    };
    try {
      if (selectedFile && mode === 'reply') {
        const formData = new FormData();
        formData.append('file', selectedFile);
        if (body) formData.append('body', body);
        const res = await fetch(`/api/chat/conversations/${conversationId}/attachments`, {
          method: 'POST',
          body: formData,
        });
        if (res.ok) {
          setReply('');
          setSelectedFile(null);
          if (fileInputRef.current) fileInputRef.current.value = '';
          await fetchMessages();
          await fetchList();
          await fetchConversation();
        } else {
          await fail(res);
        }
      } else {
        const isNote = mode === 'note';
        const res = await fetch(`/api/chat/conversations/${conversationId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(isNote ? { body, note: true, mentions } : { body }),
        });
        if (res.ok) {
          setReply('');
          setMentions([]);
          await fetchMessages();
          await fetchList();
          if (!isNote) await fetchConversation();
        } else {
          await fail(res);
        }
      }
    } catch {
      setSendError(t('errors.generic'));
    } finally {
      setSending(false);
    }
  }

  function toggleResolved() {
    const next = conversation.status === 'resolved' ? 'open' : 'resolved';
    updateConversation({ status: next });
  }

  function changeStatus(status: string) {
    if (status === 'snoozed') {
      // Default 24h; el picker de duración permite ajustar.
      updateConversation({ status: 'snoozed', snoozedUntil: snoozeUntilFor(24 * 60 * 60 * 1000) });
      return;
    }
    updateConversation({ status: status as ConversationUpdatePayload['status'] });
  }

  function snoozeUntilFor(ms: number): string {
    return new Date(Date.now() + ms).toISOString();
  }

  const visitor = conversation.visitor;
  const isResolved = conversation.status === 'resolved';

  const pickerQuery = useMemo(() => {
    const match = reply.match(/\/([^\s]*)$/);
    return match ? match[1].toLowerCase() : null;
  }, [reply]);

  const pickerMatches = useMemo(() => {
    if (pickerQuery === null) return [];
    return canned.filter(
      (r) =>
        r.shortcut.toLowerCase().includes(pickerQuery) ||
        r.title.toLowerCase().includes(pickerQuery),
    );
  }, [pickerQuery, canned]);

  const pickerOpen = pickerMatches.length > 0;

  // @menciones (solo en notas internas): agentes del workspace.
  const mentionQuery = useMemo(() => {
    if (mode !== 'note') return null;
    const match = reply.match(/(?:^|\s)@([^\s@]*)$/);
    return match ? match[1].toLowerCase() : null;
  }, [reply, mode]);
  const mentionMatches = useMemo(() => {
    if (mentionQuery === null) return [];
    return agents
      .filter((a) => a.id !== currentUser.id)
      .filter((a) => (a.name ?? '').toLowerCase().includes(mentionQuery) || a.email.toLowerCase().includes(mentionQuery))
      .slice(0, 6);
  }, [mentionQuery, agents, currentUser.id]);
  const mentionOpen = mentionMatches.length > 0;

  function insertMention(agent: ChatAgent) {
    const label = agent.name || agent.email;
    setReply((prev) => prev.replace(/@([^\s@]*)$/, `@${label} `));
    setMentions((prev) => (prev.includes(agent.id) ? prev : [...prev, agent.id]));
    setMentionIndex(0);
  }

  async function insertCanned(response: ChatCannedResponseRow) {
    const before = reply.slice(0, reply.lastIndexOf('/'));
    setReply((before + response.body).trimStart() + ' ');
    setCannedIndex(0);
    // Macro: si la respuesta guardada tiene acciones, se aplican ya.
    let hasActions = false;
    try {
      const a = JSON.parse(response.actions || '{}') as Record<string, unknown>;
      hasActions = Object.keys(a).length > 0;
    } catch {
      hasActions = false;
    }
    if (!hasActions) return;
    const res = await fetch(`/api/chat/conversations/${conversationId}/macro`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cannedId: response.id }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { conversation: ChatConversationWithVisitor | null; tags: string[] };
    if (data.conversation) {
      const next = data.conversation;
      setConversation((prev) => ({ ...prev, ...next }));
    }
    setTags(data.tags);
    setMacroApplied(response.shortcut);
    setTimeout(() => setMacroApplied(null), 3000);
    fetchList();
  }

  function handleComposerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % mentionMatches.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + mentionMatches.length) % mentionMatches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(mentionMatches[Math.min(mentionIndex, mentionMatches.length - 1)]);
        return;
      }
    }
    if (pickerOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCannedIndex((i) => (i + 1) % pickerMatches.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCannedIndex((i) => (i - 1 + pickerMatches.length) % pickerMatches.length);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        insertCanned(pickerMatches[cannedIndex]);
        return;
      }
      if (e.key === 'Escape') {
        setReply((prev) => prev.replace(/\/[^\s]*$/, ''));
        setCannedIndex(0);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendReply();
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
  }

  function clearSelectedFile() {
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    <div className="chat-conversation-layout">
      <button
        type="button"
        className="chat-list-toggle"
        onClick={() => setListOpen((v) => !v)}
        aria-expanded={listOpen}
      >
        {listOpen ? '‹' : '›'} {t('sidebar.inbox')}
      </button>

      <div className={`chat-conversation-list-pane${listOpen ? ' open' : ''}`}>
        {listRows ? (
          <ConversationList conversations={listRows} currentId={conversationId} />
        ) : (
          <p className="muted chat-inbox-loading mono">{t('common.loading')}</p>
        )}
      </div>

      <div className="chat-conversation-thread-pane">
        <header className="chat-conversation-header">
          <div className="chat-conversation-header-main">
            <Link href="/app/chat/inbox" className="chat-back-link">‹ {t('sidebar.inbox')}</Link>
            <div className="chat-conversation-header-visitor">
              <span className="chat-conversation-header-name">
                {visitor.name || visitor.email || visitor.external_id}
              </span>
              {visitor.email && visitor.name && (
                <span className="chat-conversation-header-email mono muted">{visitor.email}</span>
              )}
              <span className={`chat-status chat-status-${conversation.status}`}>
                {t(`conversation.${conversation.status}`)}
              </span>
              {conversation.sla_breached === 1 ? (
                <span className="chat-sla-badge chat-sla-breached">
                  {conversation.sla_breach_kind === 'resolution'
                    ? t('sla.breachedResolution')
                    : t('sla.breachedFirst')}
                </span>
              ) : conversation.resolved_at ? null : conversation.sla_due_in_minutes != null ? (
                <span className="chat-sla-badge chat-sla-due">
                  {t('sla.dueIn', { minutes: conversation.sla_due_in_minutes })}
                </span>
              ) : null}
            </div>
          </div>

          <div className="chat-conversation-header-actions">
            <div className="chat-header-field">
              <label className="mono muted">{t('conversation.statusLabel')}</label>
              <select
                className="select chat-header-select"
                value={conversation.status}
                onChange={(e) => changeStatus(e.target.value)}
              >
                {(['open', 'pending', 'snoozed', 'resolved'] as const).map((s) => (
                  <option key={s} value={s}>{t(`conversation.${s}`)}</option>
                ))}
              </select>
            </div>

            {conversation.status === 'snoozed' && (
              <div className="chat-header-field">
                <label className="mono muted">{t('conversation.snoozeUntil')}</label>
                <select
                  className="select chat-header-select"
                  value=""
                  onChange={(e) => {
                    const ms = Number(e.target.value);
                    if (ms > 0) {
                      updateConversation({ status: 'snoozed', snoozedUntil: snoozeUntilFor(ms) });
                    }
                  }}
                >
                  <option value="">
                    {conversation.snoozed_until
                      ? formatDateTime(conversation.snoozed_until, locale)
                      : '—'}
                  </option>
                  {SNOOZE_OPTIONS.map((opt) => (
                    <option key={opt.key} value={opt.value}>
                      {t(`conversation.snooze.${opt.key}`)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="chat-header-field">
              <label className="mono muted">{t('conversation.priority')}</label>
              <select
                className="select chat-header-select"
                value={conversation.priority}
                onChange={(e) =>
                  updateConversation({ priority: e.target.value as ConversationUpdatePayload['priority'] })
                }
              >
                {(['low', 'medium', 'high', 'urgent'] as const).map((p) => (
                  <option key={p} value={p}>{t(`priorities.${p}`)}</option>
                ))}
              </select>
            </div>

            <div className="chat-header-field">
              <label className="mono muted">{t('conversation.assignedTo')}</label>
              <select
                className="select chat-header-select"
                value={conversation.assigned_to ?? ''}
                onChange={(e) =>
                  updateConversation({ assignedTo: e.target.value || null })
                }
              >
                <option value="">{t('conversation.unassigned')}</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name || a.email}</option>
                ))}
              </select>
            </div>

            <button
              type="button"
              className={`btn btn-small${isResolved ? '' : ' btn-solid'}`}
              onClick={toggleResolved}
            >
              {isResolved ? t('conversation.reopen') : t('conversation.resolve')}
            </button>
          </div>
        </header>

        <div className="chat-tags-row">
          <span className="chat-tags-label mono muted">{t('tags.title')}</span>
          {tags.map((tag) => (
            <span key={tag} className="chat-tag mono">
              #{tag}
              <button type="button" onClick={() => removeTag(tag)} aria-label={t('tags.remove', { tag })}>
                ×
              </button>
            </span>
          ))}
          <input
            className="chat-tag-input mono"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                addTag(tagInput);
              }
            }}
            onBlur={() => {
              if (tagInput.trim()) addTag(tagInput);
            }}
            placeholder={t('tags.add')}
            aria-label={t('tags.add')}
            maxLength={40}
          />
          {macroApplied && <span className="chat-macro-applied mono muted">{t('macros.applied', { shortcut: macroApplied })}</span>}
        </div>

        <div className="chat-messages" ref={messagesRef}>
          {messages.length === 0 ? (
            <div className="chat-messages-empty">
              <p className="empty-zeros mono" aria-hidden>0 0 0</p>
              <p className="muted">{t('conversation.noMessages')}</p>
            </div>
          ) : (
            <ul className="chat-message-list">
              {messages.map((m) => {
                const isVisitor = m.sender_type === 'visitor';
                const name = senderName(m, visitor, currentUser, t);
                const attachments: ChatAttachment[] = (() => {
                  try {
                    const parsed = JSON.parse(m.attachments);
                    return Array.isArray(parsed) ? parsed : [];
                  } catch {
                    return [];
                  }
                })();
                return (
                  <li
                    key={m.id}
                    className={`chat-message${isVisitor ? ' visitor' : ' agent'}${m.sender_type === 'bot' ? ' bot' : ''}${m.is_note ? ' note' : ''}`}
                  >
                    <span className="chat-message-avatar">
                      {isVisitor
                        ? visitor.name || visitor.email
                          ? initials(visitor.name, visitor.email)
                          : '?'
                        : m.sender_type === 'user'
                          ? initials(m.user_name, m.user_email)
                          : initials(name, null)}
                    </span>
                    <div className="chat-message-body">
                      <div className="chat-message-meta">
                        <span className="chat-message-name">{name}</span>
                        {m.sender_type === 'bot' && (
                          <span className="chat-bot-badge mono">{t('conversation.botBadge')}</span>
                        )}
                        {m.is_note ? <span className="chat-note-label mono">{t('notes.label')}</span> : null}
                        <span className="chat-message-time mono muted" title={formatDateTime(m.created_at, locale)}>
                          {formatTimeAgo(m.created_at, locale)}
                        </span>
                      </div>
                      <div className="chat-message-bubble">
                        {m.body ? <p>{m.body}</p> : null}
                        {attachments.length > 0 && (
                          <div className="chat-message-attachments">
                            {attachments.map((a, idx) => {
                              const type = attachmentType(a.mime);
                              if (type === 'image') {
                                return (
                                  <a
                                    key={idx}
                                    href={a.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="chat-attachment-thumb"
                                  >
                                    {/* Adjunto subido (Blob o local): sin optimización de next/image. */}
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={a.url} alt={a.name} />
                                  </a>
                                );
                              }
                              if (type === 'audio') {
                                return (
                                  <div key={idx} className="chat-attachment-audio">
                                    <audio src={a.url} controls preload="metadata" />
                                  </div>
                                );
                              }
                              return (
                                <a
                                  key={idx}
                                  href={a.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="chat-attachment-file"
                                >
                                  <span>📎</span>
                                  <span>{a.name}</span>
                                  <span className="chat-attachment-size">({formatBytes(a.size)})</span>
                                </a>
                              );
                            })}
                          </div>
                        )}
                        {!isVisitor && !m.is_note && m.read_at && (
                          <span className="chat-read-receipt" title={formatDateTime(m.read_at, locale)}>
                            {t('read.read')}
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {visitorTyping && (
          <div className="chat-typing-indicator">
            <span className="chat-typing-dots"><span /><span /><span /></span>
            {t('typing.visitorTyping')}
          </div>
        )}

        {selectedFile && (
          <div className="chat-attachment-preview">
            <span>📎 {selectedFile.name} ({formatBytes(selectedFile.size)})</span>
            <button type="button" onClick={clearSelectedFile} aria-label={t('attachments.remove')}>×</button>
          </div>
        )}

        <div className="chat-composer-modes" role="tablist" aria-label={t('notes.mode')}>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'reply'}
            className={`chat-composer-mode${mode === 'reply' ? ' active' : ''}`}
            onClick={() => setMode('reply')}
          >
            {t('conversation.reply')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'note'}
            className={`chat-composer-mode${mode === 'note' ? ' active note' : ''}`}
            onClick={() => {
              setMode('note');
              clearSelectedFile();
            }}
          >
            {t('notes.label')}
          </button>
        </div>
        <div className={`chat-composer${mode === 'note' ? ' note' : ''}`}>
          {mode === 'reply' && (
            <button
              type="button"
              className="chat-composer-attach"
              onClick={() => fileInputRef.current?.click()}
              title={t('attachments.upload')}
            >
              ⊕
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            className="chat-composer-file-input"
            onChange={handleFileChange}
          />
          <div className="chat-composer-field">
            <textarea
              className="textarea chat-composer-input"
              placeholder={mode === 'note' ? t('notes.hint') : t('conversation.replyHint')}
              aria-label={t('conversation.reply')}
              value={reply}
              onChange={(e) => {
                setReply(e.target.value);
                setCannedIndex(0);
                sendTyping();
              }}
              onKeyDown={handleComposerKeyDown}
              rows={1}
            />
            {mentionOpen && (
              <ul className="chat-canned-picker">
                {mentionMatches.map((a, i) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      className={`chat-canned-picker-item${i === mentionIndex ? ' active' : ''}`}
                      onClick={() => insertMention(a)}
                    >
                      <span className="chat-canned-picker-title">{a.name || a.email}</span>
                      <span className="chat-canned-picker-shortcut mono">{a.email}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {pickerOpen && !mentionOpen && (
              <ul className="chat-canned-picker">
                {pickerMatches.map((r, i) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      className={`chat-canned-picker-item${i === cannedIndex ? ' active' : ''}`}
                      onClick={() => insertCanned(r)}
                    >
                      <span className="chat-canned-picker-shortcut mono">{r.shortcut}</span>
                      <span className="chat-canned-picker-title">{r.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            type="button"
            className="btn btn-solid btn-small chat-composer-send"
            onClick={sendReply}
            disabled={sending || (!reply.trim() && !selectedFile)}
          >
            {sending ? t('common.loading') : mode === 'note' ? t('notes.add') : t('conversation.send')}
          </button>
        </div>
        <p className="form-error chat-composer-error" role="alert" hidden={!sendError}>
          {sendError}
        </p>
      </div>

      <VisitorPanel conversation={conversation} />
    </div>
  );
}
