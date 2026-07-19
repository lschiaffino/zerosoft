'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '@/i18n/navigation';
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
  const base = name || email || '?';
  const parts = base.trim().split(/\s+/);
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
  if (m.user_id === currentUser.id) return t('conversation.you');
  return m.user_name || m.user_email || t('conversation.you');
}

function slaLabel(
  c: ChatConversationWithVisitor,
  t: (k: string, v?: Record<string, string | number>) => string,
) {
  if (c.resolved_at) return { label: t('sla.resolved'), className: 'chat-sla-resolved' };
  const deadline = new Date(c.created_at).getTime() + 60 * 60 * 1000;
  const now = Date.now();
  if (now > deadline) return { label: t('sla.breached'), className: 'chat-sla-breached' };
  const mins = Math.ceil((deadline - now) / 60_000);
  return { label: t('sla.dueIn', { minutes: mins }), className: 'chat-sla-due' };
}

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
  const [listOpen, setListOpen] = useState(false);
  const [listRows, setListRows] = useState<ChatConversationListRow[]>([]);
  const [canned, setCanned] = useState<ChatCannedResponseRow[]>([]);
  const [cannedIndex, setCannedIndex] = useState(0);
  const [visitorTyping, setVisitorTyping] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const typingSentAt = useRef<number>(0);

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

  async function fetchList() {
    try {
      const params = new URLSearchParams({
        widgetIds: conversation.widget_id,
        limit: '50',
      });
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
    markRead();
    const interval = setInterval(() => {
      fetchMessages();
      fetchTyping();
    }, 3000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function updateConversation(payload: ConversationUpdatePayload) {
    const res = await fetch(`/api/chat/conversations/${conversationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return;
    const updated = (await res.json()) as ChatConversationWithVisitor;
    setConversation((prev) => ({ ...prev, ...updated }));
  }

  async function sendReply() {
    const body = reply.trim();
    if ((!body && !selectedFile) || sending) return;
    setSending(true);
    try {
      if (selectedFile) {
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
        }
      } else {
        const res = await fetch(`/api/chat/conversations/${conversationId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body }),
        });
        if (res.ok) {
          setReply('');
          await fetchMessages();
          await fetchList();
        }
      }
    } finally {
      setSending(false);
    }
  }

  function toggleStatus() {
    const next = conversation.status === 'closed' ? 'open' : 'closed';
    updateConversation({ status: next });
  }

  const visitor = conversation.visitor;
  const isClosed = conversation.status === 'closed';

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

  function insertCanned(response: ChatCannedResponseRow) {
    const before = reply.slice(0, reply.lastIndexOf('/'));
    setReply((before + response.body).trimStart() + ' ');
    setCannedIndex(0);
  }

  function handleComposerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
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
        <ConversationList conversations={listRows} currentId={conversationId} />
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
              {(() => {
                const sla = slaLabel(conversation, t);
                return <span className={`chat-sla-badge ${sla.className}`}>{sla.label}</span>;
              })()}
            </div>
          </div>

          <div className="chat-conversation-header-actions">
            <div className="chat-header-field">
              <label className="mono muted">{t('conversation.priority')}</label>
              <select
                className="select chat-header-select"
                value={conversation.priority}
                onChange={(e) =>
                  updateConversation({ priority: e.target.value as ConversationUpdatePayload['priority'] })
                }
              >
                {(['low', 'normal', 'high', 'urgent'] as const).map((p) => (
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
              className={`btn btn-small${isClosed ? '' : ' btn-ghost'}`}
              onClick={toggleStatus}
            >
              {isClosed ? t('conversation.reopen') : t('conversation.close')}
            </button>
          </div>
        </header>

        <div className="chat-messages">
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
                    className={`chat-message${isVisitor ? ' visitor' : ' agent'}`}
                  >
                    <span className="chat-message-avatar">{initials(name, m.user_email)}</span>
                    <div className="chat-message-body">
                      <div className="chat-message-meta">
                        <span className="chat-message-name">{name}</span>
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
                        {!isVisitor && m.read_at && (
                          <span className="chat-read-receipt" title={formatDateTime(m.read_at, locale)}>
                            {t('read.read')}
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
              <div ref={threadEndRef} />
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
            <button type="button" onClick={clearSelectedFile} aria-label="Remove file">×</button>
          </div>
        )}

        <div className="chat-composer">
          <button
            type="button"
            className="chat-composer-attach"
            onClick={() => fileInputRef.current?.click()}
            title={t('attachments.upload')}
          >
            ⊕
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="chat-composer-file-input"
            onChange={handleFileChange}
          />
          <div className="chat-composer-field">
            <textarea
              className="textarea chat-composer-input"
              placeholder={t('conversation.reply')}
              value={reply}
              onChange={(e) => {
                setReply(e.target.value);
                setCannedIndex(0);
                sendTyping();
              }}
              onKeyDown={handleComposerKeyDown}
              rows={1}
            />
            {pickerOpen && (
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
            {sending ? t('common.loading') : t('conversation.send')}
          </button>
        </div>
      </div>

      <VisitorPanel conversation={conversation} onToggleStatus={toggleStatus} />
    </div>
  );
}
