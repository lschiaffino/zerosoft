'use client';

import LocalText from '@/components/ui/LocalText';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
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
import TaskModal from './TaskModal';
import { Modal, api, isLeavingChat, useErrorText, useLeavingChat, useMediaText, useToast } from './ui';
import { DEFAULT_RULE, PollFields, PollResults, RecurrenceFields, browserTimezone, checkRule, endsIso } from './RecurringParts';
import type { RecurrenceRule } from '@/lib/groups-recurrence';
import { parseDbUtc } from '@/lib/utils';
import Avatar from './wa/Avatar';
import EmojiPicker from './wa/EmojiPicker';
import { colorIndex, dayLabel, linkify, localDayKey, onlyEmoji } from './wa/format';
import { ContactCard, DocCard, ImageView, LocationCard, VideoView, VoicePlayer } from './wa/MediaParts';
import {
  ArrowDown,
  Ban,
  Chevron,
  ClockIcon,
  Close,
  DocIcon,
  Forwarded,
  Lock,
  Mic,
  Panel,
  PhotoIcon,
  PinIcon,
  Plus,
  PollIcon,
  SendIcon,
  Smiley,
  Sparkle,
  Ticks,
  Trash,
} from './wa/icons';

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const TRANSLATE_STORE = 'zs-groups-translate';
/** Mensajes por página al subir en el hilo. */
const OLDER_PAGE = 100;
/** Mensajes seguidos del mismo remitente dentro de este lapso van juntos (sin repetir nombre ni cola). */
const GROUP_GAP_MS = 5 * 60_000;

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
  /** Número de ejemplo: lo que se manda queda guardado y no sale a WhatsApp. */
  sample?: boolean;
  ticketEmoji: string;
  pinned: MessageDto[];
  teams: Array<{ id: string; name: string }>;
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

/** Formato de audio que el navegador puede grabar (Chrome/Firefox: webm/opus; Safari: mp4). */
function recorderMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported?.(t)) return t;
  }
  return '';
}

/** Quién mandó (para agrupar burbujas seguidas). */
function senderKey(m: MessageDto): string {
  if (m.direction === 'in') return `in:${m.senderPhone || m.senderName}`;
  if (m.direction === 'out') return `out:${m.authorKind}:${m.authorId ?? ''}`;
  return m.direction;
}

