'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { useKeyShortcut } from '@/components/app/QuickModal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { ChatDto, GroupsPerson, LabelDto, MemberDto, MessageDto, PropertyDef, QuickReply } from '@/lib/groups';
import type { ProviderCaps } from '@/lib/groups-provider';
import { mentionQueryAt, mentionSegments, mentionSuggestions, mentionText } from '@/lib/crm-mentions';
import { TRANSLATE_LANGS, messageActions } from '@/lib/groups-inbox-rules';
import { useGroupsInbox } from './InboxShell';
import ChatDetails from './ChatDetails';
import { ForwardModal, MessageMenu, PinnedBar, SystemLine, type MenuItem } from './ThreadParts';
import { ChatPlate, Modal, api, useErrorText, useMediaText, useToast } from './ui';

const QUICK_EMOJIS = ['👍', '❤️', '😂', '🙏', '✅'];
const TRANSLATE_STORE = 'zs-groups-translate';

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
  isAdmin: boolean;
  numberName: string;
  caps: ProviderCaps;
  ticketEmoji: string;
  pinned: MessageDto[];
  teams: Array<{ id: string; name: string }>;
}

function dayKey(iso: string) {
  return iso.slice(0, 10);
}

function readTranslatePref(chatId: string): boolean {
  try {
    const raw = window.localStorage.getItem(TRANSLATE_STORE);
    return raw ? (JSON.parse(raw) as string[]).includes(chatId) : false;
  } catch {
    return false;
  }
}

function saveTranslatePref(chatId: string, on: boolean) {
  try {
    const raw = window.localStorage.getItem(TRANSLATE_STORE);
    const list = new Set(raw ? (JSON.parse(raw) as string[]) : []);
    if (on) list.add(chatId);
    else list.delete(chatId);
    window.localStorage.setItem(TRANSLATE_STORE, JSON.stringify([...list].slice(-200)));
  } catch {
    // Sin storage: la traducción dura lo que dura la página.
  }
}

