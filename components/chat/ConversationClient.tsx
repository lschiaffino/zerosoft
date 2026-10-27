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
  ChatMessageWithUser,
  ConversationUpdatePayload,
} from '@/lib/chat-data';
import { formatTimeAgo, formatDateTime } from '@/lib/datetime';
import { CHAT_MESSAGE_MAX, CHAT_UPLOAD_MAX, sendErrorKey } from '@/lib/chat-schema';
import VisitorPanel from './VisitorPanel';
import { ConversationAttributes, MergeConversations, TranscriptActions, missingAttributeNames } from './ConversationTools';
import { parseMergeNote } from '@/lib/chat-merge-note';
import ChatIcon, { initials } from './icons';
import SlaNote from './SlaNote';
import { useInbox } from './InboxShell';
import { SNOOZE_OPTIONS } from './inbox-model';
import { fillReplyVariables } from '@/lib/chat-reply-variables';
import Copilot from './Copilot';
import TrackLink from './TrackLink';

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
  /** Equipos de Chat del workspace. */
  teams?: Array<{ id: string; name: string }>;
  /** La persona sigue esta conversación. */
  initialFollowing?: boolean;
  currentUser: CurrentUser;
}

interface Presence {
  user_id: string;
  name: string | null;
  email: string;
  typing: boolean;
}