/**
 * Un chat o grupo con la cara de WhatsApp Web: burbujas con cola, separadores
 * de día, tildes de entrega, citas, reacciones, media en línea y el composer
 * (emoji, adjuntos, nota de voz). La capa del equipo va arriba sin estorbar:
 * asignación, notas internas, tickets, etiquetas y el panel de detalles.
 * Trae lo nuevo cada 4 s y carga lo anterior al subir. Teclado: R responder,
 * N nota, E cerrar o reabrir, A asignarme, T ticket del último mensaje del
 * cliente, U leído o no leído, P fijar el chat, L traducir.
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
  const [attachment, setAttachment] = useState<{ url: string; mimetype: string; filename: string; ptt?: boolean; caption?: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sendError, setSendError] = useState('');
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [summary, setSummary] = useState<{ text: string; error: string; busy: boolean } | null>(null);
  const [schedule, setSchedule] = useState<{ open: boolean; at: string; busy: boolean; error: string }>({ open: false, at: '', busy: false, error: '' });
  const [pollOpen, setPollOpen] = useState(false);
  const [poll, setPoll] = useState({ question: '', options: ['', ''], multi: false });
  const [pollBusy, setPollBusy] = useState(false);
  const [pollError, setPollError] = useState('');
  const [repeat, setRepeat] = useState(false);
  const [rule, setRule] = useState<RecurrenceRule>(DEFAULT_RULE);
  const [timezone, setTimezone] = useState(browserTimezone);
  const [endsAt, setEndsAt] = useState('');
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
  const [taskFor, setTaskFor] = useState<MessageDto | null>(null);
  const [hasOlder, setHasOlder] = useState(props.messages.length >= 200);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const [recording, setRecording] = useState<{ startedAt: number; elapsed: number } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const requested = useRef<Set<string>>(new Set());
  const pendingCaret = useRef<number | null>(null);
  const keepOffset = useRef<number | null>(null);
  const lastCount = useRef(props.messages.length);
  const lastId = useRef(props.messages[props.messages.length - 1]?.id ?? '');
  const recorder = useRef<{ rec: MediaRecorder; chunks: Blob[]; stream: MediaStream; cancel: boolean } | null>(null);
  const draftKey = `gr-draft:${props.chat.id}`;
  // Desde el clic en otro chat hasta que se abre, este composer queda en pausa.
  const leaving = useLeavingChat(props.chat.id);

  // Borrador por chat: lo escrito no se pierde al cambiar de chat a mitad de camino.
  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(draftKey);
      if (saved) setText(saved);
    } catch {
      // Sin storage: sin borradores.
    }
  }, [draftKey]);
  useEffect(() => {
    try {
      if (text) window.sessionStorage.setItem(draftKey, text);
      else window.sessionStorage.removeItem(draftKey);
    } catch {
      // Sin storage: sin borradores.
    }
  }, [draftKey, text]);

  // Después de insertar una mención o un emoji, el cursor queda justo después.
  useLayoutEffect(() => {
    if (pendingCaret.current === null) return;
    inputRef.current?.focus();
    inputRef.current?.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  }, [text]);

  // El composer crece con el texto hasta 6 líneas, como el de WhatsApp.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 148)}px`;
  }, [text, mode]);

  const peopleById = useMemo(() => new Map(props.people.map((p) => [p.id, p.name || p.email])), [props.people]);
  const nameOf = useCallback((id: string | null | undefined) => (id ? peopleById.get(id) ?? '' : ''), [peopleById]);
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const memberNames = useMemo(() => new Map(props.members.filter((m) => m.name).map((m) => [m.phone, m.name])), [props.members]);
  const viewer = useMemo(() => ({ me: props.me, isAdmin: props.isAdmin }), [props.me, props.isAdmin]);
  const mentionPeople = useMemo(() => props.people.map((p) => ({ id: p.id, name: p.name || null, email: p.email })), [props.people]);

  // Abrir el chat lo marca leído.
  useEffect(() => {
    if (props.chat.unread > 0) void api(`/api/groups/chats/${props.chat.id}`, { method: 'PATCH', body: { read: true } }).then(() => refresh());
  }, [props.chat.id, props.chat.unread, refresh]);

  useEffect(() => setTranslateOn(readTranslatePref(props.chat.id)), [props.chat.id]);

  const scrollToEnd = useCallback((smooth = false) => {
    const box = boxRef.current;
    if (!box) return;
    box.scrollTo({ top: box.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    setUnseen(0);
  }, []);

  // Al abrir: con #m-<id> (Cmd+K, tickets, avisos) va a ese mensaje y lo marca; si no, al final.
  const jumped = useRef(false);
  useLayoutEffect(() => {
    if (jumped.current) return;
    jumped.current = true;
    const hash = window.location.hash.slice(1);
    const target = hash.startsWith('m-') ? document.getElementById(hash) : null;
    if (target) {
      target.scrollIntoView({ block: 'center' });
      target.classList.add('is-target');
      return;
    }
    scrollToEnd();
  }, [scrollToEnd]);

  // Lo nuevo al final: si estábamos abajo se sigue abajo; si no, el botón cuenta lo que llegó.
  // Lo viejo arriba (cargar más): se mantiene lo que se estaba mirando.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    if (keepOffset.current !== null) {
      box.scrollTop = box.scrollHeight - keepOffset.current;
      keepOffset.current = null;
    }
    const last = messages[messages.length - 1];
    if (last && last.id !== lastId.current) {
      const mine = last.direction === 'out' || last.direction === 'note';
      if (atBottom || mine) scrollToEnd();
      else setUnseen((n) => n + Math.max(1, messages.length - lastCount.current));
      lastId.current = last.id;
    }
    lastCount.current = messages.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  // Una imagen que termina de cargar empuja lo último hacia abajo: si estábamos al final, se sigue ahí.
  const keepAtEnd = useCallback(() => {
    if (window.location.hash.startsWith('#m-')) return;
    if (atBottom) scrollToEnd();
  }, [atBottom, scrollToEnd]);

  const merge = useCallback((incoming: MessageDto[]) => {
    if (incoming.length === 0) return;
    setMessages((prev) => {
      const map = new Map(prev.map((m) => [m.id, m]));
      for (const m of incoming) map.set(m.id, m);
      return [...map.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    });
  }, []);

  const loadOlder = useCallback(async () => {
    if (loadingOlder || !hasOlder || messages.length === 0) return;
    setLoadingOlder(true);
    const first = messages[0];
    const res = await api<{ messages: MessageDto[] }>(`/api/groups/chats/${chat.id}/messages?limit=${OLDER_PAGE}&before=${encodeURIComponent(first.createdAt)}`);
    setLoadingOlder(false);
    if (!res.data) return;
    if (res.data.messages.length < OLDER_PAGE) setHasOlder(false);
    if (res.data.messages.length) {
      const box = boxRef.current;
      if (box) keepOffset.current = box.scrollHeight - box.scrollTop;
      merge(res.data.messages);
    }
  }, [loadingOlder, hasOlder, messages, chat.id, merge]);

  function onScroll() {
    const box = boxRef.current;
    if (!box) return;
    const fromEnd = box.scrollHeight - box.scrollTop - box.clientHeight;
    const bottom = fromEnd < 80;
    if (bottom !== atBottom) setAtBottom(bottom);
    if (bottom && unseen) setUnseen(0);
    if (box.scrollTop < 240) void loadOlder();
  }

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

  function insertEmoji(e: string) {
    const el = inputRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + e + text.slice(end);
    setText(next);
    pendingCaret.current = start + e.length;
  }

  async function send(override?: { url: string; mimetype: string; filename: string; ptt?: boolean }) {
    const media = override ?? attachment;
    if (sending || (!text.trim() && !media)) return;
    // Ya se está abriendo otro chat: no se manda (el texto queda como borrador de este chat).
    if (isLeavingChat(chat.id) || !window.location.pathname.includes(`/${chat.id}`)) return;
    setSending(true);
    setSendError('');
    const res = await api<MessageDto>(`/api/groups/chats/${chat.id}/messages`, {
      body: { body: override ? '' : text, note: mode === 'note', replyToId: replyTo?.id ?? null, media: mode === 'note' ? null : media },
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
    if (!override) setText('');
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
      if (emojiOpen) setEmojiOpen(false);
      else if (replyTo) setReplyTo(null);
      else (e.target as HTMLTextAreaElement).blur();
    }
  }

  async function uploadFile(file: File | Blob, name: string): Promise<{ url: string; mimetype: string; filename: string } | null> {
    setUploading(true);
    const form = new FormData();
    form.append('file', file, name);
    try {
      const res = await fetch('/api/groups/upload', { method: 'POST', body: form });
      const data = (await res.json().catch(() => ({}))) as { url?: string; mimetype?: string; filename?: string; error?: string };
      if (!res.ok || !data.url) {
        setSendError(errText(data.error ?? 'upload_failed'));
        return null;
      }
      return { url: data.url, mimetype: data.mimetype ?? file.type, filename: data.filename ?? name };
    } finally {
      setUploading(false);
    }
  }

  async function upload(file: File) {
    const up = await uploadFile(file, file.name);
    if (up) setAttachment(up);
    inputRef.current?.focus();
  }

  // Nota de voz: grabar con el micrófono, ver el tiempo, cancelar o mandar.
  const voiceSupported = typeof window !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && Boolean(recorderMime());
  async function startRecording() {
    if (recording || mode === 'note') return;
    setSendError('');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setSendError(t('wa.micDenied'));
      return;
    }
    const mime = recorderMime();
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const state = { rec, chunks: [] as Blob[], stream, cancel: false };
    rec.ondataavailable = (e) => e.data.size && state.chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((tr) => tr.stop());
      recorder.current = null;
      setRecording(null);
      if (state.cancel || state.chunks.length === 0) return;
      const type = (rec.mimeType || mime || 'audio/webm').split(';')[0];
      const blob = new Blob(state.chunks, { type });
      const up = await uploadFile(blob, `voice-note.${type === 'audio/mp4' ? 'm4a' : type === 'audio/ogg' ? 'ogg' : 'weba'}`);
      if (up) await send({ ...up, ptt: true });
    };
    recorder.current = state;
    rec.start(250);
    setRecording({ startedAt: Date.now(), elapsed: 0 });
  }
  function stopRecording(cancel: boolean) {
    const r = recorder.current;
    if (!r) return;
    r.cancel = cancel;
    if (r.rec.state !== 'inactive') r.rec.stop();
  }
  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setRecording((r) => (r ? { ...r, elapsed: Math.floor((Date.now() - r.startedAt) / 1000) } : r)), 250);
    return () => clearInterval(id);
  }, [recording]);
  // Salir del chat con una grabación abierta la descarta (y suelta el micrófono).
  useEffect(() => () => stopRecording(true), []);

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
    // El ticket desmarca el chat (deja de estar sin responder o vencido): la fila de la lista también.
    refresh();
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
    refresh();
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
    refresh();
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

  async function sendPoll() {
    const options = poll.options.map((o) => o.trim()).filter(Boolean);
    if (!poll.question.trim()) return setPollError(errText('poll_question'));
    if (options.length < 2) return setPollError(errText('poll_options'));
    setPollBusy(true);
    setPollError('');
    const res = await api<MessageDto>(`/api/groups/chats/${chat.id}/messages`, { body: { poll: { ...poll, options } } });
    setPollBusy(false);
    if (!res.data) return setPollError(errText(res.error));
    merge([res.data]);
    if (res.data.status === 'failed') return setPollError(errText(res.data.error || 'send_failed'));
    setPollOpen(false);
    setPoll({ question: '', options: ['', ''], multi: false });
    refresh();
  }

  async function scheduleSend() {
    if (!text.trim()) {
      setSchedule((s) => ({ ...s, error: errText('empty_message') }));
      return;
    }
    if (repeat) {
      const bad = checkRule(rule);
      if (bad) return setSchedule((s) => ({ ...s, error: errText(bad) }));
      setSchedule((s) => ({ ...s, busy: true, error: '' }));
      const res = await api<{ nextRunAt: string | null }>('/api/groups/recurring', {
        body: { chatIds: [chat.id], body: text, media: attachment, rule, timezone, endsAt: endsIso(endsAt) },
      });
      if (!res.data) return setSchedule((s) => ({ ...s, busy: false, error: errText(res.error) }));
      setSchedule({ open: false, at: '', busy: false, error: '' });
      setText('');
      setAttachment(null);
      setRepeat(false);
      showToast(t('recurring.created', { when: res.data.nextRunAt ? parseDbUtc(res.data.nextRunAt).toLocaleString(locale) : '' }));
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

  async function toggleMute() {
    const res = await patchChat({ muted: !chat.muted });
    if (res) showToast(res.muted ? t('wa.muted') : t('wa.unmuted'));
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
    const live = m.direction !== 'note' && !m.deletedAt;
    if (live)
      items.push({
        key: 'reply',
        label: t('thread.reply'),
        onSelect: () => {
          setReplyTo(m);
          setMode('reply');
          inputRef.current?.focus();
        },
      });
    if (live) items.push({ key: 'react', label: t('thread.react'), onSelect: () => setPickerFor(m.id) });
    if (m.body.trim()) items.push({ key: 'copy', label: t('thread.copy'), onSelect: () => void copyText(m) });
    if (can.forward) items.push({ key: 'forward', label: t('thread.forward'), onSelect: () => setForwarding(m) });
    if (can.pin) items.push({ key: 'pin', label: m.pinnedAt ? t('thread.unpin') : t('thread.pin'), onSelect: () => void togglePin(m) });
    if (can.edit) items.push({ key: 'edit', label: t('thread.edit'), onSelect: () => setEditing({ id: m.id, text: m.body, busy: false }) });
    if (live && !m.ticketId) items.push({ key: 'ticket', label: t('wa.createTicket'), onSelect: () => openTicket(m) });
    items.push({ key: 'task', label: t('thread.task'), onSelect: () => setTaskFor(m) });
    if (can.delete)
      items.push({
        key: 'delete',
        label: m.direction === 'note' ? t('thread.deleteNote') : t('thread.deleteForAll'),
        onSelect: () => setDeleting(m),
        danger: true,
      });
    return items;
  }

  /** Quién mandó un mensaje propio (la capa del equipo; WhatsApp no lo muestra). */
  function outAuthor(m: MessageDto): string {
    switch (m.authorKind) {
      case 'agent':
        return t('thread.byAgent');
      case 'phone':
        return t('thread.byPhone');
      case 'broadcast':
        return t('thread.byBroadcast');
      case 'scheduled':
        return t('thread.byScheduled');
      case 'flow':
        return 'Flow';
      case 'api':
        return 'API';
      default:
        return nameOf(m.authorId);
    }
  }

  function inName(m: MessageDto): string {
    return m.senderName || memberNames.get(m.senderPhone) || (m.senderPhone ? `+${m.senderPhone}` : t('wa.someone'));
  }

  const quoteLine = (q: MessageDto) => q.body.slice(0, 160) || mediaText({ media: q.media });
  const quoteAuthor = (q: MessageDto) => (q.direction === 'in' ? (chat.kind === 'group' ? inName(q) : chat.name) : q.direction === 'note' ? t('thread.modeNote') : t('wa.you'));

  const subtitle = chat.kind === 'group' ? `${t('thread.groupMeta', { n: chat.memberCount })} · ${props.numberName}` : `${chat.phone ? `+${chat.phone}` : t('wa.whatsappContact')} · ${props.numberName}`;

  const rows: ReactNode[] = [];
  let prevDay = '';
  let prev: MessageDto | null = null;
  for (const m of messages) {
    const day = localDayKey(m.createdAt);
    if (day !== prevDay) {
      rows.push(
        <div key={`d-${day}`} className="wa-day" role="separator">
          <span>
            <LocalText>{dayLabel(m.createdAt, locale)}</LocalText>
          </span>
        </div>,
      );
      prev = null;
    }
    prevDay = day;
    if (m.direction === 'system') {
      rows.push(<SystemLine key={m.id} m={m} nameOf={nameOf} />);
      prev = null;
      continue;
    }
    const cont = Boolean(prev && senderKey(prev) === senderKey(m) && parseDbUtc(m.createdAt).getTime() - parseDbUtc(prev.createdAt).getTime() < GROUP_GAP_MS);
    prev = m;
    rows.push(renderMessage(m, cont));
  }

  function renderMessage(m: MessageDto, cont: boolean) {
    const quoted = m.replyToId ? byId.get(m.replyToId) : null;
    const isNote = m.direction === 'note';
    const showName = !cont && (isNote || (m.direction === 'in' && chat.kind === 'group') || m.direction === 'out');
    const author = isNote ? nameOf(m.authorId) : m.direction === 'in' ? inName(m) : outAuthor(m);
    const tr = translateOn && m.direction === 'in' ? translations[m.id] : undefined;
    const showTr = tr && tr.text && !showOriginal.has(m.id);
    const isEditing = editing?.id === m.id;
    const meta = m.meta as Record<string, unknown>;
    const media = m.media;
    const kind = media ? (media.type.startsWith('image/') ? 'image' : media.type.startsWith('video/') ? 'video' : media.type.startsWith('audio/') ? 'audio' : 'doc') : '';
    const sticker = meta.sticker === true;
    const bigEmoji = !media && !m.poll && !quoted && !m.deletedAt && onlyEmoji(m.body);
    const location = meta.location as { lat: number; lng: number; name: string; address?: string } | undefined;
    const contact = meta.contact as { name: string; phone: string } | undefined;
    const caption = m.body && !(contact && m.body === contact.name) && !(location && m.body === location.name);
    const color = m.direction === 'in' && chat.kind === 'group' ? `wa-n${colorIndex(m.senderPhone || m.senderName)}` : '';
    const reactions = new Map<string, number>();
    for (const r of m.reactions) reactions.set(r.emoji, (reactions.get(r.emoji) ?? 0) + 1);
    const time = parseDbUtc(m.createdAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    const items = isEditing ? [] : menuItems(m);
    const flush = (kind === 'image' || kind === 'video') && !sticker;
    return (
      <article
        key={m.id}
        className={`gr-msg gr-msg-${m.direction}${m.deletedAt ? ' is-deleted' : ''}${cont ? ' is-cont' : ' has-tail'}${bigEmoji || sticker ? ' is-bare' : ''}${reactions.size ? ' has-reactions' : ''}`}
        id={`m-${m.id}`}
      >
        <div className={`gr-bubble${flush ? ' is-media' : ''}`}>
          {showName && author && (
            <p className={`gr-msg-author ${color}`}>
              {isNote ? (
                <>
                  <Lock size={11} /> {t('thread.noteBy', { name: author })}
                </>
              ) : (
                <>
                  <span>{author}</span>
                  {m.direction === 'in' && chat.kind === 'group' && m.senderName && m.senderPhone && <span className="wa-phone">+{m.senderPhone}</span>}
                </>
              )}
            </p>
          )}
          {m.forwarded && (
            <p className="gr-forwarded">
              <Forwarded size={13} /> {t('thread.forwarded')}
            </p>
          )}
          {quoted && (
            <button
              type="button"
              className={`gr-quote ${quoted.direction === 'in' && chat.kind === 'group' ? `wa-q${colorIndex(quoted.senderPhone || quoted.senderName)}` : quoted.direction === 'in' ? 'wa-q-them' : 'wa-q-me'}`}
              onClick={() => jumpTo(quoted)}
            >
              <strong>{quoteAuthor(quoted)}</strong>
              <span>{quoteLine(quoted)}</span>
            </button>
          )}
          {m.deletedAt && m.direction === 'in' && !m.body && !media ? (
            <p className="wa-deleted">
              <Ban size={15} /> {t('wa.deletedMessage')}
            </p>
          ) : null}
          {media && (
            <div className="gr-media">
              {!media.url ? (
                <DocCard url="" name={media.name} type={media.type} />
              ) : kind === 'image' ? (
                <ImageView url={media.url} alt={media.name || t('thread.image')} sticker={sticker} onLoad={keepAtEnd} />
              ) : kind === 'video' ? (
                <VideoView url={media.url} round={meta.round === true} />
              ) : kind === 'audio' ? (
                <VoicePlayer id={m.id} src={media.url} seconds={Number(meta.seconds) || undefined} voice={meta.ptt === true} />
              ) : (
                <DocCard url={media.url} name={media.name} type={media.type} size={Number(meta.size) || undefined} pages={Number(meta.pages) || undefined} />
              )}
            </div>
          )}
          {location && <LocationCard lat={location.lat} lng={location.lng} name={location.name} address={location.address} />}
          {contact && <ContactCard name={contact.name} phone={contact.phone} />}
          {m.poll ? (
            <PollResults poll={m.poll} />
          ) : isEditing ? (
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
            caption && (
              <p className={`gr-pre wa-text${bigEmoji ? ' is-emoji' : ''}`}>
                {showTr
                  ? tr.text
                  : isNote
                    ? mentionSegments(m.body, mentionPeople).map((seg, i) =>
                        seg.mention ? (
                          <span key={i} className="gr-mention">
                            {seg.text}
                          </span>
                        ) : (
                          <span key={i}>{seg.text}</span>
                        ),
                      )
                    : linkify(m.body).map((p, i) =>
                        p.href ? (
                          <a key={i} href={p.href} target="_blank" rel="noreferrer noopener">
                            {p.text}
                          </a>
                        ) : (
                          <span key={i}>{p.text}</span>
                        ),
                      )}
                {/* Lugar para la hora flotante (como en WhatsApp: el texto no se pisa con la hora). */}
                <span className="wa-spacer" aria-hidden="true" />
              </p>
            )
          )}
          {tr && tr.text && (
            <p className="gr-translation">
              <span>
                {showOriginal.has(m.id) ? t('thread.showingOriginal') : t('thread.translatedFrom', { lang: TRANSLATE_LANGS[tr.lang] ? t(`langs.${tr.lang}`) : tr.lang })}
              </span>{' '}
              <button
                type="button"
                className="gr-link-btn"
                onClick={() =>
                  setShowOriginal((p) => {
                    const next = new Set(p);
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
          {(m.ticketId || (m.direction === 'in' && m.needsReply === true) || m.deletedAt) && (
            <p className="wa-tags">
              {m.deletedAt && <span className="gr-deleted-tag">{t('thread.deletedTag')}</span>}
              {m.ticketId && (
                <Link href={`/app/groups/tickets?open=${m.ticketId}`} className="gr-ticket-tag">
                  {t('thread.hasTicket')}
                </Link>
              )}
              {m.direction === 'in' && m.needsReply === true && <span className="gr-question-tag">{t('thread.question')}</span>}
            </p>
          )}
          <p className="gr-msg-foot">
            {m.pinnedAt && <PinIcon size={12} label={t('thread.pinned')} />}
            {m.editedAt && !m.deletedAt && <span>{t('thread.edited')}</span>}
            <time dateTime={m.createdAt}>
              <LocalText>{time}</LocalText>
            </time>
            {m.direction === 'out' && !m.deletedAt && <Ticks status={m.status} label={t(`status.${m.status}`)} />}
          </p>
          {items.length > 0 && (
            <span className="wa-hover">
              <MessageMenu label={t('thread.moreActions')} items={items} trigger={<Chevron size={18} />} className="wa-chevron" align={m.direction === 'out' ? 'right' : 'left'} />
            </span>
          )}
        </div>
        {reactions.size > 0 && (
          <p className="gr-reactions" aria-label={t('thread.reactions')}>
            {[...reactions].map(([emoji, n]) => (
              <span key={emoji}>
                {emoji}
                {n > 1 && <b>{n}</b>}
              </span>
            ))}
          </p>
        )}
        {!isNote && !m.deletedAt && !isEditing && (
          <div className="gr-msg-actions">
            <button
              type="button"
              className="wa-react-btn"
              onClick={() => setPickerFor(pickerFor === m.id ? null : m.id)}
              aria-expanded={pickerFor === m.id}
              aria-label={t('thread.react')}
              title={t('thread.react')}
            >
              <Smiley size={18} />
            </button>
            {pickerFor === m.id && (
              <span className="gr-emoji-picker" role="group" aria-label={t('thread.react')} onKeyDown={(e) => e.key === 'Escape' && setPickerFor(null)}>
                {[...new Set([...QUICK_EMOJIS, props.ticketEmoji].filter(Boolean))].map((e) => (
                  <button key={e} type="button" onClick={() => void react(m, e)} aria-label={e === props.ticketEmoji ? t('thread.reactTicket', { emoji: e }) : e}>
                    {e}
                  </button>
                ))}
              </span>
            )}
          </div>
        )}
      </article>
    );
  }

  const canSend = Boolean(text.trim() || attachment);

  return (
    <>
      <section className="gr-thread wa-thread" aria-label={chat.name}>
        <header className="gr-thread-head wa-head">
          <Link href="/app/groups/inbox" className="wa-icon-btn gr-back" aria-label={t('thread.back')} title={t('thread.back')}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M15 5 8 12l7 7" />
            </svg>
          </Link>
          <button type="button" className="wa-head-who" onClick={() => setDetailsOpen((v) => !v)} aria-label={t('wa.openInfo', { name: chat.name })}>
            <Avatar name={chat.name} kind={chat.kind} src={chat.pictureUrl} size={40} seed={chat.id} />
            <span className="gr-thread-title">
              <h2>{chat.name}</h2>
              <span className="wa-head-sub">{subtitle}</span>
            </span>
          </button>
          <div className="gr-thread-actions">
            <select className="select wa-assign" value={chat.assignedTo ?? ''} onChange={(e) => void patchChat({ assignedTo: e.target.value || null })} aria-label={t('thread.assignee')}>
              <option value="">{t('thread.unassigned')}</option>
              {props.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name || p.email}
                </option>
              ))}
            </select>
            {props.teams.length > 0 && (
              <select className="select wa-assign" value={chat.assignedTeamId ?? ''} onChange={(e) => void patchChat({ assignedTeamId: e.target.value || null })} aria-label={t('thread.team')}>
                <option value="">{t('thread.noTeam')}</option>
                {props.teams.map((tm) => (
                  <option key={tm.id} value={tm.id}>
                    {tm.name}
                  </option>
                ))}
              </select>
            )}
            <button type="button" className="btn btn-secondary btn-sm wa-close-btn" onClick={() => void patchChat({ status: chat.status === 'open' ? 'closed' : 'open' })}>
              {chat.status === 'open' ? t('thread.close') : t('thread.reopen')} <kbd className="kbd">E</kbd>
            </button>
            <button type="button" className="wa-icon-btn" onClick={() => void summarize()} aria-busy={summary?.busy || undefined} aria-label={t('thread.summary')} title={t('thread.summary')}>
              <Sparkle />
            </button>
            <button type="button" className={`wa-icon-btn${translateOn ? ' is-on' : ''}`} onClick={toggleTranslate} aria-pressed={translateOn} aria-label={`${t('thread.translate')} (L)`} title={`${t('thread.translate')} (L)`}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 5h9M8.5 3v2M6 5c.6 3.3 2.7 6 6 7.5M11 5c-.7 3.6-3 6.4-6.5 8M13 21l4-9 4 9M14.3 18h5.4" />
              </svg>
            </button>
            <MessageMenu
              label={t('thread.chatMenu')}
              className="wa-icon-btn"
              align="right"
              items={[
                { key: 'unread', label: chat.unread > 0 ? t('thread.markRead') : t('thread.markUnread'), onSelect: () => void toggleUnread() },
                { key: 'pin', label: chat.pinned ? t('thread.unpinChat') : t('thread.pinChat'), onSelect: () => void patchChat({ pinned: !chat.pinned }) },
                { key: 'mute', label: chat.muted ? t('wa.unmute') : t('wa.mute'), onSelect: () => void toggleMute() },
                { key: 'details', label: t('thread.details'), onSelect: () => setDetailsOpen((v) => !v) },
              ]}
            />
            <button type="button" className={`wa-icon-btn gr-details-toggle${detailsOpen ? ' is-on' : ''}`} onClick={() => setDetailsOpen((v) => !v)} aria-expanded={detailsOpen} aria-label={t('thread.details')} title={t('thread.details')}>
              <Panel />
            </button>
          </div>
        </header>

        {(chat.flagged || chat.awaitingSince) && (
          <div className={`gr-banner wa-strip${chat.flagged ? ' is-bad' : ''}`} role="status">
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
          <div className="gr-banner wa-strip is-bad" role="alert">
            {translateError}
            <button type="button" className="btn btn-ghost btn-sm" onClick={toggleTranslate}>
              {t('thread.translateOff')}
            </button>
          </div>
        )}

        <PinnedBar pinned={pinned} onJump={jumpTo} onUnpin={(m) => void togglePin(m)} />

        <div className="wa-scroll">
          <div className="gr-messages wa-messages" role="log" aria-live="polite" ref={boxRef} onScroll={onScroll}>
            {hasOlder && (
              <p className="wa-older">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadOlder()} aria-busy={loadingOlder || undefined}>
                  {t('wa.loadOlder')}
                </button>
              </p>
            )}
            {messages.length === 0 && (
              <p className="wa-empty-thread">
                <Lock size={13} /> {t('thread.noMessages')}
              </p>
            )}
            {rows}
            <div ref={endRef} />
          </div>
          {!atBottom && (
            <button type="button" className="wa-to-end" onClick={() => scrollToEnd(true)} aria-label={t('wa.toEnd')} title={t('wa.toEnd')}>
              {unseen > 0 && <span className="wa-to-end-n">{unseen}</span>}
              <ArrowDown size={20} />
            </button>
          )}
        </div>

        <div className={`gr-composer wa-composer${mode === 'note' ? ' is-note' : ''}`}>
          <div className="wa-team-row">
            <div className="gr-composer-tabs wa-mode" role="tablist" aria-label={t('wa.composeAs')}>
              <button type="button" role="tab" className="wa-mode-tab" aria-selected={mode === 'reply'} onClick={() => setMode('reply')}>
                {t('thread.modeReply')} <kbd className="kbd">R</kbd>
              </button>
              <button type="button" role="tab" className="wa-mode-tab" aria-selected={mode === 'note'} onClick={() => setMode('note')}>
                <Lock size={12} /> {t('thread.modeNote')} <kbd className="kbd">N</kbd>
              </button>
            </div>
            {mode === 'reply' && (
              <span className="wa-team-tools">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void aiDraft()} aria-busy={aiBusy === 'draft' || aiBusy === 'polish' || undefined}>
                  <Sparkle size={15} /> {text.trim() ? t('thread.aiPolish') : t('thread.aiDraft')}
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
              </span>
            )}
            <span className="ui-help gr-composer-hint">{mode === 'note' ? t('thread.noteHint') : t('thread.hint')}</span>
          </div>
          {replyTo && (
            <div className="wa-replying">
              <span className={`gr-quote ${replyTo.direction === 'in' ? 'wa-q-them' : 'wa-q-me'}`}>
                <strong>{t('thread.replyingTo')} {quoteAuthor(replyTo)}</strong>
                <span>{quoteLine(replyTo)}</span>
              </span>
              <button type="button" className="wa-icon-btn" onClick={() => setReplyTo(null)} aria-label={t('common.cancel')} title={t('common.cancel')}>
                <Close size={18} />
              </button>
            </div>
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
          {attachment && (
            <p className="gr-attachment wa-attachment">
              {attachment.mimetype.startsWith('image/') ? <PhotoIcon size={18} /> : <DocIcon size={18} />}
              <span>{attachment.filename}</span>
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
          {recording ? (
            <div className="wa-bar wa-recording" role="group" aria-label={t('wa.recording')}>
              <button type="button" className="wa-icon-btn" onClick={() => stopRecording(true)} aria-label={t('wa.discardVoice')} title={t('wa.discardVoice')}>
                <Trash />
              </button>
              <span className="wa-rec-dot" aria-hidden="true" />
              <span className="wa-rec-time" aria-live="off">
                {Math.floor(recording.elapsed / 60)}:{String(recording.elapsed % 60).padStart(2, '0')}
              </span>
              <span className="wa-rec-label">{t('wa.recording')}</span>
              <button type="button" className="wa-send" onClick={() => stopRecording(false)} aria-label={t('wa.sendVoice')} title={t('wa.sendVoice')}>
                <SendIcon />
              </button>
            </div>
          ) : (
            <div className="wa-bar">
              <span className="wa-emoji-wrap">
                <button
                  type="button"
                  className={`wa-icon-btn${emojiOpen ? ' is-on' : ''}`}
                  data-emoji-toggle
                  onClick={() => setEmojiOpen((v) => !v)}
                  aria-expanded={emojiOpen}
                  aria-label={t('wa.emoji')}
                  title={t('wa.emoji')}
                >
                  <Smiley size={24} />
                </button>
                {emojiOpen && (
                  <EmojiPicker
                    onPick={(e) => {
                      insertEmoji(e);
                    }}
                    onClose={() => {
                      setEmojiOpen(false);
                      inputRef.current?.focus();
                    }}
                  />
                )}
              </span>
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
                  <input
                    ref={photoRef}
                    type="file"
                    accept="image/*,video/*"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void upload(f);
                      e.target.value = '';
                    }}
                  />
                  <MessageMenu
                    label={t('thread.attach')}
                    className="wa-icon-btn wa-attach"
                    align="left"
                    trigger={<Plus size={24} />}
                    items={[
                      { key: 'doc', label: t('wa.document'), onSelect: () => fileRef.current?.click() },
                      { key: 'photo', label: t('wa.photos'), onSelect: () => photoRef.current?.click() },
                      { key: 'poll', label: t('polls.button'), onSelect: () => (setPollError(''), setPollOpen(true)) },
                      { key: 'schedule', label: t('thread.schedule'), onSelect: () => setSchedule({ open: true, at: '', busy: false, error: '' }) },
                    ]}
                  />
                </>
              )}
              <textarea
                ref={inputRef}
                className="textarea gr-input wa-input"
                rows={1}
                value={text}
                disabled={leaving}
                onChange={(e) => {
                  setText(e.target.value);
                  setCaret(e.target.selectionStart ?? e.target.value.length);
                  setMentionIndex(0);
                }}
                onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
                onKeyDown={onComposerKey}
                placeholder={mode === 'note' ? t('thread.notePlaceholder') : t('wa.typeMessage')}
                aria-label={mode === 'note' ? t('thread.modeNote') : t('thread.modeReply')}
                aria-busy={uploading || undefined}
              />
              {canSend || mode === 'note' || !voiceSupported ? (
                <button
                  type="button"
                  className="wa-send"
                  onClick={() => void send()}
                  disabled={sending || !canSend}
                  aria-busy={sending || uploading || undefined}
                  aria-label={mode === 'note' ? t('thread.saveNote') : t('thread.send')}
                  title={mode === 'note' ? t('thread.saveNote') : t('thread.send')}
                >
                  {mode === 'note' ? <Lock size={20} /> : <SendIcon />}
                </button>
              ) : (
                <button type="button" className="wa-send is-mic" onClick={() => void startRecording()} aria-label={t('wa.recordVoice')} title={t('wa.recordVoice')}>
                  <Mic size={22} />
                </button>
              )}
            </div>
          )}
          {props.sample && mode !== 'note' && (
            <p className="ui-help gr-sample-note" role="note">
              {t('sample.composerNote')}
            </p>
          )}
        </div>
      </section>

      <aside className={`gr-details${detailsOpen ? ' is-open' : ''}`} aria-label={t('thread.details')}>
        <div className="wa-details-head">
          <Avatar name={chat.name} kind={chat.kind} src={chat.pictureUrl} size={96} seed={chat.id} />
          <strong>{chat.name}</strong>
          <span>{chat.kind === 'group' ? t('thread.groupMeta', { n: chat.memberCount }) : chat.phone ? `+${chat.phone}` : t('wa.whatsappContact')}</span>
          <button type="button" className="wa-icon-btn wa-details-close" onClick={() => setDetailsOpen(false)} aria-label={t('common.close')} title={t('common.close')}>
            <Close size={18} />
          </button>
        </div>
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
          isAdmin={props.isAdmin}
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
          {ticketFor?.body && <p className="gr-quote gr-quote-plain">{ticketFor.body.slice(0, 280)}</p>}
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
              {repeat ? t('recurring.confirm') : t('thread.scheduleConfirm')}
            </button>
          </>
        }
      >
        <div className="ui-fields">
          <p className="ui-help">
            <ClockIcon size={14} /> {text.trim() ? text.slice(0, 200) : t('thread.scheduleNeedsText')}
          </p>
          <label className="gr-check-label">
            <input type="checkbox" className="ui-check" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
            {t('recurring.repeatCheck')}
          </label>
          {repeat ? (
            <RecurrenceFields rule={rule} onChange={setRule} timezone={timezone} onTimezone={setTimezone} endsAt={endsAt} onEndsAt={setEndsAt} />
          ) : (
            <label className="ui-field">
              <span className="label">{t('thread.scheduleAt')}</span>
              <input className="input" type="datetime-local" value={schedule.at} onChange={(e) => setSchedule((s) => ({ ...s, at: e.target.value }))} autoFocus required />
            </label>
          )}
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

      <Modal
        open={pollOpen}
        title={t('polls.title')}
        onClose={() => setPollOpen(false)}
        onSubmit={() => void sendPoll()}
        busy={pollBusy}
        foot={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setPollOpen(false)}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary" aria-busy={pollBusy || undefined} disabled={!props.caps.polls}>
              {t('polls.send')}
            </button>
          </>
        }
      >
        <div className="ui-fields">
          {!props.caps.polls && (
            <p className="gr-banner is-bad" role="alert">
              {t('polls.unsupported')}
            </p>
          )}
          <PollFields question={poll.question} options={poll.options} multi={poll.multi} onChange={setPoll} idPrefix="chat" />
          {pollError && (
            <p className="ui-error" role="alert">
              {pollError}
            </p>
          )}
        </div>
      </Modal>
      {toast}
    </>
  );
}

export { PollIcon };