/**
 * Un chat o grupo: mensajes, composer (respuesta o nota interna) y el panel
 * de detalles. Trae lo nuevo cada 4 s. Teclado: R responder, N nota,
 * E cerrar o reabrir, A asignarme, T ticket del último mensaje del cliente,
 * U leído o no leído, P fijar el chat, L traducir.
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
  const [pinned, setPinned] = useState(props.pinned);
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
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
  const [editing, setEditing] = useState<{ id: string; text: string; busy: boolean } | null>(null);
  const [deleting, setDeleting] = useState<MessageDto | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [forwarding, setForwarding] = useState<MessageDto | null>(null);
  const [translateOn, setTranslateOn] = useState(false);
  const [translations, setTranslations] = useState<Record<string, { lang: string; text: string }>>({});
  const [translateError, setTranslateError] = useState('');
  const [showOriginal, setShowOriginal] = useState<Set<string>>(new Set());
  const [aiBusy, setAiBusy] = useState<'' | 'draft' | 'polish' | 'translate'>('');
  const [undoText, setUndoText] = useState<string | null>(null);
  const [draftSources, setDraftSources] = useState<string[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const requested = useRef<Set<string>>(new Set());
  const pendingCaret = useRef<number | null>(null);

  // Después de insertar una mención, el cursor queda justo después (antes de la próxima tecla).
  useLayoutEffect(() => {
    if (pendingCaret.current === null) return;
    inputRef.current?.focus();
    inputRef.current?.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  }, [text]);

  const peopleById = useMemo(() => new Map(props.people.map((p) => [p.id, p.name || p.email])), [props.people]);
  const nameOf = useCallback((id: string | null | undefined) => (id ? peopleById.get(id) ?? '' : ''), [peopleById]);
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const viewer = useMemo(() => ({ me: props.me, isAdmin: props.isAdmin }), [props.me, props.isAdmin]);
  const mentionPeople = useMemo(() => props.people.map((p) => ({ id: p.id, name: p.name || null, email: p.email })), [props.people]);

  // Abrir el chat lo marca leído.
  useEffect(() => {
    if (props.chat.unread > 0) void api(`/api/groups/chats/${props.chat.id}`, { method: 'PATCH', body: { read: true } }).then(() => refresh());
  }, [props.chat.id, props.chat.unread, refresh]);

  useEffect(() => setTranslateOn(readTranslatePref(props.chat.id)), [props.chat.id]);

  // Con #m-<id> (Cmd+K, tickets, avisos) va a ese mensaje y lo marca; si no, al final.
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

  // Cada 4 s, los últimos 60: lo nuevo y los cambios en lo reciente (estado, reacciones, ediciones, llamadas).
  useEffect(() => {
    const id = setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      const res = await api<{ messages: MessageDto[] }>(`/api/groups/chats/${chat.id}/messages?limit=60`);
      if (res.data) merge(res.data.messages);
    }, 4000);
    return () => clearInterval(id);
  }, [chat.id, merge]);

  // Traducción: lo que ya está en caché viene con el mensaje; lo demás se pide (una vez por mensaje).
  useEffect(() => {
    if (!translateOn) return;
    const cached: Record<string, { lang: string; text: string }> = {};
    const missing: string[] = [];
    for (const m of messages) {
      if (m.direction !== 'in' || !m.body.trim() || m.deletedAt) continue;
      if (m.translations[locale] !== undefined) cached[m.id] = { lang: m.translations._lang ?? '', text: m.translations[locale] };
      else if (!requested.current.has(m.id)) missing.push(m.id);
    }
    if (Object.keys(cached).length) setTranslations((prev) => ({ ...prev, ...cached }));
    if (missing.length === 0) return;
    const batch = missing.slice(-40);
    batch.forEach((id) => requested.current.add(id));
    void api<{ translations: Array<{ id: string; lang: string; text: string }> }>(`/api/groups/chats/${chat.id}/translate`, {
      body: { messageIds: batch, to: locale },
    }).then((res) => {
      if (!res.data) {
        batch.forEach((id) => requested.current.delete(id));
        setTranslateError(errText(res.error));
        return;
      }
      setTranslateError('');
      setTranslations((prev) => ({ ...prev, ...Object.fromEntries(res.data.translations.map((x) => [x.id, { lang: x.lang, text: x.text }])) }));
    });
  }, [translateOn, messages, chat.id, locale, errText]);

  function toggleTranslate() {
    const next = !translateOn;
    setTranslateOn(next);
    setTranslateError('');
    saveTranslatePref(chat.id, next);
  }

  const patchChat = useCallback(
    async (body: Record<string, unknown>) => {
      const res = await api<ChatDto>(`/api/groups/chats/${chat.id}`, { method: 'PATCH', body });
      if (res.data) {
        setChat(res.data);
        refresh();
        // El historial (asignado, cerrado) aparece en el hilo.
        const fresh = await api<{ messages: MessageDto[] }>(`/api/groups/chats/${chat.id}/messages?limit=20`);
        if (fresh.data) merge(fresh.data.messages);
      } else showToast(errText(res.error), true);
      return res.data;
    },
    [chat.id, refresh, showToast, errText, merge],
  );

  // "/" al principio abre las respuestas rápidas; "@" en una nota, las personas.
  const slash = mode === 'reply' ? /^\/([a-z0-9_-]*)$/i.exec(text.trim()) : null;
  const quickMatches = slash ? props.quickReplies.filter((q) => q.shortcut.startsWith(slash[1].toLowerCase())).slice(0, 6) : [];
  const mentionQuery = mode === 'note' ? mentionQueryAt(text, caret) : null;
  const mentionMatches = mentionQuery ? mentionSuggestions(mentionQuery.query, mentionPeople) : [];

  // Idioma del cliente: el detectado en su último mensaje traducido.
  const customerLang = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.direction !== 'in') continue;
      const lang = translations[m.id]?.lang || m.translations._lang;
      if (lang && lang in TRANSLATE_LANGS) return lang;
    }
    return '';
  }, [messages, translations]);

  function pickMention(i: number) {
    const p = mentionMatches[i];
    if (!p || !mentionQuery) return;
    const insert = `${mentionText(p)} `;
    const next = text.slice(0, mentionQuery.start) + insert + text.slice(caret);
    setText(next);
    const pos = mentionQuery.start + insert.length;
    setCaret(pos);
    setMentionIndex(0);
    pendingCaret.current = pos;
  }

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
    setUndoText(null);
    setDraftSources([]);
    refresh();
    inputRef.current?.focus();
  }

  function onComposerKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionMatches.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + mentionMatches.length) % mentionMatches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pickMention(Math.min(mentionIndex, mentionMatches.length - 1));
        return;
      }
    }
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

  async function saveEdit() {
    if (!editing || editing.busy) return;
    if (!editing.text.trim()) return;
    setEditing({ ...editing, busy: true });
    const res = await api<MessageDto>(`/api/groups/messages/${editing.id}`, { body: { action: 'edit', body: editing.text } });
    if (!res.data) {
      setEditing({ ...editing, busy: false });
      showToast(errText(res.error), true);
      return;
    }
    merge([res.data]);
    setPinned((list) => list.map((p) => (p.id === res.data!.id ? res.data! : p)));
    setEditing(null);
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    const res = await api<{ removed: boolean; message: MessageDto | null }>(`/api/groups/messages/${deleting.id}`, { method: 'DELETE' });
    setDeleteBusy(false);
    const target = deleting;
    setDeleting(null);
    if (!res.data) {
      showToast(errText(res.error), true);
      return;
    }
    if (res.data.removed) setMessages((list) => list.filter((m) => m.id !== target.id));
    else if (res.data.message) merge([res.data.message]);
    setPinned((list) => list.filter((p) => p.id !== target.id));
    showToast(res.data.removed ? t('thread.noteDeleted') : t('thread.deletedForAll'));
  }

  async function togglePin(m: MessageDto) {
    const pin = !m.pinnedAt;
    const res = await api<{ message: MessageDto; inWhatsApp: boolean }>(`/api/groups/messages/${m.id}`, { body: { action: pin ? 'pin' : 'unpin' } });
    if (!res.data) {
      showToast(errText(res.error), true);
      return;
    }
    const updated = res.data.message;
    merge([updated]);
    setPinned((list) => (pin ? [updated, ...list.filter((p) => p.id !== updated.id)] : list.filter((p) => p.id !== updated.id)));
    showToast(pin ? (res.data.inWhatsApp ? t('thread.pinnedWhatsApp') : t('thread.pinnedHere')) : t('thread.unpinned'));
  }

  function jumpTo(m: MessageDto) {
    const el = document.getElementById(`m-${m.id}`);
    if (!el) {
      showToast(t('thread.pinnedOld'));
      return;
    }
    el.scrollIntoView({ block: 'center' });
    document.querySelectorAll('.gr-msg.is-target').forEach((x) => x.classList.remove('is-target'));
    el.classList.add('is-target');
  }

  async function copyText(m: MessageDto) {
    try {
      await navigator.clipboard.writeText(m.body);
      showToast(t('common.copied'));
    } catch {
      showToast(errText('generic'), true);
    }
  }

  async function summarize() {
    setSummary({ text: '', error: '', busy: true });
    const res = await api<{ summary: string }>(`/api/groups/chats/${chat.id}/summary`, { body: { days: 7, locale } });
    setSummary({ text: res.data?.summary ?? '', error: res.error ? errText(res.error) : '', busy: false });
  }

  async function aiDraft() {
    if (aiBusy) return;
    const polish = text.trim().length > 0;
    setAiBusy(polish ? 'polish' : 'draft');
    setSendError('');
    const res = await api<{ text: string; sources: Array<{ title: string }> }>(`/api/groups/chats/${chat.id}/draft`, {
      body: { mode: polish ? 'polish' : 'draft', text },
    });
    setAiBusy('');
    if (!res.data) {
      setSendError(errText(res.error));
      return;
    }
    setUndoText(text);
    setText(res.data.text);
    setDraftSources(res.data.sources.map((s) => s.title));
    inputRef.current?.focus();
  }

  async function translateReply(to: string) {
    if (!to || aiBusy) return;
    if (!text.trim()) {
      setSendError(errText('empty_message'));
      return;
    }
    setAiBusy('translate');
    setSendError('');
    const res = await api<{ text: string }>('/api/groups/translate', { body: { text, to } });
    setAiBusy('');
    if (!res.data) {
      setSendError(errText(res.error));
      return;
    }
    setUndoText(text);
    setText(res.data.text);
    setDraftSources([]);
    inputRef.current?.focus();
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

  async function toggleUnread() {
    const unread = chat.unread > 0;
    const res = await patchChat({ read: unread });
    if (res) showToast(unread ? t('thread.markedRead') : t('thread.markedUnread'));
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
  useKeyShortcut('u', () => void toggleUnread());
  useKeyShortcut('p', () => void patchChat({ pinned: !chat.pinned }));
  useKeyShortcut('l', () => toggleTranslate());

  function menuItems(m: MessageDto): MenuItem[] {
    const can = messageActions(m, props.caps, viewer);
    const items: MenuItem[] = [];
    if (can.edit) items.push({ key: 'edit', label: t('thread.edit'), onSelect: () => setEditing({ id: m.id, text: m.body, busy: false }) });
    if (can.forward) items.push({ key: 'forward', label: t('thread.forward'), onSelect: () => setForwarding(m) });
    if (can.pin) items.push({ key: 'pin', label: m.pinnedAt ? t('thread.unpin') : t('thread.pin'), onSelect: () => void togglePin(m) });
    if (m.body.trim()) items.push({ key: 'copy', label: t('thread.copy'), onSelect: () => void copyText(m) });
    if (can.delete)
      items.push({
        key: 'delete',
        label: m.direction === 'note' ? t('thread.deleteNote') : t('thread.deleteForAll'),
        onSelect: () => setDeleting(m),
        danger: true,
      });
    return items;
  }

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
            {props.teams.length > 0 && (
              <select
                className="select"
                value={chat.assignedTeamId ?? ''}
                onChange={(e) => void patchChat({ assignedTeamId: e.target.value || null })}
                aria-label={t('thread.team')}
              >
                <option value="">{t('thread.noTeam')}</option>
                {props.teams.map((tm) => (
                  <option key={tm.id} value={tm.id}>
                    {tm.name}
                  </option>
                ))}
              </select>
            )}
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void summarize()} aria-busy={summary?.busy || undefined}>
              {t('thread.summary')}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={toggleTranslate} aria-pressed={translateOn}>
              {t('thread.translate')} <kbd className="kbd">L</kbd>
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void patchChat({ status: chat.status === 'open' ? 'closed' : 'open' })}>
              {chat.status === 'open' ? t('thread.close') : t('thread.reopen')} <kbd className="kbd">E</kbd>
            </button>
            <MessageMenu
              label={t('thread.chatMenu')}
              items={[
                { key: 'unread', label: chat.unread > 0 ? t('thread.markRead') : t('thread.markUnread'), onSelect: () => void toggleUnread() },
                { key: 'pin', label: chat.pinned ? t('thread.unpinChat') : t('thread.pinChat'), onSelect: () => void patchChat({ pinned: !chat.pinned }) },
              ]}
            />
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

        {translateOn && translateError && (
          <div className="gr-banner is-bad" role="alert">
            {translateError}
            <button type="button" className="btn btn-ghost btn-sm" onClick={toggleTranslate}>
              {t('thread.translateOff')}
            </button>
          </div>
        )}

        <PinnedBar pinned={pinned} onJump={jumpTo} onUnpin={(m) => void togglePin(m)} />

        <div className="gr-messages" role="log" aria-live="polite">
          {messages.length === 0 && <p className="gr-list-empty">{t('thread.noMessages')}</p>}
          {messages.map((m) => {
            const day = dayKey(m.createdAt);
            const showDay = day !== prevDay;
            prevDay = day;
            if (m.direction === 'system') {
              return (
                <div key={m.id}>
                  {showDay && <p className="gr-day">{new Date(m.createdAt).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })}</p>}
                  <SystemLine m={m} nameOf={nameOf} />
                </div>
              );
            }
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
                            : nameOf(m.authorId);
            const tr = translateOn && m.direction === 'in' ? translations[m.id] : undefined;
            const showTr = tr && tr.text && !showOriginal.has(m.id);
            const isEditing = editing?.id === m.id;
            return (
              <div key={m.id}>
                {showDay && <p className="gr-day">{new Date(m.createdAt).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })}</p>}
                <article className={`gr-msg gr-msg-${m.direction}${m.deletedAt ? ' is-deleted' : ''}`} id={`m-${m.id}`}>
                  <div className="gr-bubble">
                    {(author || m.direction === 'note') && (
                      <p className="gr-msg-author">
                        {m.direction === 'note' ? (
                          <>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                              <rect x="5" y="11" width="14" height="10" rx="1" />
                              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                            </svg>{' '}
                            {t('thread.noteBy', { name: author || '' })}
                          </>
                        ) : (
                          author
                        )}
                      </p>
                    )}
                    {m.forwarded && <p className="gr-forwarded">{t('thread.forwarded')}</p>}
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
                    {isEditing ? (
                      <form
                        className="gr-edit"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void saveEdit();
                        }}
                      >
                        <textarea
                          className="textarea"
                          rows={3}
                          value={editing.text}
                          autoFocus
                          aria-label={t('thread.editLabel')}
                          onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                              e.preventDefault();
                              void saveEdit();
                            }
                            if (e.key === 'Escape') {
                              e.preventDefault();
                              setEditing(null);
                            }
                          }}
                        />
                        <span className="gr-edit-foot">
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>
                            {t('common.cancel')}
                          </button>
                          <button type="submit" className="btn btn-primary btn-sm" disabled={!editing.text.trim()} aria-busy={editing.busy || undefined}>
                            {t('common.save')}
                          </button>
                        </span>
                      </form>
                    ) : (
                      m.body && (
                        <p className="gr-pre">
                          {showTr
                            ? tr.text
                            : m.direction === 'note'
                              ? mentionSegments(m.body, mentionPeople).map((seg, i) =>
                                  seg.mention ? (
                                    <span key={i} className="gr-mention">
                                      {seg.text}
                                    </span>
                                  ) : (
                                    <span key={i}>{seg.text}</span>
                                  ),
                                )
                              : m.body}
                        </p>
                      )
                    )}
                    {tr && tr.text && (
                      <p className="gr-translation">
                        <span>
                          {showOriginal.has(m.id)
                            ? t('thread.showingOriginal')
                            : t('thread.translatedFrom', { lang: TRANSLATE_LANGS[tr.lang] ? t(`langs.${tr.lang}`) : tr.lang })}
                        </span>{' '}
                        <button
                          type="button"
                          className="gr-link-btn"
                          onClick={() =>
                            setShowOriginal((prev) => {
                              const next = new Set(prev);
                              if (next.has(m.id)) next.delete(m.id);
                              else next.add(m.id);
                              return next;
                            })
                          }
                        >
                          {showOriginal.has(m.id) ? t('thread.showTranslation') : t('thread.showOriginal')}
                        </button>
                      </p>
                    )}
                    <p className="gr-msg-foot">
                      <time dateTime={m.createdAt}>{new Date(m.createdAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</time>
                      {m.deletedAt ? (
                        <span className="gr-deleted-tag">{t('thread.deletedTag')}</span>
                      ) : (
                        m.direction === 'out' && <span className={m.status === 'failed' ? 'gr-failed' : ''}>{t(`status.${m.status}`)}</span>
                      )}
                      {m.editedAt && !m.deletedAt && <span>{t('thread.edited')}</span>}
                      {m.pinnedAt && <span>{t('thread.pinned')}</span>}
                      {m.ticketId && (
                        <Link href={`/app/groups/tickets?open=${m.ticketId}`} className="gr-ticket-tag">
                          {t('thread.hasTicket')}
                        </Link>
                      )}
                    </p>
                    {m.reactions.length > 0 && (
                      <p className="gr-reactions" aria-label={t('thread.reactions')}>
                        {m.reactions.map((r, i) => (
                          <span key={`${r.by}-${i}`}>{r.emoji}</span>
                        ))}
                      </p>
                    )}
                  </div>
                  {!isEditing && (
                    <div className="gr-msg-actions">
                      {m.direction !== 'note' && !m.deletedAt && (
                        <>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => {
                              setReplyTo(m);
                              setMode('reply');
                              inputRef.current?.focus();
                            }}
                          >
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
                        </>
                      )}
                      <MessageMenu label={t('thread.moreActions')} items={menuItems(m)} />
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
                  <button
                    type="button"
                    onClick={() => {
                      setText(q.body);
                      inputRef.current?.focus();
                    }}
                  >
                    <strong>/{q.shortcut}</strong> {q.body.slice(0, 80)}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {mentionMatches.length > 0 && (
            <ul className="gr-quick" role="listbox" aria-label={t('thread.mentionPeople')}>
              {mentionMatches.map((p, i) => (
                <li key={p.id} role="option" aria-selected={i === mentionIndex}>
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pickMention(i)}>
                    <strong>{p.name || p.email}</strong> {p.name ? p.email : ''}
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
            onChange={(e) => {
              setText(e.target.value);
              setCaret(e.target.selectionStart ?? e.target.value.length);
              setMentionIndex(0);
            }}
            onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
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
          {(undoText !== null || draftSources.length > 0) && (
            <p className="gr-ai-note">
              {draftSources.length > 0 && <span className="ui-help">{t('thread.draftSources', { list: draftSources.join(', ') })}</span>}
              {undoText !== null && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setText(undoText);
                    setUndoText(null);
                    setDraftSources([]);
                  }}
                >
                  {t('thread.undoAi')}
                </button>
              )}
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
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void aiDraft()} aria-busy={aiBusy === 'draft' || aiBusy === 'polish' || undefined}>
                  {text.trim() ? t('thread.aiPolish') : t('thread.aiDraft')}
                </button>
                <select
                  className="select gr-translate-select"
                  value=""
                  onChange={(e) => void translateReply(e.target.value)}
                  aria-label={t('thread.translateReply')}
                  aria-busy={aiBusy === 'translate' || undefined}
                >
                  <option value="">{t('thread.translateReply')}</option>
                  {customerLang && <option value={customerLang}>{t('thread.toCustomerLang', { lang: t(`langs.${customerLang}`) })}</option>}
                  {Object.keys(TRANSLATE_LANGS).map((code) => (
                    <option key={code} value={code}>
                      {t(`langs.${code}`)}
                    </option>
                  ))}
                </select>
              </>
            )}
            <span className="ui-help gr-composer-hint">{mode === 'note' ? t('thread.noteHint') : t('thread.hint')}</span>
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
          compact
        />
      </aside>

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

      <ConfirmDialog
        open={!!deleting}
        title={deleting?.direction === 'note' ? t('thread.deleteNoteTitle') : t('thread.deleteTitle')}
        body={deleting?.direction === 'note' ? t('thread.deleteNoteBody') : t('thread.deleteBody')}
        confirmLabel={deleting?.direction === 'note' ? t('thread.deleteNote') : t('thread.deleteForAll')}
        cancelLabel={t('common.cancel')}
        danger
        busy={deleteBusy}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(null)}
      />

      <ForwardModal
        message={forwarding}
        fromChatId={chat.id}
        onClose={() => setForwarding(null)}
        onDone={(results) => {
          setForwarding(null);
          const ok = results.filter((r) => r.ok).length;
          const bad = results.filter((r) => !r.ok);
          showToast(bad.length ? t('forward.partial', { ok, total: results.length, error: errText(bad[0].error) }) : t('forward.done', { n: ok }), bad.length > 0);
          refresh();
        }}
      />
      {toast}
    </>
  );
}