function senderName(
  m: ChatMessageWithUser,
  visitor: ChatConversationWithVisitor['visitor'],
  currentUser: CurrentUser,
  t: (k: string) => string,
): string {
  if (m.sender_type === 'visitor') return visitor.name || visitor.email || t('conversation.anonymous');
  if (m.sender_type === 'system') return t('conversation.system');
  if (m.sender_type === 'bot') return t('conversation.bot');
  if (m.user_id === currentUser.id) return t('conversation.you');
  return m.user_name || m.user_email || t('conversation.you');
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
  teams = [],
  initialFollowing = false,
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
  /** Error al cambiar estado, prioridad o asignación (antes el select volvía atrás sin aviso). */
  const [updateError, setUpdateError] = useState<string | null>(null);
  const router = useRouter();
  const inbox = useInbox();
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
  /** Macro elegida en el composer: sus acciones se aplican al enviar la respuesta. */
  const [pendingMacro, setPendingMacro] = useState<{ id: string; shortcut: string } | null>(null);
  /** Panel de detalles en pantallas angostas (en desktop es la tercera columna fija). */
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsRef = useRef<HTMLElement>(null);
  const detailsToggleRef = useRef<HTMLButtonElement>(null);
  /** Mensaje o nota propio en edición (y su texto), o a confirmar su borrado. */
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [following, setFollowing] = useState(initialFollowing);
  /** Otros agentes con la conversación abierta (colisión). */
  const [others, setOthers] = useState<Presence[]>([]);
  /** Último momento en que se escribió una respuesta (para avisar "respondiendo"). */
  const typedAt = useRef(0);
  const replyRef = useRef('');
  replyRef.current = reply;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  /** Variables sin dato al insertar una respuesta guardada. */
  const [missingVars, setMissingVars] = useState<string[]>([]);

  async function heartbeat() {
    try {
      const typing = modeRef.current === 'reply' && replyRef.current.trim().length > 0 && Date.now() - typedAt.current < 8000;
      const res = await fetch(`/api/chat/conversations/${conversationId}/presence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ typing }),
      });
      if (!res.ok) return;
      setOthers(((await res.json()) as { others: Presence[] }).others);
    } catch {
      // ignore
    }
  }

  async function toggleFollow() {
    const next = !following;
    setFollowing(next);
    const res = await fetch(`/api/chat/conversations/${conversationId}/follow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ follow: next }),
    }).catch(() => null);
    if (!res?.ok) setFollowing(!next);
  }

  function canEdit(m: ChatMessageWithUser): boolean {
    return m.sender_type === 'user' && m.user_id === currentUser.id && !m.deleted_at;
  }

  async function saveEdit() {
    if (!editing || editBusy) return;
    const text = editing.text.trim();
    if (text.length > CHAT_MESSAGE_MAX) {
      setEditError(t('errors.messageTooLong'));
      return;
    }
    setEditBusy(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/chat/conversations/${conversationId}/messages/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setEditError(t(sendErrorKey(data.error)));
        return;
      }
      setEditing(null);
      await fetchMessages();
      fetchList();
    } catch {
      setEditError(t('errors.generic'));
    } finally {
      setEditBusy(false);
    }
  }

  async function deleteMessage(id: string) {
    if (editBusy) return;
    setEditBusy(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/chat/conversations/${conversationId}/messages/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        setEditError(t('errors.generic'));
        return;
      }
      setConfirmDeleteId(null);
      await fetchMessages();
      fetchList();
    } catch {
      setEditError(t('errors.generic'));
    } finally {
      setEditBusy(false);
    }
  }

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
      // Lo que llega con la conversación abierta (y la pestaña visible) queda leído.
      if (
        document.visibilityState === 'visible' &&
        data.messages.some((m) => m.sender_type === 'visitor' && !m.read_at)
      ) {
        void markRead();
      }
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

  function fetchList() {
    inbox.refresh();
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
    // Una nota interna no es una respuesta: el visitante no debe ver "escribiendo…".
    if (mode !== 'reply') return;
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
    setPendingMacro(null);
    fetchMessages();
    fetchCanned();
    fetchTags();
    markRead();
    void heartbeat();
    const interval = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      fetchMessages();
      fetchTyping();
      fetchConversation();
      void heartbeat();
    }, 3000);
    return () => {
      clearInterval(interval);
      // Deja de figurar como "mirando" al salir de la conversación.
      void fetch(`/api/chat/conversations/${conversationId}/presence`, { method: 'DELETE', keepalive: true }).catch(() => {});
    };
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
    const rows = inbox.rows;
    if (rows.length === 0) return;
    const index = rows.findIndex((c) => c.id === conversationId);
    const next = rows[index < 0 ? 0 : index + delta];
    if (next) router.push(`/app/chat/inbox/${next.id}`);
  }
  useKeyShortcut('j', () => step(1));
  useKeyShortcut('k', () => step(-1));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key === 'y') {
        e.preventDefault();
        toggleResolvedRef.current();
      } else if (key === 'n') {
        e.preventDefault();
        setMode((m) => (m === 'note' ? 'reply' : 'note'));
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  async function updateConversation(payload: ConversationUpdatePayload) {
    const res = await fetch(`/api/chat/conversations/${conversationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string; missing?: string[] };
      setUpdateError(
        data.error === 'missing_attributes' && data.missing?.length
          ? t('attributes.missing', { names: data.missing.join(', ') })
          : t(sendErrorKey(data.error)),
      );
      if (data.error === 'missing_attributes') openDetails();
      return;
    }
    setUpdateError(null);
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
    // Una macro (responder/resolver) no corre con una nota interna.
    const macro = mode === 'note' ? null : pendingMacro;
    const macroDone = () => {
      if (!macro) return;
      setPendingMacro(null);
      setMacroApplied(macro.shortcut);
      setTimeout(() => setMacroApplied(null), 3000);
      fetchTags();
    };
    const fail = async (res: Response) => {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setSendError(t(sendErrorKey(data.error)));
    };
    try {
      if (selectedFile && mode === 'reply') {
        const formData = new FormData();
        formData.append('file', selectedFile);
        if (body) formData.append('body', body);
        if (macro) formData.append('cannedId', macro.id);
        const res = await fetch(`/api/chat/conversations/${conversationId}/attachments`, {
          method: 'POST',
          body: formData,
        });
        if (res.ok) {
          setReply('');
          setSelectedFile(null);
          if (fileInputRef.current) fileInputRef.current.value = '';
          macroDone();
          await fetchMessages();
          await fetchList();
          await fetchConversation();
        } else {
          await fail(res);
        }
      } else {
        const isNote = mode === 'note';
        // Solo las menciones que siguen en el texto (si se borró "@Ana", no se la notifica).
        const liveMentions = mentions.filter((id) => {
          const agent = agents.find((a) => a.id === id);
          return agent ? body.includes(`@${agent.name || agent.email}`) : false;
        });
        const res = await fetch(`/api/chat/conversations/${conversationId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(isNote ? { body, note: true, mentions: liveMentions } : { body }),
            ...(macro ? { cannedId: macro.id } : {}),
          }),
        });
        if (res.ok) {
          setReply('');
          setMentions([]);
          setMissingVars([]);
          macroDone();
          await fetchMessages();
          await fetchList();
          if (!isNote || macro) await fetchConversation();
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

  /**
   * Resolver con atributos obligatorios sin completar: se avisa sin pedirlo
   * (el servidor igual lo rechaza) y se abre el panel donde se completan.
   */
  function blockedByAttributes(): boolean {
    const missing = missingAttributeNames(conversation);
    if (missing.length === 0) return false;
    setUpdateError(t('attributes.missing', { names: missing.join(', ') }));
    openDetails();
    return true;
  }

  function toggleResolved() {
    const next = conversation.status === 'resolved' ? 'open' : 'resolved';
    if (next === 'resolved' && blockedByAttributes()) return;
    updateConversation({ status: next });
  }
  const toggleResolvedRef = useRef(toggleResolved);
  toggleResolvedRef.current = toggleResolved;

  function changeStatus(status: string) {
    if (status === 'resolved' && conversation.status !== 'resolved' && blockedByAttributes()) return;
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

  function insertCanned(response: ChatCannedResponseRow) {
    const before = reply.slice(0, reply.lastIndexOf('/'));
    // Variables ({{first_name}}, {{agent_name}}, atributos…): se completan al insertar, como en Intercom.
    let attributes: Record<string, string | number | boolean | null> = {};
    try {
      attributes = JSON.parse(conversation.attributes || '{}') as typeof attributes;
    } catch {
      attributes = {};
    }
    const filled = fillReplyVariables(response.body, {
      visitorName: conversation.visitor.name,
      visitorEmail: conversation.visitor.email,
      agentName: currentUser.name || currentUser.email,
      widgetName: conversation.widget_name,
      attributes,
    });
    setMissingVars(filled.missing);
    setReply((before + filled.text).trimStart() + ' ');
    setCannedIndex(0);
    // Macro: si la respuesta guardada tiene acciones, se aplican al enviar (no
    // al elegirla: si no, el envío reabría la conversación recién resuelta y
    // las acciones corrían aunque el agente no mandara nada).
    let hasActions = false;
    try {
      const a = JSON.parse(response.actions || '{}') as Record<string, unknown>;
      hasActions = Object.keys(a).length > 0;
    } catch {
      hasActions = false;
    }
    setPendingMacro(hasActions ? { id: response.id, shortcut: response.shortcut } : null);
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
      if (e.key === 'Enter' || e.key === 'Tab') {
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

  function openDetails() {
    setDetailsOpen(true);
    requestAnimationFrame(() => detailsRef.current?.focus());
  }

  function closeDetails() {
    setDetailsOpen(false);
    detailsToggleRef.current?.focus();
  }

  // Con el panel abierto (pantallas angostas), Esc lo cierra desde cualquier foco.
  useEffect(() => {
    if (!detailsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setDetailsOpen(false);
      detailsToggleRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [detailsOpen]);

  const visitorLabel = visitor.name || visitor.email || t('conversation.anonymous');
  return (
    <>
      <section className="chat-thread" aria-labelledby="chat-thread-title">
        <header className="chat-thread-head">
          <Link href="/app/chat/inbox" className="btn btn-ghost btn-icon btn-sm chat-thread-back" aria-label={t('inbox.backToList')}>
            <ChatIcon name="back" />
          </Link>
          <div className="chat-thread-who">
            <h2 id="chat-thread-title" className="chat-thread-name">
              {visitorLabel}
            </h2>
            <p className="chat-thread-sub">
              {visitor.email && visitor.name && <span className="data">{visitor.email}</span>}
              <span>{conversation.widget_name}</span>
              {conversation.channel === 'email' && <span className="badge badge-outline">{t('channels.email')}</span>}
              <SlaNote c={conversation} />
            </p>
          </div>
          <button
            ref={detailsToggleRef}
            type="button"
            className="btn btn-ghost btn-sm chat-details-toggle"
            aria-expanded={detailsOpen}
            aria-controls="chat-details"
            onClick={() => (detailsOpen ? closeDetails() : openDetails())}
          >
            {t('conversation.details')}
          </button>
          <div className="chat-thread-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm chat-follow"
              aria-pressed={following}
              onClick={() => void toggleFollow()}
              title={t('follow.hint')}
            >
              <ChatIcon name="eye" size={14} />
              {following ? t('follow.following') : t('follow.follow')}
            </button>
            {teams.length > 0 && (
              <select
                className="select chat-compact-select"
                aria-label={t('teams.label')}
                value={conversation.team_id ?? ''}
                onChange={(e) => updateConversation({ teamId: e.target.value || null })}
              >
                <option value="">{t('teams.noTeam')}</option>
                {teams.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            )}
            <select
              className="select chat-compact-select"
              aria-label={t('conversation.assignedTo')}
              value={conversation.assigned_to ?? ''}
              onChange={(e) => updateConversation({ assignedTo: e.target.value || null })}
            >
              <option value="">{t('conversation.unassigned')}</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.id === currentUser.id ? t('conversation.assignedToYou') : a.name || a.email}
                  {a.away ? ` (${t('away.away')})` : ''}
                </option>
              ))}
            </select>
            {!isResolved && (
              <>
                <label className="sr-only" htmlFor="chat-snooze">
                  {t('conversation.snoozeLabel')}
                </label>
                <select
                  id="chat-snooze"
                  className="select chat-compact-select"
                  value=""
                  onChange={(e) => {
                    const ms = Number(e.target.value);
                    if (ms > 0) updateConversation({ status: 'snoozed', snoozedUntil: snoozeUntilFor(ms) });
                  }}
                >
                  <option value="" suppressHydrationWarning>
                    {conversation.status === 'snoozed' && conversation.snoozed_until
                      ? t('conversation.snoozedUntilShort', { when: formatDateTime(conversation.snoozed_until, locale) })
                      : t('conversation.snoozeLabel')}
                  </option>
                  {SNOOZE_OPTIONS.map((opt) => (
                    <option key={opt.key} value={opt.value}>
                      {t(`conversation.snooze.${opt.key}`)}
                    </option>
                  ))}
                </select>
              </>
            )}
            <button
              type="button"
              className={`btn btn-sm ${isResolved ? 'btn-secondary' : 'btn-primary'}`}
              onClick={toggleResolved}
              aria-keyshortcuts="Control+Shift+Y Meta+Shift+Y"
              title={t('conversation.resolveShortcut')}
            >
              {isResolved ? t('conversation.reopen') : t('conversation.resolve')}
            </button>
          </div>
          <p className="ui-error chat-thread-error" role="alert" hidden={!updateError}>
            {updateError}
          </p>
        </header>

        <div className="chat-messages" ref={messagesRef}>
          {messages.length === 0 ? (
            <p className="chat-quiet chat-messages-empty">{t('conversation.noMessages')}</p>
          ) : (
            <ol className="chat-message-list" aria-label={t('conversation.messages')}>
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
                // Bot y sistema llevan un glifo dibujado; personas, sus iniciales.
                const plate =
                  m.sender_type === 'bot' || m.sender_type === 'system' ? (
                    <ChatIcon name={m.sender_type} size={16} />
                  ) : isVisitor ? (
                    visitor.name || visitor.email ? initials(visitor.name, visitor.email) : '?'
                  ) : (
                    initials(m.user_name, m.user_email)
                  );
                const isEditing = editing?.id === m.id;
                const own = canEdit(m);
                return (
                  <li
                    key={m.id}
                    className="chat-message"
                    data-sender={m.sender_type}
                    data-note={m.is_note ? true : undefined}
                    data-deleted={m.deleted_at ? true : undefined}
                  >
                    <span className="chat-plate" aria-hidden="true">
                      {plate}
                    </span>
                    <div className="chat-message-body">
                      <p className="chat-message-meta">
                        <span className="chat-message-name">{name}</span>
                        {m.is_note ? <span className="badge badge-warn">{t('notes.label')}</span> : null}
                        <time suppressHydrationWarning className="chat-message-time" dateTime={m.created_at} title={formatDateTime(m.created_at, locale)}>
                          {formatTimeAgo(m.created_at, locale)}
                        </time>
                        {!isVisitor && !m.is_note && m.read_at && !m.deleted_at && (
                          <span className="chat-message-read" suppressHydrationWarning title={formatDateTime(m.read_at, locale)}>
                            {t('read.read')}
                          </span>
                        )}
                        {m.edited_at && !m.deleted_at && (
                          <span className="chat-message-read" suppressHydrationWarning title={formatDateTime(m.edited_at, locale)}>
                            {t('edit.edited')}
                          </span>
                        )}
                        {own && !isEditing && (
                          <span className="chat-message-tools">
                            {confirmDeleteId === m.id ? (
                              <>
                                <button
                                  type="button"
                                  className="btn btn-danger btn-sm"
                                  disabled={editBusy}
                                  aria-busy={editBusy || undefined}
                                  onClick={() => deleteMessage(m.id)}
                                >
                                  {m.is_note ? t('edit.confirmDeleteNote') : t('edit.confirmDelete')}
                                </button>
                                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmDeleteId(null)}>
                                  {t('common.cancel')}
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm"
                                  onClick={() => {
                                    setConfirmDeleteId(null);
                                    setEditError(null);
                                    setEditing({ id: m.id, text: m.body });
                                  }}
                                >
                                  {t('common.edit')}
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm"
                                  onClick={() => {
                                    setEditing(null);
                                    setEditError(null);
                                    setConfirmDeleteId(m.id);
                                  }}
                                >
                                  {t('common.delete')}
                                </button>
                              </>
                            )}
                          </span>
                        )}
                      </p>
                      {m.deleted_at ? (
                        <p className="chat-message-text chat-message-deleted">
                          {m.is_note ? t('edit.deletedNote') : t('edit.deleted')}
                        </p>
                      ) : isEditing ? (
                        <div className="chat-message-edit">
                          <label className="sr-only" htmlFor={`chat-edit-${m.id}`}>
                            {t('edit.label')}
                          </label>
                          <textarea
                            id={`chat-edit-${m.id}`}
                            className="textarea"
                            rows={3}
                            autoFocus
                            value={editing.text}
                            onChange={(e) => setEditing({ id: m.id, text: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') setEditing(null);
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                void saveEdit();
                              }
                            }}
                          />
                          <div className="chat-message-edit-foot">
                            {!m.is_note && <p className="ui-help">{t('edit.visitorSees')}</p>}
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>
                              {t('common.cancel')}
                            </button>
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              disabled={editBusy || (!editing.text.trim() && attachments.length === 0)}
                              aria-busy={editBusy || undefined}
                              onClick={() => void saveEdit()}
                            >
                              {t('common.save')}
                            </button>
                          </div>
                        </div>
                      ) : m.sender_type === 'system' && parseMergeNote(m.body) ? (
                        <p className="chat-message-text" suppressHydrationWarning>
                          {(() => {
                            const note = parseMergeNote(m.body)!;
                            return t('merge.systemNote', { count: note.count, when: formatDateTime(note.startedAt, locale) });
                          })()}
                        </p>
                      ) : m.body ? (
                        <p className="chat-message-text">{m.body}</p>
                      ) : null}
                      {(isEditing || confirmDeleteId === m.id) && editError && (
                        <p className="ui-error" role="alert">
                          {editError}
                        </p>
                      )}
                      {attachments.length > 0 && !m.deleted_at && (
                        <div className="chat-attachments">
                          {attachments.map((a, idx) => {
                            const type = attachmentType(a.mime);
                            if (type === 'image') {
                              return (
                                <a key={idx} href={a.url} target="_blank" rel="noopener noreferrer" className="chat-attachment-image">
                                  {/* Adjunto subido (Blob o local): sin optimización de next/image. */}
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={a.url} alt={a.name} />
                                </a>
                              );
                            }
                            if (type === 'audio') {
                              return <audio key={idx} src={a.url} controls preload="metadata" className="chat-attachment-audio" />;
                            }
                            return (
                              <a key={idx} href={a.url} target="_blank" rel="noopener noreferrer" className="chat-attachment-file">
                                <ChatIcon name="attach" size={14} />
                                <span>{a.name}</span>
                                <span className="data">{formatBytes(a.size)}</span>
                              </a>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        {others.length > 0 && (
          <p className="chat-collision" role="status" data-typing={others.some((o) => o.typing) || undefined}>
            <ChatIcon name="eye" size={14} />
            {others.some((o) => o.typing)
              ? t('collision.replying', { names: others.filter((o) => o.typing).map((o) => o.name || o.email).join(', ') })
              : t('collision.viewing', { names: others.map((o) => o.name || o.email).join(', ') })}
          </p>
        )}
        <div className={`chat-composer${mode === 'note' ? ' is-note' : ''}`}>
          <div className="ui-tabs chat-composer-tabs" role="tablist" aria-label={t('notes.mode')}>
            <button
              type="button"
              role="tab"
              className="ui-tab"
              aria-selected={mode === 'reply'}
              onClick={() => setMode('reply')}
            >
              {t('conversation.reply')}
            </button>
            <button
              type="button"
              role="tab"
              className="ui-tab"
              aria-selected={mode === 'note'}
              onClick={() => {
                setMode('note');
                setPendingMacro(null);
                clearSelectedFile();
                // Si venía escribiendo una respuesta, el visitante deja de ver el indicador.
                if (typingSentAt.current > 0) {
                  typingSentAt.current = 0;
                  fetch(`/api/chat/conversations/${conversationId}/typing`, { method: 'DELETE' }).catch(() => {});
                }
              }}
            >
              {t('notes.label')}
            </button>
            <span className="chat-composer-status" aria-live="polite">
              {visitorTyping
                ? t('typing.visitorTyping')
                : macroApplied
                  ? t('macros.applied', { shortcut: macroApplied })
                  : pendingMacro
                    ? t('macros.pending', { shortcut: pendingMacro.shortcut })
                    : ''}
            </span>
          </div>

          <div className="chat-composer-field">
            <textarea
              className="textarea chat-composer-input"
              placeholder={mode === 'note' ? t('notes.hint') : t('conversation.replyPlaceholder')}
              aria-label={mode === 'note' ? t('notes.label') : t('conversation.reply')}
              value={reply}
              onChange={(e) => {
                setReply(e.target.value);
                typedAt.current = Date.now();
                if (!e.target.value.trim()) {
                  setPendingMacro(null);
                  setMissingVars([]);
                }
                setCannedIndex(0);
                sendTyping();
              }}
              onKeyDown={handleComposerKeyDown}
              rows={3}
            />
            {mentionOpen && (
              <ul className="chat-picker" role="listbox" aria-label={t('notes.mentions')}>
                {mentionMatches.map((a, i) => (
                  <li key={a.id} role="option" aria-selected={i === mentionIndex}>
                    <button type="button" tabIndex={-1} onClick={() => insertMention(a)}>
                      <span>{a.name || a.email}</span>
                      <span className="data">{a.email}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {pickerOpen && !mentionOpen && (
              <ul className="chat-picker" role="listbox" aria-label={t('canned.title')}>
                {pickerMatches.map((r, i) => (
                  <li key={r.id} role="option" aria-selected={i === cannedIndex}>
                    <button type="button" tabIndex={-1} onClick={() => insertCanned(r)}>
                      <span className="data">{r.shortcut}</span>
                      <span>{r.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {missingVars.length > 0 && (
            <p className="ui-help chat-missing-vars" role="status">
              {t('variables.missing', { names: missingVars.map((v) => `{{${v}}}`).join(', ') })}
            </p>
          )}
          {selectedFile && (
            <div className="chat-file-chip">
              <ChatIcon name="attach" size={14} />
              <span className="chat-file-name">{selectedFile.name}</span>
              <span className="data">{formatBytes(selectedFile.size)}</span>
              <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={clearSelectedFile} aria-label={t('attachments.remove')}>
                <ChatIcon name="close" size={14} />
              </button>
            </div>
          )}

          <div className="chat-composer-foot">
            {mode === 'reply' && (
              <button
                type="button"
                className="btn btn-ghost btn-icon btn-sm"
                onClick={() => fileInputRef.current?.click()}
                title={t('attachments.upload')}
                aria-label={t('attachments.upload')}
              >
                <ChatIcon name="attach" />
              </button>
            )}
            <Copilot
              conversationId={conversationId}
              text={reply}
              onText={(text) => {
                setReply(text);
                setMode('reply');
              }}
              onNote={async (text) => {
                const res = await fetch(`/api/chat/conversations/${conversationId}/messages`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ body: text, note: true }),
                });
                if (res.ok) await fetchMessages();
                return res.ok;
              }}
            />
            <input
              ref={fileInputRef}
              type="file"
              className="chat-file-input"
              aria-hidden="true"
              tabIndex={-1}
              onChange={handleFileChange}
            />
            <p className="chat-composer-hint">
              {mode === 'note' ? (
                t('notes.footHint')
              ) : (
                <>
                  <kbd className="kbd">Enter</kbd> {t('conversation.hintSend')} <kbd className="kbd">/</kbd> {t('conversation.hintCanned')}
                </>
              )}
            </p>
            <p className="ui-error chat-composer-error" role="alert" hidden={!sendError}>
              {sendError}
            </p>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={sendReply}
              aria-busy={sending || undefined}
              disabled={sending || (!reply.trim() && !selectedFile)}
            >
              {mode === 'note' ? t('notes.add') : t('conversation.send')}
            </button>
          </div>
        </div>
      </section>

      <aside
        id="chat-details"
        ref={detailsRef}
        className="chat-details"
        data-open={detailsOpen || undefined}
        aria-label={t('conversation.details')}
        tabIndex={-1}
      >
        <div className="chat-details-head">
          <h2 className="chat-details-title">{t('conversation.details')}</h2>
          <button type="button" className="btn btn-ghost btn-icon btn-sm chat-details-close" onClick={closeDetails} aria-label={t('common.close')}>
            <ChatIcon name="close" />
          </button>
        </div>

        <section className="chat-details-section" aria-labelledby="chat-details-conv">
          <h3 id="chat-details-conv" className="chat-details-label">
            {t('conversation.conversation')}
          </h3>
          <div className="ui-field">
            <label className="label" htmlFor="chat-status">
              {t('conversation.statusLabel')}
            </label>
            <select id="chat-status" className="select" value={conversation.status} onChange={(e) => changeStatus(e.target.value)}>
              {(['open', 'pending', 'snoozed', 'resolved'] as const).map((s) => (
                <option key={s} value={s}>
                  {t(`conversation.${s}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="chat-priority">
              {t('conversation.priority')}
            </label>
            <select
              id="chat-priority"
              className="select"
              value={conversation.priority}
              onChange={(e) => updateConversation({ priority: e.target.value as ConversationUpdatePayload['priority'] })}
            >
              {(['low', 'medium', 'high', 'urgent'] as const).map((p) => (
                <option key={p} value={p}>
                  {t(`priorities.${p}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="chat-tag-input">
              {t('tags.title')}
            </label>
            <div className="chat-tags">
              {tags.map((tag) => (
                <span key={tag} className="badge badge-outline chat-tag">
                  #{tag}
                  <button type="button" onClick={() => removeTag(tag)} aria-label={t('tags.remove', { tag })}>
                    <ChatIcon name="close" size={12} />
                  </button>
                </span>
              ))}
              <input
                id="chat-tag-input"
                className="chat-tag-input"
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
                maxLength={40}
              />
            </div>
          </div>
        </section>

        <ConversationAttributes
          conversation={conversation}
          onSaved={(next) => {
            setConversation((prev) => ({ ...prev, ...next }));
            if (missingAttributeNames(next).length === 0) setUpdateError(null);
          }}
        />

        <VisitorPanel conversation={conversation} />

        <TrackLink
          conversationId={conversationId}
          defaultTitle={(conversation.subject || messages.find((m) => m.sender_type === 'visitor')?.body || '').slice(0, 120)}
        />

        <TranscriptActions conversation={conversation} />

        <MergeConversations
          conversation={conversation}
          onMerged={(next) => {
            setConversation((prev) => ({ ...prev, ...next }));
            void fetchMessages();
            void fetchTags();
            fetchList();
          }}
        />
      </aside>
      {detailsOpen && <div className="chat-details-backdrop" onClick={closeDetails} aria-hidden="true" />}
    </>
  );
}
