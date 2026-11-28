'use client';

import LocalText from '@/components/ui/LocalText';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import LeftGroupBar from '@/components/groups/wa/LeftGroupBar';
import { Link, useRouter } from '@/i18n/navigation';
import { useKeyShortcut } from '@/components/app/QuickModal';
import ReportDialog from './wa/ReportDialog';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { ChatDto, ChatPresence, GroupsPerson, LabelDto, MemberDto, MessageDto, PropertyDef, QuickReply } from '@/lib/groups';
import type { ProviderCaps } from '@/lib/groups-provider';
import { findMentionHits, mentionQueryAt, mentionSegments, mentionSuggestions, mentionText, type Mentionable } from '@/lib/crm-mentions';
import { deleteMentionToken, mentionAlreadyDone, serializeWaMentions, waMentionables, waMentionPicks, waMentionSuggestions, type WaMentionPick } from '@/lib/wa-compose-mentions';
import { MENTION_ALL, mentionAllWord } from '@/lib/wa-mention-all';
import { TRANSLATE_LANGS, messageActions } from '@/lib/groups-inbox-rules';
import { useGroupsInbox } from './InboxShell';
import { fetchIfChanged, withTimeout } from '@/lib/conditional-fetch';
import { coalesced, PRESENCE_EXPIRY_MS, useExpiry, useWaLiveChat } from '@/lib/wa-live-client';
import { isOffline, isTempId, localPreviews, mediaKindOf, TEMP_PREFIX, uploadProgress } from '@/lib/optimistic-send';
import { SEND_TIMEOUT_MS, byArrival, cidOf, discardLinesSend, linesDraftKey, linesQueue, sendLinesMedia, sendLinesText, unsentLines, withLocalMedia, withUnsent } from './optimistic';
import ChatDetails from './ChatDetails';
import PhoneCopy from './wa/PhoneCopy';
import { visiblePhone } from '@/lib/wa-contact-phone';
import { useLinesPersonSheet } from './person-sheet';
import { knownPrivateQuote, peekPendingPrivateReply, setPendingPrivateReply, takePendingPrivateReply } from './private-reply';
import { useDetailsHidden } from './details-hidden';
import { ForwardModal, MessageMenu, PinnedBar, SystemLine, type MenuItem } from './ThreadParts';
import ReplyFromSelect from './ReplyFromSelect';
import { defaultReplyLine } from '@/lib/same-chat';
import AiComposeBar, { AiComposeButton, AiComposeChip, PencilSparkle } from '@/components/ai/AiComposeBar';
import { useComposeInsert } from '@/components/ai/compose-insert';
import { useAiCompose, type ComposeAdapter } from '@/components/ai/useAiCompose';
import { linesCompose } from './ai-compose';
import { useSlashMenu } from '@/components/ui/useSlashMenu';
import { SlashIcon } from '@/components/ui/SlashMenu';
import { useLinesSlashCommands } from './slash-commands';
import { useChatCommands } from '@/components/ui/useChatCommands';
import LinkPreview from './wa/LinkPreview';
import type { InviteJoin } from './wa/InviteCard';
import { linkFromMeta } from './wa/link-preview-data';
import Transcript from './wa/Transcript';
import OlderHistoryChip, { useOlderHistory, type OlderReply } from './wa/OlderHistory';
import RefreshMissingBar, { useRefreshMissing, type RefreshProgress, type RefreshReply } from './wa/RefreshMissing';
import TaskModal from './TaskModal';
import { Modal, api, isLeavingChat, useErrorText, useLeavingChat, useLinesMentions, useMediaText, useToast } from './ui';
import WhenDialog from '@/components/ui/WhenDialog';
import { longWhen } from '@/lib/when-presets';
import { ScheduledStrip, notifyScheduledChanged, useWhenLabels } from './Scheduled';
import { DEFAULT_RULE, PollResults, RecurrenceFields, browserTimezone, checkRule, endsIso } from './RecurringParts';
import type { RecurrenceRule } from '@/lib/groups-recurrence';
import { parseDbUtc } from '@/lib/utils';
import Avatar from './wa/Avatar';
import { FloatingReactPicker, ReactionChip, ReactionDetails } from './wa/Reactions';
import { useDismiss } from './wa/useDismiss';
import type { WaReactor } from '@/lib/wa-reactions';
import type { WaMessageInfo } from '@/lib/wa-receipts';
import MessageInfo from './wa/MessageInfo';
import MentionTextarea from './wa/MentionTextarea';
import RichText from './wa/RichText';
import EmojiPicker from './wa/EmojiPicker';
import { useEmojiSuggest } from './wa/useEmojiSuggest';
import MediaViewer from './wa/MediaViewer';
import AttachPreview from './wa/AttachPreview';
import type { GifItem } from './wa/GifPanel';
import { MAX_TRAY, filesFrom, hasFiles, uploadWithProgress, useAttachTray } from './wa/attachments';
import { linesVoicePayload, longEnough, recordedSoFar, recordedType } from './wa/voice-later';
import { colorIndex, dayLabel, extensionOf, linkify, localDayKey, onlyEmoji, previewUrl } from './wa/format';
import { phoneLabel } from '@/components/inbox/wa/util';
import { ContactCards, DocCard, GifView, ImageView, LocationCard, MissingMedia, StickerMissing, VideoView, VoicePlayer, type MediaRetryResult } from './wa/MediaParts';

/** Comandos del "/" que viven en el campo de texto y no van en ⌘K. */
const LINES_CMDK_SKIP = ['emoji'];
/** Color del punto de cada etiqueta en ⌘K (los de .gr-label-<color> en styles/groups.css). */
const LABEL_SWATCH: Record<string, string> = { gray: 'var(--dim)', red: '#d93a40', orange: '#f2611d', yellow: '#e6b400', green: '#12a150', teal: '#00b8a9', blue: '#2f6bff', purple: '#7b4dff', pink: '#e23d7f' };

/** "Bajar de nuevo" una foto o un video de Lines que quedó sin archivo: el servidor lo vuelve a pedir a WhatsApp. */
async function retryLinesMedia(id: string): Promise<MediaRetryResult> {
  const r = await fetch(`/api/groups/media/${id}`, { method: 'POST' }).catch(() => null);
  if (r?.ok) {
    const { url } = (await r.json()) as { url?: string };
    return url ? { url } : { pending: true };
  }
  return r?.status === 410 ? { gone: true } : r?.status === 409 ? { offline: true } : { pending: true };
}
import MediaAlbum from './wa/MediaAlbum';
import UploadRing from './wa/UploadRing';
import { groupAlbums } from '@/lib/wa-albums';
import {
  ArrowDown,
  Ban,
  Chevron,
  ClockIcon,
  Close,
  Forwarded,
  Lock,
  Mic,
  Panel,
  PinIcon,
  HeartIcon,
  VipIcon,
  FlagIcon,
  Plus,
  SendIcon,
  Smiley,
  Ticks,
  Trash,
  CheckIcon,
  Pause,
  UserPlus,
  CheckCircle,
  GroupIcon,
  ViewOnce,
  Retry,
  InfoIcon,
  TranslateIcon,
  UnreadIcon,
  ReadIcon,
  MuteIcon,
  Bell,
  Sparkle,
  DisplayIcon,
  ArchiveIcon,
  StarIcon,
  CopyIcon,
  ArrowLeft,
  LinkIcon,
  Note,
  Search as SearchIcon,
} from './wa/icons';
import TouchMessageMenu from './wa/TouchMessageMenu';
import { ChatSearchPanel, useChatSearchShortcut, type ChatSearchFn, type ChatSearchHitView } from './wa/ChatSearch';
import { openMenuAt, pointerOf } from './wa/Menu';
import SelectionBar from './wa/SelectionBar';
import { SelectCheck, useMessageSelection } from './wa/useMessageSelection';
import { useBackLayer } from './wa/backLayer';
import { swipeAndHold } from '@/components/inbox/wa/gestures';
import { NewGroupCard } from './wa/GroupEvent';
import { parseEvent } from '@/lib/wa-group-events';
import { keepFocus, tapClosesKeyboard } from './wa/keyboard';
import ContactPicker from './wa/ContactPicker';
import AttachMenu, { type AttachMenuHandle } from './wa/AttachMenu';
import PollDialog, { type PollDraft } from './wa/PollDialog';
import { createSticker } from './wa/StickerPanel';
import LiveWaveform from './wa/LiveWaveform';
import { useComposerLinkPreview } from './wa/ComposerLinkPreview';
import { CHAT_INFO_EVENT, takeChatInfo } from '@/lib/chat-info-request';
import { useFocusOnOpen } from '@/lib/ui/focus-on-open';
import { notifyChatSent, useOnChatSent } from '@/lib/ui/chat-sent';
import { forwardedMany } from '@/lib/wa-forward';
import { groupSubtitle } from '@/lib/wa-group-subtitle';
import HubspotDock from './HubspotDock';
import { showDetailsTab } from './wa/DetailsTabs';

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
  /** null: la app CRM está apagada para quien mira (no se muestra nada del CRM). */
  crm: { contact: { id: string; name: string } | null; company: { id: string; name: string } | null } | null;
  me: string;
  isAdmin: boolean;
  numberName: string;
  /** La línea está vinculada (si no, no se le puede pedir nada al teléfono). */
  numberConnected?: boolean;
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
  const tw = useTranslations('inboxWa');
  const tc = useTranslations('common.aiCompose');
  const ts = useTranslations('common.slash');
  const locale = useLocale();
  const errText = useErrorText();
  const mediaText = useMediaText();
  const { refresh } = useGroupsInbox();
  const [toast, showToast] = useToast();
  const router = useRouter();
  // Toque largo (teléfono): el mensaje marcado, con la barra de reacciones y la hoja de acciones.
  const [held, setHeld] = useState<{ id: string; el: HTMLElement } | null>(null);
  const [deletingSel, setDeletingSel] = useState(false);
  // Info del mensaje: el cuadro al lado del globito (./wa/MessageInfo.tsx).
  const [infoFor, setInfoFor] = useState<{ m: MessageDto; anchor: HTMLElement } | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [chat, setChat] = useState(props.chat);
  // Mandar desde un chat archivado lo desarchiva (como WhatsApp): el menú del chat lo refleja ya.
  useOnChatSent((id) => {
    if (id === props.chat.id) setChat((c) => (c.archived && !c.keepArchived ? { ...c, archived: false } : c));
  });
  const [messages, setMessages] = useState(props.messages);
  const [pinned, setPinned] = useState(props.pinned);
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [mode, setMode] = useState<'reply' | 'note'>('reply');
  const [replyTo, setReplyTo] = useState<MessageDto | null>(null);
  // Respondiendo en privado: el mensaje citado es de un grupo (su nombre va en la cita).
  const [replyChat, setReplyChat] = useState<{ msgId: string; chatName: string } | null>(null);
  const tray = useAttachTray();
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const [viewerAt, setViewerAt] = useState<string | null>(null);
  // Audios que se volvieron a bajar en esta pantalla (por mensaje): la transcripción se vuelve a pedir.
  const [recoveredAudio, setRecoveredAudio] = useState<Record<string, number>>({});
  const previewOpen = mode === 'reply' && tray.items.length > 0;
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 720px)');
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  // Separador "N mensajes sin leer" antes del primero sin leer (solo al abrir, como WhatsApp).
  const [unreadMark] = useState(() => {
    const n = props.chat.unread;
    if (!n) return null;
    const incoming = props.messages.filter((m) => m.direction === 'in');
    const first = incoming[Math.max(0, incoming.length - n)];
    return first ? { id: first.id, n } : null;
  });
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  // "Responder desde" elegido a mano, por chat (cambiar de chat vuelve a la línea por defecto).
  const [pickedFrom, setPickedFrom] = useState<{ chat: string; line: string } | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  // El cuadro de quién reaccionó: el mensaje (el primero del álbum) y su globito.
  const [rxFor, setRxFor] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  // Todos los emojis (el "+" de la barra rápida), para reaccionar con cualquiera.
  const [fullPickerFor, setFullPickerFor] = useState<string | null>(null);
  // La barra rápida de reacciones: un toque afuera o Esc la cierra (el botón de reaccionar la alterna).
  const quickBar = useRef<HTMLSpanElement>(null);
  useDismiss(pickerFor !== null, () => setPickerFor(null), [quickBar, '.wa-react-btn']);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Teléfono: el panel de info tapa el chat; "atrás" lo cierra.
  useBackLayer(detailsOpen, () => setDetailsOpen(false));
  // Pantalla ancha: el panel va al lado y el botón lo esconde o lo muestra (queda guardado).
  // Más angosta: es un cajón que se abre encima.
  const side = useDetailsHidden();
  const detailsShown = side.wide ? !side.hidden : detailsOpen;
  const tg = useTranslations('groups.wa.newGroup');
  // El aviso de creación (quién creó el grupo) para la tarjeta del grupo sin mensajes.
  const createdEvent = useMemo(() => {
    for (const m of messages) {
      const e = m.direction === 'system' && m.authorKind === 'wa' ? parseEvent((m.meta as Record<string, unknown>).sys) : null;
      if (e?.t === 'create') return e;
    }
    return null;
  }, [messages]);
  /** Abre el panel del chat y lleva el foco al campo (agregar miembros, descripción). */
  function openDetailsAt(target: string) {
    if (!detailsShown) toggleDetails();
    // El campo vive en una pestaña del panel: primero esa pestaña.
    showDetailsTab(target === 'add-members' ? 'members' : 'info');
    let tries = 0;
    const focus = () => {
      const el = document.querySelector<HTMLElement>(`[data-focus-target="${target}"]`);
      if (el) {
        el.scrollIntoView({ block: 'center' });
        el.focus();
      } else if (tries++ < 30) requestAnimationFrame(focus);
    };
    requestAnimationFrame(focus);
  }
  /** "Invitar con link": pide el link a WhatsApp y lo copia. */
  async function copyInvite() {
    const res = await api<{ link: string }>(`/api/groups/chats/${chat.id}/members`, { body: { action: 'invite', revoke: false } });
    if (!res.data) return showToast(errText(res.error), true);
    await navigator.clipboard?.writeText(res.data.link).catch(() => null);
    showToast(tg('inviteCopied'));
  }
  const toggleDetails = () => (side.wide ? side.setHidden(!side.hidden) : setDetailsOpen((v) => !v));
  const setDetailsHidden = side.setHidden;
  // "Info del contacto" desde el menú de la fila (clic derecho en la lista): abre los detalles.
  useEffect(() => {
    const showDetails = () => (window.matchMedia('(min-width: 1440px)').matches ? setDetailsHidden(false) : setDetailsOpen(true));
    if (takeChatInfo(chat.id)) showDetails();
    const onInfo = (e: Event) => {
      if ((e as CustomEvent<string>).detail === chat.id && takeChatInfo(chat.id)) showDetails();
    };
    window.addEventListener(CHAT_INFO_EVENT, onInfo);
    return () => window.removeEventListener(CHAT_INFO_EVENT, onInfo);
  }, [chat.id, setDetailsHidden]);
  const [summary, setSummary] = useState<{ text: string; error: string; busy: boolean } | null>(null);
  const [schedule, setSchedule] = useState<{ open: boolean; at: string; busy: boolean; error: string }>({ open: false, at: '', busy: false, error: '' });
  // Enviar más tarde: el selector de "cuándo" (el mismo de Inbox).
  const [later, setLater] = useState(false);
  const whenLabels = useWhenLabels();
  const [pollOpen, setPollOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [presence, setPresence] = useState<ChatPresence | null>(props.chat.presence ?? null);
  // "Escribiendo…" no queda pegado si la otra persona deja de escribir sin más avisos.
  useExpiry(presence?.state === 'composing' || presence?.state === 'recording', presence?.at, PRESENCE_EXPIRY_MS, () => setPresence(null));
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
  // "Reportar" (menú de un mensaje recibido): el mensaje y si está en curso.
  const [reporting, setReporting] = useState<MessageDto | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [forwarding, setForwarding] = useState<MessageDto | MessageDto[] | null>(null);
  const [translateOn, setTranslateOn] = useState(false);
  const [translations, setTranslations] = useState<Record<string, { lang: string; text: string }>>({});
  const [translateError, setTranslateError] = useState('');
  const [showOriginal, setShowOriginal] = useState<Set<string>>(new Set());
  const [mentionIndex, setMentionIndex] = useState(0);
  // Esc cierra la lista de "@" para esa mención (dónde empieza); se vuelve a abrir con otro "@".
  const [mentionClosedAt, setMentionClosedAt] = useState<number | null>(null);
  const [composerFocused, setComposerFocused] = useState(false);
  // Menciones de WhatsApp elegidas de la lista: etiqueta escrita → teléfono (con dos personas del mismo nombre, gana esta).
  const pickedWa = useRef(new Map<string, string>());
  const [pickedVersion, setPickedVersion] = useState(0);
  const [taskFor, setTaskFor] = useState<MessageDto | null>(null);
  const [hasOlder, setHasOlder] = useState(props.messages.length >= 200);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [bottomAt, setBottomAt] = useState(props.messages[props.messages.length - 1]?.createdAt ?? '');
  const [recording, setRecording] = useState<{ startedAt: number; elapsed: number; paused: boolean; carried: number } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // El campo pudo recibir el foco antes de que React lo viera (un clic antes de hidratar): se lee al montar.
  useLayoutEffect(() => setComposerFocused(typeof document !== 'undefined' && document.activeElement === inputRef.current), []); // eslint-disable-line react-hooks/exhaustive-deps
  // Abrir el chat con un clic deja el cursor en el campo, como WhatsApp (no con j/k ni en el teléfono).
  useFocusOnOpen(inputRef, props.chat.id);
  const boxRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const attachRef = useRef<AttachMenuHandle>(null);
  const requested = useRef<Set<string>>(new Set());
  const pendingCaret = useRef<number | null>(null);
  const keepOffset = useRef<number | null>(null);
  const lastCount = useRef(props.messages.length);
  const latestAt = useRef(props.messages[props.messages.length - 1]?.createdAt ?? '');
  const knownIds = useRef(new Set(props.messages.map((m) => m.id)));
  const lastId = useRef(props.messages[props.messages.length - 1]?.id ?? '');
  // La respuesta a la vista cuando termina una grabación (el cierre de la grabadora es de cuando empezó).
  const replyToRef = useRef(replyTo);
  replyToRef.current = replyTo;
  const recorder = useRef<{ rec: MediaRecorder; chunks: Blob[]; stream: MediaStream; cancel: boolean; mime: string; chatId: string } | null>(null);
  // "Enviar más tarde" desde la grabadora: el selector de cuándo abierto, y la nota subiéndose para quedar programada.
  const [voiceLater, setVoiceLater] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const draftKey = linesDraftKey(props.me, props.chat.id);
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
  // Foto de quien manda un audio desde acá (como WhatsApp, que pone la tuya); sin autor (salió del teléfono), la de quien mira.
  const imageOf = useMemo(() => new Map(props.people.map((p) => [p.id, p.image || ''])), [props.people]);
  const outImage = useCallback((id: string | null | undefined) => (id && imageOf.get(id)) || imageOf.get(props.me) || undefined, [imageOf, props.me]);
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const memberNames = useMemo(() => new Map(props.members.filter((m) => m.name).map((m) => [m.phone, m.name])), [props.members]);
  // "Info del contacto" de alguien del grupo (su foto o su nombre en un mensaje): la ficha de WhatsApp.
  const tsheet = useTranslations('groups.wa.contactSheet');
  const personSheet = useLinesPersonSheet(props.chat.id, (code) => showToast(errText(code), true), (text) => showToast(text));
  // Fotos de perfil de los miembros (remitentes del grupo, visor).
  const memberPics = useMemo(() => new Map(props.members.filter((m) => m.picture).map((m) => [m.phone, m.picture!])), [props.members]);
  // Miembros internos (del equipo o de la empresa; lib/internal-contacts.ts): "Interno" al lado de su nombre.
  // Con los teléfonos ocultos dos personas pueden verse igual ("+54 ••• 00"): ahí vale solo la marca del mensaje.
  const internalPhones = useMemo(() => new Set(props.members.filter((m) => m.internal && !(m as { masked?: boolean }).masked).map((m) => m.phone)), [props.members]);
  // "@" en el pie de un archivo (vista previa de adjuntos): los participantes del grupo, con su foto.
  const captionMentionables = useMemo(
    () => (props.chat.kind === 'group' ? props.members.filter((m) => !m.me).map((m) => ({ phone: m.phone, name: m.name, avatar: m.picture || undefined })) : undefined),
    [props.chat.kind, props.members],
  );
  // Menciones de WhatsApp ("@<dígitos>" → "@Nombre"): los miembros y, por mensaje, lo que resolvió el servidor (también lids).
  const { labelsFor: mentionsFor, textOf } = useLinesMentions(props.members);
  // Texto plano con las menciones nombradas (citas, fijados, copiar, tickets). Las notas internas no llevan menciones de WhatsApp.
  const waText = useCallback((m: MessageDto, text: string = m.body) => (m.direction === 'note' ? text : textOf(m, text)), [textOf]);
  // La tarea que sale de un mensaje lleva el texto con las menciones nombradas.
  const taskMessage = useMemo(() => (taskFor ? { id: taskFor.id, body: waText(taskFor) } : null), [taskFor, waText]);
  const viewer = useMemo(() => ({ me: props.me, isAdmin: props.isAdmin }), [props.me, props.isAdmin]);
  // Elegir mensajes: con "Reenviar" solo los que se pueden reenviar (las mismas reglas que aplica el servidor).
  const canPickMsg = (m: MessageDto, forward: boolean) => !isTempId(m.id) && (!forward || messageActions(m, props.caps, viewer).forward);
  const selection = useMessageSelection({
    resetKey: props.chat.id,
    box: boxRef,
    canPick: (id, forward) => {
      const m = messages.find((x) => x.id === id);
      return !!m && canPickMsg(m, forward);
    },
  });
  const { selecting, setSelecting } = selection;
  const mentionPeople = useMemo(() => props.people.map((p) => ({ id: p.id, name: p.name || null, email: p.email })), [props.people]);

  // "Responder en privado" desde un grupo: este chat 1:1 se abre respondiendo al mensaje del grupo.
  useEffect(() => {
    if (!peekPendingPrivateReply(props.chat.id)) return;
    // Después de lo que limpia el composer al cambiar de chat. Se toma recién acá: un montaje que se desarma
    // antes (StrictMode, navegación) no la gasta.
    const id = window.setTimeout(() => {
      const pr = takePendingPrivateReply(props.chat.id);
      if (!pr) return;
      setReplyTo(pr.message);
      setReplyChat({ msgId: pr.message.id, chatName: pr.quote.chatName });
      setMode('reply');
      inputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(id);
  }, [props.chat.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Abrir el chat lo marca leído.
  useEffect(() => {
    if (props.chat.unread > 0) void api(`/api/groups/chats/${props.chat.id}`, { method: 'PATCH', body: { read: true } }).then(() => refresh());
  }, [props.chat.id, props.chat.unread, refresh]);

  useEffect(() => setTranslateOn(readTranslatePref(props.chat.id)), [props.chat.id]);

  const scrollToEnd = useCallback((smooth = false) => {
    const box = boxRef.current;
    if (!box) return;
    box.scrollTo({ top: box.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    setBottomAt(latestAt.current);
  }, []);

  // Al abrir: con #m-<id> (Cmd+K, tickets, avisos) va a ese mensaje y lo marca; si no, al final.
  const jumped = useRef(false);
  useLayoutEffect(() => {
    if (jumped.current) return;
    jumped.current = true;
    const hash = window.location.hash.slice(1);
    const target = hash.startsWith('m-') ? document.getElementById(hash) : null;
    const unreadEl = !target && unreadMark ? document.getElementById('wa-unread') : null;
    const box = boxRef.current;
    // Lo sin leer arranca arriba solo si no entra entero en pantalla; si entra, se ve el final (como WhatsApp).
    if (unreadEl && box && box.scrollHeight - unreadEl.offsetTop > box.clientHeight) {
      unreadEl.scrollIntoView({ block: 'start' });
      boxRef.current?.scrollBy({ top: -80 });
      return;
    }
    if (target) {
      target.scrollIntoView({ block: 'center' });
      target.classList.add('is-target');
      return;
    }
    scrollToEnd();
  }, [scrollToEnd, unreadMark]);

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
      latestAt.current = last.createdAt;
      if (atBottom || mine) scrollToEnd();
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
    for (const m of incoming) knownIds.current.add(m.id);
    setMessages((prev) => {
      const map = new Map(prev.map((m) => [m.id, m]));
      for (const m of incoming) map.set(m.id, m);
      // Con lo que todavía no salió de este chat (./optimistic.ts): la burbuja provisoria se va cuando llega su mensaje
      // guardado, por la respuesta o por el aviso en vivo. Misma hora: por orden de llegada.
      const next = withUnsent([...map.values()], unsentLines.list(props.chat.id), props.me);
      for (const cid of next.settled) queueMicrotask(() => unsentLines.remove(cid));
      return [...next.messages].sort(byArrival);
    });
  }, [props.chat.id, props.me]);

  /** Cursor para pedir los anteriores a `first`: con su orden de llegada no se saltea ningún mensaje de la misma hora. */
  const olderCursor = (first: MessageDto) => (typeof first.seq === 'number' ? `${first.createdAt}~${first.seq}` : first.createdAt);
  // "Cargar mensajes anteriores": cuando lo guardado se terminó, se le piden al teléfono los anteriores
  // (components/groups/wa/OlderHistory.tsx). Lo que llega se suma arriba sin mover lo que se está leyendo.
  const firstRef = useRef<MessageDto | undefined>(undefined);
  firstRef.current = messages[0];
  const olderHistory = useOlderHistory(
    chat.id,
    messages[0]?.id ?? '',
    async (): Promise<OlderReply> => {
      const r = await fetch(`/api/groups/chats/${chat.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'loadOlder' }) }).catch(() => null);
      const body = r ? ((await r.json().catch(() => ({}))) as Omit<OlderReply, 'status'>) : {};
      return { status: r?.status ?? 0, ...body };
    },
    async () => {
      const first = firstRef.current;
      if (!first) return 0;
      const older = await api<{ messages: MessageDto[] }>(`/api/groups/chats/${chat.id}/messages?limit=${OLDER_PAGE}&before=${encodeURIComponent(olderCursor(first))}`);
      const list = older.data?.messages ?? [];
      if (list.length) {
        const box = boxRef.current;
        if (box) keepOffset.current = box.scrollHeight - box.scrollTop;
        merge(list);
      }
      return list.length;
    },
  );

  // Mensajes que WhatsApp no pudo entregar (lib/wa-history-gaps.ts): se le pide el historial del chat al teléfono. Lo que
  // manda llega como historial, con su hora (en el medio del hilo, no al final): se vuelve a traer lo último unas veces.
  const historyTimers = useRef<number[]>([]);
  useEffect(() => () => historyTimers.current.forEach((id) => window.clearTimeout(id)), []);
  const refetchLatest = useCallback(async (limit = OLDER_PAGE) => {
    const res = await api<{ messages: MessageDto[] }>(`/api/groups/chats/${props.chat.id}/messages?limit=${Math.min(500, limit)}`);
    if (res.data?.messages.length) merge(res.data.messages);
  }, [props.chat.id, merge]);
  const watchHistory = useCallback(() => {
    void refetchLatest();
    for (const ms of [3_000, 10_000, 30_000]) historyTimers.current.push(window.setTimeout(() => void refetchLatest(), ms));
  }, [refetchLatest]);
  // "Traer mensajes que faltan" (components/groups/wa/RefreshMissing.tsx): pide, mira qué llegó y lo dice en la franja.
  const postChat = useCallback(async (body: Record<string, unknown>) => {
    const r = await fetch(`/api/groups/chats/${chat.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
    return { status: r?.status ?? 0, body: r ? ((await r.json().catch(() => ({}))) as Record<string, unknown>) : {} };
  }, [chat.id]);
  const shown = useRef(0);
  shown.current = messages.length;
  const refreshMissing = useRefreshMissing(
    chat.id,
    async (): Promise<RefreshReply> => {
      const r = await postChat({ action: 'fetchMissing' });
      return { status: r.status, ...(r.body as Omit<RefreshReply, 'status'>) };
    },
    async () => {
      const r = await postChat({ action: 'fetchMissingStatus' });
      return r.status === 200 ? (r.body as unknown as RefreshProgress) : null;
    },
    () => void refetchLatest(Math.max(OLDER_PAGE, shown.current)),
  );
  // Abrir un chat con la marca: se pide una vez sola, sin aviso (el servidor tiene sus topes).
  // Solo al abrirlo: un hueco que aparece con el chat abierto lo pide el servidor solo (lib/wa-history-gaps.ts).
  const autoHistory = useRef('');
  useEffect(() => {
    if (autoHistory.current === props.chat.id) return;
    autoHistory.current = props.chat.id;
    if (!props.chat.historyGap) return;
    void api<{ ok: boolean }>(`/api/groups/chats/${props.chat.id}`, { body: { action: 'fetchMissing', auto: true } }).then((res) => res.data?.ok && watchHistory());
  }, [props.chat.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadOlder = useCallback(async () => {
    if (loadingOlder || !hasOlder || messages.length === 0) return;
    setLoadingOlder(true);
    const first = messages[0];
    const res = await api<{ messages: MessageDto[] }>(`/api/groups/chats/${chat.id}/messages?limit=${OLDER_PAGE}&before=${encodeURIComponent(olderCursor(first))}`);
    setLoadingOlder(false);
    if (!res.data) return;
    if (res.data.messages.length < OLDER_PAGE) setHasOlder(false);
    if (res.data.messages.length) {
      const box = boxRef.current;
      if (box) keepOffset.current = box.scrollHeight - box.scrollTop;
      merge(res.data.messages);
    }
  }, [loadingOlder, hasOlder, messages, chat.id, merge]);

  const scrollIdle = useRef<ReturnType<typeof setTimeout> | null>(null);
  function markStuck(box: HTMLDivElement) {
    const top = box.getBoundingClientRect().top;
    box.querySelectorAll<HTMLElement>('.wa-dayblock').forEach((b) => {
      const chip = b.firstElementChild as HTMLElement | null;
      chip?.classList.toggle('is-stuck', b.getBoundingClientRect().top < top - 4);
    });
  }

  function onScroll() {
    const box = boxRef.current;
    if (!box) return;
    markStuck(box);
    box.classList.add('is-scrolling');
    if (scrollIdle.current) clearTimeout(scrollIdle.current);
    scrollIdle.current = setTimeout(() => box.classList.remove('is-scrolling'), 1200);
    const fromEnd = box.scrollHeight - box.scrollTop - box.clientHeight;
    const bottom = fromEnd < 80;
    if (bottom !== atBottom) setAtBottom(bottom);
    if (bottom && bottomAt !== latestAt.current) setBottomAt(latestAt.current);
    if (box.scrollTop < 240) void loadOlder();
  }

  // Los últimos 60: lo nuevo y los cambios en lo reciente (estado, reacciones, ediciones, llamadas). Con el aviso en
  // vivo andando (lib/wa-live-client.ts) se releen apenas algo cambia en este chat, y cada 20 s como red de seguridad;
  // sin el aviso, cada 4 s como antes.
  const pollNow = useRef<() => void>(() => {});
  const { live: liveOn } = useWaLiveChat(
    'groups',
    chat.id,
    () => pollNow.current(),
    (chat.lines ?? []).map((l) => l.chatId),
  );
  useEffect(() => {
    // Una relectura a la vez; un pedido que llega mientras corre otra no se pierde: corre una más al terminar.
    const poll = coalesced(async () => {
      if (document.visibilityState === 'visible') await pollOnce();
    });
    pollNow.current = poll;
    let etag = '';
    const pollOnce = async () => {
      // Con ETag: si no cambió nada desde la última consulta, no se vuelve a armar ni a dibujar el hilo.
      const r = await fetchIfChanged<{ messages: MessageDto[]; presence?: ChatPresence | null }>(`/api/groups/chats/${chat.id}/messages?limit=60`, etag);
      if (r.state !== 'fresh') return;
      etag = r.etag;
      const res = { data: r.data };
      setPresence(res.data.presence ?? null);
      const fresh = res.data.messages.filter((m) => !knownIds.current.has(m.id));
      merge(res.data.messages);
      // Con el chat abierto y a la vista, lo que llega queda leído (como en WhatsApp).
      if (fresh.some((m) => m.direction === 'in') && document.hasFocus()) {
        void api(`/api/groups/chats/${chat.id}`, { method: 'PATCH', body: { read: true } }).then(() => refresh());
      }
    };
    const id = setInterval(poll, liveOn ? 20_000 : 4000);
    // Al volver a la pestaña o a la ventana: lo nuevo en el acto (y queda leído si llegó algo).
    const onBack = () => poll();
    document.addEventListener('visibilitychange', onBack);
    window.addEventListener('focus', onBack);
    return () => {
      clearInterval(id);
      pollNow.current = () => {};
      document.removeEventListener('visibilitychange', onBack);
      window.removeEventListener('focus', onBack);
    };
  }, [chat.id, merge, refresh, liveOn]);

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

  // "@" en una nota abre las personas del equipo; en un grupo de WhatsApp, los participantes (como WhatsApp). La
  // mención sale como mención de verdad (avisa a la persona). "/" abre los comandos y las respuestas rápidas, más abajo.
  const waMentions = mode === 'reply' && chat.kind === 'group' && !editing;
  // "@all" (o "@todos"): todo el grupo, solo si la línea lo puede mandar (lib/wa-mention-all.ts). Las notas internas no.
  const allWord = chat.kind === 'group' && props.caps.mentionAll && !props.sample ? mentionAllWord(locale) : null;
  const waPeople = useMemo(() => waMentionables(props.members, pickedWa.current, allWord), [props.members, pickedVersion, allWord]); // eslint-disable-line react-hooks/exhaustive-deps
  const mentionPool = mode === 'note' && !editing ? mentionPeople : waMentions ? waPeople : null;
  const mentionHits = useMemo(() => (mentionPool ? findMentionHits(text, mentionPool) : []), [text, mentionPool]);
  const mentionQuery = mentionPool ? mentionQueryAt(text, caret) : null;
  // La lista del "@" se ve solo con el campo en foco: tocar afuera la cierra y volver al campo la vuelve a abrir.
  const mentionOpen = !!mentionQuery && composerFocused && mentionClosedAt !== mentionQuery.start && !mentionAlreadyDone(mentionQuery.start, caret, mentionHits);
  const mentionList = (q: string, pool: Mentionable[]) => (waMentions ? waMentionSuggestions(q, pool, 50) : mentionSuggestions(q, pool, 6));
  const mentionMatches = mentionOpen && mentionPool ? mentionList(mentionQuery.query, mentionPool) : [];
  const memberCount = props.members.filter((m) => !m.me).length;

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

  // "Ayudame a escribir": el borrador sale con el contexto de este chat y vuelve al composer para revisarlo.
  const hasMessages = messages.some((m) => m.direction === 'in' || m.direction === 'out');
  const aiAdapter = useMemo<ComposeAdapter>(
    () => ({
      canSuggest: hasMessages,
      languages: [
        ...(customerLang ? [{ code: customerLang, label: t('thread.toCustomerLang', { lang: t(`langs.${customerLang}`) }) }] : []),
        ...Object.keys(TRANSLATE_LANGS).map((code) => ({ code, label: t(`langs.${code}`) })),
      ],
      run: (request, _onText, signal) => linesCompose(chat.id, request, signal),
    }),
    [chat.id, customerLang, hasMessages, t],
  );
  const ai = useAiCompose({
    adapter: aiAdapter,
    text,
    setText,
    focusComposer: () => inputRef.current?.focus(),
    resetKey: chat.id,
  });
  const aiAllowed = mode === 'reply' && !editing && !leaving;
  // La respuesta sugerida de la pestaña AI del panel: va al campo (modo WhatsApp) con Deshacer; nunca se manda sola.
  // Editando un mensaje o con una nota interna a medio escribir no se pisa nada (el panel avisa): una nota nunca pasa
  // al campo de WhatsApp. Desde la solapa de nota vacía, Deshacer vuelve a ella. En el teléfono el panel tapa el
  // chat: se cierra para ver el campo.
  useComposeInsert(chat.id, (draft) => {
    if (leaving || editing) return false;
    const wasNote = mode === 'note';
    if (wasNote && text.trim()) return false;
    setMode('reply');
    ai.insertText(draft, wasNote ? () => setMode('note') : undefined);
    if (!side.wide) setDetailsOpen(false);
    return true;
  });

  // Comandos con "/": las acciones de este hilo (los mismos handlers que sus botones), las respuestas rápidas y la AI.
  // Con el menú abierto no se muestran las menciones ni los emojis de ":".
  const linesCommands = useLinesSlashCommands({
    chat,
    me: props.me,
    people: props.people,
    teams: props.teams,
    labels: props.labels,
    caps: props.caps,
    mode,
    messages,
    translateOn,
    ai: aiAllowed ? ai : null,
    patchChat,
    setMode,
    openTicket,
    openTask: setTaskFor,
    openLater: () => openLater(),
    attach: () => attachRef.current?.pickFiles(),
    openPoll: () => setPollOpen(true),
    openContact: () => setContactOpen(true),
    openEmoji: () => setEmojiOpen(true),
    toggleMute: () => void toggleMute(),
    toggleUnread: () => void toggleUnread(),
    toggleArchived: () => void patchChat({ archived: !chat.archived }).then((res) => res && showToast(res.archived ? t('wa.archived') : t('wa.unarchived'))),
    summarize: () => void summarize(),
    toggleTranslate,
    toggleDetails,
    manageQuickReplies: () => router.push('/app/lines/settings?tab=quick'),
  });

  const slash = useSlashMenu({
    text,
    caret,
    inputRef,
    disabled: !!editing || leaving,
    apply: (next, at) => {
      setText(next);
      setCaret(at);
    },
    inserts: mode === 'reply' ? props.quickReplies : [],
    insertsLabel: t('thread.quickReplies'),
    commands: linesCommands,
  });

  function pickMention(i: number) {
    const p = mentionMatches[i];
    if (!p || !mentionQuery) return;
    if (waMentions && p.name) {
      pickedWa.current.set(p.name, p.id);
      setPickedVersion((v) => v + 1);
    }
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

  async function post(body: Record<string, unknown>): Promise<MessageDto | null> {
    // Por la misma cola que los textos y los archivos: una nota no se adelanta a lo que todavía está saliendo.
    const res = await linesQueue(chat.id)(() => api<MessageDto>(`/api/groups/chats/${chat.id}/messages`, { body, signal: withTimeout(undefined, SEND_TIMEOUT_MS) }));
    if (!res.data) {
      setSendError(errText(res.error));
      return null;
    }
    merge([res.data]);
    return res.data;
  }

  /**
   * Manda lo del composer: el texto, o los archivos de la bandeja (el texto
   * va como pie del primero, como en WhatsApp). Textos y archivos aparecen ya
   * en el chat con el reloj y salen por detrás, en orden (./optimistic.ts):
   * un archivo que todavía se está subiendo se manda igual y sigue subiendo
   * desde su burbuja. El composer queda libre para lo próximo.
   */
  async function send() {
    const pending = mode === 'note' ? [] : tray.items;
    // Lo que falló al subirse queda en la bandeja (reintentar o sacar); lo demás sale, subido o subiéndose.
    const files = pending.filter((f) => f.status !== 'error');
    if (sending) return;
    if (!text.trim() && files.length === 0) return;
    // Sin red los textos quedan en cola, los archivos no: necesitan conexión para subirse. Quedan en la bandeja.
    if (files.length && isOffline()) return setSendError(errText('offline_files'));
    // Ya se está abriendo otro chat: no se manda (el texto queda como borrador de este chat).
    if (isLeavingChat(chat.id) || !window.location.pathname.includes(`/${chat.id}`)) return;
    setSendError('');
    // Mandado a WhatsApp (no una nota interna): la lista sale de la búsqueda, como WhatsApp.
    if (mode !== 'note') notifyChatSent(chat.id);
    const base = { note: mode === 'note', replyToId: replyTo?.id ?? null };
    if (files.length) {
      files.forEach((f, i) => {
        const taken = tray.take(f.key);
        if (!taken) return;
        // En un grupo, "@Ana" del pie sale como "@<teléfono>" con la lista de mencionados (como un texto).
        const out = chat.kind === 'group' && f.captionOut?.mentions.length ? f.captionOut : null;
        const caption = ((out ? out.body : f.caption) ?? '').trim();
        const kind = mediaKindOf(f.type);
        // Audio no lleva pie: el texto va aparte, después.
        const withCaption = kind !== 'audio';
        const cid = sendLinesMedia({
          chatId: chat.id,
          ...(via ? { via } : {}),
          replyToId: i === 0 ? base.replyToId : null,
          body: withCaption ? caption : '',
          ...(withCaption && out ? { mentions: out.mentions } : {}),
          file: f.file,
          preview: f.preview,
          upload: taken.done,
          media: { kind, name: f.uploaded?.filename ?? f.name, type: f.type, size: f.uploaded?.size ?? f.size, width: f.uploaded?.width ?? f.width, height: f.uploaded?.height ?? f.height, duration: f.uploaded?.duration, url: f.uploaded?.url },
        });
        taken.onProgress((p) => uploadProgress.set(cid, p));
        if (f.progress) uploadProgress.set(cid, f.progress);
        if (!withCaption && caption) sendTextNow(caption, null, out?.mentions ?? []);
      });
      if (text.trim() && !previewOpen) sendTextNow(text, null);
    } else if (mode === 'note') {
      setSending(true);
      const ok = Boolean(await post({ ...base, body: text, media: null }));
      setSending(false);
      if (!ok) return;
    } else {
      // Texto solo: la burbuja aparece ya y el envío sigue por detrás (el composer queda libre para el próximo).
      // En un grupo, "@Nombre" sale como "@<teléfono>" con la lista de mencionados: WhatsApp avisa y muestra el nombre.
      const out = chat.kind === 'group' ? serializeWaMentions(text, waPeople) : { body: text, mentions: [] };
      sendTextNow(out.body, base.replyToId, out.mentions, !linkPv.linkPreview);
      pickedWa.current.clear();
    }
    // Respondido: el chat deja de esperar (el servidor ya lo marcó).
    if (mode === 'reply') setChat((c) => ({ ...c, awaitingSince: null, flagged: false }));
    if (!files.length) {
      setText('');
      linkPv.reset();
    }
    setReplyTo(null);
    ai.clearUndo();
    refresh();
    inputRef.current?.focus();
  }

  /**
   * Manda un texto con la burbuja ya a la vista: "enviando" hasta que el servidor responde; después el mensaje
   * guardado la reemplaza, o queda como no enviada con reintentar. El envío y lo pendiente viven fuera de este
   * componente (./optimistic.ts): si falla cuando ya se abrió otro chat, al volver a este la burbuja sigue acá.
   */
  function sendTextNow(body: string, replyToId: string | null, mentions: string[] = [], noPreview = false) {
    void sendLinesText(
      unsentLines.add({ chatId: chat.id, body, replyToId, ...(mentions.length ? { mentions } : {}), ...(noPreview ? { noPreview: true } : {}), ...(via ? { via } : {}) }).clientId,
    );
  }
  // Lo pendiente de este chat, a la vista: al abrirlo (lo que no salió antes sigue acá) y cada vez que cambia.
  useEffect(() => {
    // Lo pendiente es de esta persona: lo que quedó de otra en la misma pestaña no se ve ni se manda.
    unsentLines.setOwner(props.me);
    const show = () =>
      setMessages((prev) => {
        const next = withUnsent(prev, unsentLines.list(props.chat.id), props.me);
        for (const cid of next.settled) queueMicrotask(() => unsentLines.remove(cid));
        return next.messages;
      });
    show();
    const stop = unsentLines.subscribe((e) => {
      if (e.chatId !== props.chat.id) return;
      if (e.type === 'saved') {
        merge([e.saved]);
        if (e.saved.status === 'failed') setSendError(errText(e.saved.error || 'send_failed'));
        else refresh();
        return;
      }
      show();
      if (e.type === 'failed') setSendError(errText(e.entry.error));
    });
    const chatId = props.chat.id;
    return () => {
      stop();
      // Al cerrar el chat, lo ya guardado suelta su copia local (lo que sigue saliendo la conserva).
      localPreviews.releaseScope(`lines:${chatId}`);
    };
  }, [props.chat.id, props.me, merge, refresh, errText]);

  /** Vuelve a mandar el MISMO mensaje que no salió (misma burbuja: enviando, después enviado o no enviado). */
  async function retrySend(m: MessageDto) {
    setSendError('');
    // Una burbuja que nunca llegó al servidor: se manda de nuevo como recién escrita.
    if (isTempId(m.id)) return sendLinesText(m.id.slice(TEMP_PREFIX.length));
    merge([{ ...m, status: 'pending', error: '' }]);
    const res = await api<MessageDto>(`/api/groups/messages/${m.id}`, { body: { action: 'retry' } });
    if (!res.data) {
      merge([m]);
      return setSendError(errText(res.error));
    }
    merge([res.data]);
    if (res.data.status === 'failed') setSendError(errText(res.data.error || 'send_failed'));
    else refresh();
  }

  function addFiles(files: File[]) {
    if (files.length === 0) return;
    setMode('reply');
    setSendError('');
    tray.add(files, text.trim() && tray.items.length === 0 ? text : undefined);
    if (text.trim() && tray.items.length === 0) setText('');
    inputRef.current?.focus();
  }

  // Vista previa del link que se está escribiendo (arriba del campo, con X para no mandarla).
  const linkPv = useComposerLinkPreview(text, { disabled: mode === 'note' || !!editing || tray.items.length > 0 || recording != null });

  const emojiSuggest = useEmojiSuggest({
    text,
    caret,
    disabled: !!editing || slash.open,
    apply: (start, end, emoji) => {
      const next = text.slice(0, start) + emoji + text.slice(end);
      setText(next);
      const at = start + emoji.length;
      setCaret(at);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(at, at);
      });
    },
  });

  function onComposerKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (slash.onKeyDown(e)) return;
    if (!editing && emojiSuggest.onKeyDown(e)) return;
    if (mentionMatches.length > 0 && !slash.open) {
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
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (mentionQuery) setMentionClosedAt(mentionQuery.start);
        return;
      }
    }
    // Borrar contra una mención la saca entera (como WhatsApp): no queda medio nombre que ya no menciona a nadie.
    if ((e.key === 'Backspace' || e.key === 'Delete') && !editing && mentionHits.length && !e.altKey && !e.metaKey && !e.ctrlKey) {
      const el = e.currentTarget;
      const cut = deleteMentionToken(text, el.selectionStart, el.selectionEnd, e.key, mentionHits);
      if (cut) {
        e.preventDefault();
        setText(cut.text);
        setCaret(cut.caret);
        pendingCaret.current = cut.caret;
        return;
      }
    }
    // ⌘J (Ctrl+J) en el campo: "Ayudame a escribir", como en Inbox.
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'j' && aiAllowed) {
      e.preventDefault();
      e.stopPropagation();
      ai.openBar();
      return;
    }
    // ⌘⇧Enter (Ctrl+Shift+Enter): enviar más tarde, como en Inbox.
    if (e.key === 'Enter' && e.shiftKey && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
      e.preventDefault();
      openLater();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (editing) void saveEdit();
      else void send();
    }
    if (e.key === 'Escape') {
      // Primero lo del composer; si no hay nada, Esc sigue de largo (cierra los detalles y después el chat, como WhatsApp).
      if (emojiOpen || editing || replyTo) e.preventDefault();
      if (emojiOpen) setEmojiOpen(false);
      else if (editing) setEditing(null);
      else if (replyTo) setReplyTo(null);
    }
  }

  // Nota de voz: grabar con el micrófono, ver el tiempo, cancelar o mandar.
  // Se sabe recién en el navegador (el servidor no tiene micrófono): después de montar, para no romper la hidratación.
  const [voiceSupported, setVoiceSupported] = useState(false);
  useEffect(() => setVoiceSupported(Boolean(navigator.mediaDevices?.getUserMedia) && Boolean(recorderMime())), []);
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
    // El chat y la respuesta de cuando se grabó: la nota va ahí aunque se cambie de chat mientras se sube.
    const chatId = chat.id;
    const state = { rec, chunks: [] as Blob[], stream, cancel: false, mime, chatId };
    rec.ondataavailable = (e) => e.data.size && state.chunks.push(e.data);
    rec.onstop = () => {
      const seconds = Math.max(1, Math.round(recSecs() || 1));
      stream.getTracks().forEach((tr) => tr.stop());
      recorder.current = null;
      setRecording(null);
      setVoiceLater(false);
      setVoiceBusy(false);
      if (state.cancel || state.chunks.length === 0) return;
      const type = recordedType(rec, mime);
      const name = `voice-note.${type === 'audio/mp4' ? 'm4a' : type === 'audio/ogg' ? 'ogg' : 'weba'}`;
      const file = new File(state.chunks, name, { type });
      // La burbuja aparece ya, con el reloj y el audio que se puede escuchar; la subida y el envío siguen por detrás.
      notifyChatSent(chatId);
      sendLinesMedia({ chatId, ...(via ? { via } : {}), body: '', replyToId: replyToRef.current?.id ?? null, file, media: { kind: 'voice', name, type, size: file.size, duration: seconds } });
      setReplyTo(null);
      setChat((c) => ({ ...c, awaitingSince: null, flagged: false }));
      refresh();
    };
    recorder.current = state;
    rec.start(250);
    setRecording({ startedAt: Date.now(), elapsed: 0, paused: false, carried: 0 });
  }
  const recordingRef = useRef(recording);
  recordingRef.current = recording;
  /** Segundos grabados (sin contar las pausas). */
  function recSecs(): number {
    const r = recordingRef.current;
    if (!r) return 0;
    return r.carried + (r.paused ? 0 : (Date.now() - r.startedAt) / 1000);
  }
  function togglePause() {
    const r = recorder.current;
    const st = recordingRef.current;
    if (!r || !st) return;
    if (st.paused) {
      r.rec.resume();
      setRecording({ ...st, paused: false, startedAt: Date.now() });
    } else {
      r.rec.pause();
      setRecording({ ...st, paused: true, carried: st.carried + (Date.now() - st.startedAt) / 1000 });
    }
  }
  function stopRecording(cancel: boolean) {
    const r = recorder.current;
    if (!r) return;
    r.cancel = cancel;
    if (r.rec.state !== 'inactive') r.rec.stop();
  }
  /** El reloj de la grabadora: la grabación queda en pausa y se elige cuándo sale. Menos de un segundo no se programa. */
  function openVoiceLater() {
    if (!recorder.current || !recordingRef.current || voiceBusy) return;
    if (!longEnough(recSecs())) return showToast(t('later.voiceTooShort'), true);
    if (!recordingRef.current.paused) togglePause();
    setVoiceLater(true);
  }
  /**
   * Sube lo grabado y lo programa para `iso` como nota de voz. Recién cuando quedó programado se cierra la grabadora:
   * si algo falla, la grabación sigue ahí, en pausa.
   */
  async function scheduleVoice(iso: string) {
    setVoiceLater(false);
    const r = recorder.current;
    if (!r || voiceBusy) return;
    setVoiceBusy(true);
    const seconds = recSecs();
    const quote = replyToRef.current;
    const fail = (code?: string | null) => {
      setVoiceBusy(false);
      showToast(errText(code || 'upload_failed'), true);
    };
    const file = await recordedSoFar(r.rec, r.chunks, recordedType(r.rec, r.mime));
    if (!file) return fail('voice_too_short');
    let up: Awaited<ReturnType<typeof uploadWithProgress>['done']>;
    try {
      up = await uploadWithProgress(file, () => {}).done;
    } catch (err) {
      return fail((err as Error).message || 'upload_failed');
    }
    const res = await api<{ id: string }>('/api/groups/broadcasts', {
      body: linesVoicePayload({ chatId: r.chatId, scheduledAt: iso, media: { url: up.url, mimetype: up.mimetype || file.type, filename: up.filename || file.name }, seconds, replyToId: quote?.id ?? null }),
    });
    if (!res.data) return fail(res.error);
    // Programada: la grabadora se cierra sin mandar nada ahora.
    stopRecording(true);
    setReplyTo(null);
    notifyScheduledChanged();
    showToast(t('later.toast', { when: longWhen(iso, locale) }));
  }
  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setRecording((r) => (r ? { ...r, elapsed: Math.floor(r.carried + (r.paused ? 0 : (Date.now() - r.startedAt) / 1000)) } : r)), 250);
    return () => clearInterval(id);
  }, [recording]);
  // Salir del chat con una grabación abierta la descarta (y suelta el micrófono).
  useEffect(() => () => stopRecording(true), []);

  async function react(m: MessageDto, emoji: string) {
    setPickerFor(null);
    setFullPickerFor(null);
    const mine = m.reactions.find((r) => r.fromMe && r.emoji === emoji);
    const res = await api<MessageDto>(`/api/groups/messages/${m.id}`, { body: { action: 'react', emoji: mine ? '' : emoji } });
    if (res.data) {
      merge([res.data]);
      if (!mine && emoji === props.ticketEmoji) showToast(t('thread.ticketByReaction'));
    } else showToast(errText(res.error), true);
  }

  // Info del mensaje: quién lo recibió y lo leyó, con sus horas (enmascarado si esta persona no ve teléfonos).
  function openInfo(m: MessageDto) {
    const row = document.getElementById(`m-${m.id}`);
    const anchor = row?.querySelector<HTMLElement>('.gr-bubble') ?? row;
    if (anchor) setInfoFor({ m, anchor });
  }
  async function loadInfo(id: string): Promise<WaMessageInfo | null> {
    const res = await api<{ info: WaMessageInfo }>(`/api/groups/chats/${props.chat.id}/members?info=${encodeURIComponent(id)}`);
    return res.data && res.data.info && typeof res.data.info === 'object' ? res.data.info : null;
  }

  // Quién reaccionó (nombre, foto y teléfono; enmascarado si esta persona no ve teléfonos), para el cuadro de reacciones.
  async function loadReactions(ids: string[]): Promise<WaReactor[] | null> {
    const res = await api<{ reactions: WaReactor[] }>(`/api/groups/chats/${props.chat.id}/members?reactions=${encodeURIComponent(ids.join(','))}`);
    return res.data && Array.isArray(res.data.reactions) ? res.data.reactions : null;
  }

  function openTicket(m: MessageDto) {
    setTicketFor(m);
    setTicketTitle((waText(m).split('\n').find((l) => l.trim()) ?? '').slice(0, 120));
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

  /** Reportar: queda marcado en el chat (y en su log); a la vez, bloquear (1:1) o salir del grupo si se marcó. */
  async function confirmReport(opts: { block: boolean; leave: boolean }) {
    if (!reporting) return;
    setReportBusy(true);
    const res = await api<{ message: MessageDto; blocked: boolean; left: boolean; error?: string }>(`/api/groups/messages/${reporting.id}`, { body: { action: 'report', ...opts } });
    setReportBusy(false);
    setReporting(null);
    if (!res.data) return showToast(errText(res.error), true);
    merge([res.data.message]);
    if (res.data.blocked || res.data.left) router.refresh();
    if (res.data.error) return showToast(t('wa.report.partial', { error: errText(res.data.error) }), true);
    showToast(res.data.blocked ? t('wa.report.doneBlocked', { name: chat.name }) : res.data.left ? t('wa.report.doneLeft') : t('wa.report.done'));
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

  // Los destacados de la pantalla: si cambian, la info del chat vuelve a leer su lista.
  const starredKey = messages
    .filter((m) => (m.meta as Record<string, unknown>).starred === true)
    .map((m) => m.id)
    .join(',');
  // Las notas internas de la pantalla (y si se borró alguna): la pestaña Notas vuelve a leer su lista.
  const notesKey = messages
    .filter((m) => m.direction === 'note')
    .map((m) => `${m.id}${m.deletedAt ? '-' : ''}`)
    .join(',');

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

  // Buscar en el chat (la lupa de la cabecera): components/groups/wa/ChatSearch.tsx.
  const [searchOpen, setSearchOpen] = useState(false);
  useChatSearchShortcut(() => setSearchOpen(true));
  // Las acciones del "/" también en ⌘K (como Superhuman), más buscar en el chat.
  useChatCommands(chat.name, linesCommands, { prefix: 'lines-chat', skip: LINES_CMDK_SKIP, swatch: (c) => LABEL_SWATCH[c] }, [
    { id: 'lines-chat:search', label: t('wa.chatSearch.open'), meta: '⌘⇧F', keywords: 'search find', run: () => setSearchOpen(true) },
  ]);
  // Teléfono: el panel tapa el chat; "atrás" lo cierra.
  useBackLayer(searchOpen && narrow, () => setSearchOpen(false));
  useEffect(() => setSearchOpen(false), [chat.id]);
  const searchChat = useCallback<ChatSearchFn>(
    async (q, before) => {
      const res = await api<{ hits: ChatSearchHitView[]; more: boolean }>(
        `/api/groups/chats/${chat.id}/messages?${new URLSearchParams({ q, ...(before ? { before } : {}) })}`,
      );
      return res.data ?? null;
    },
    [chat.id],
  );
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  /** Ir a un resultado: si es más viejo que lo cargado, se cargan los anteriores hasta llegar (como mucho unos 3000). */
  async function jumpToHit(hit: ChatSearchHitView, covering: boolean) {
    if (covering) setSearchOpen(false);
    let found = messagesRef.current.find((x) => x.id === hit.id);
    let first = messagesRef.current[0];
    for (let page = 0; !found && first && page < 6; page++) {
      const res = await api<{ messages: MessageDto[] }>(`/api/groups/chats/${chat.id}/messages?limit=500&before=${encodeURIComponent(olderCursor(first))}`);
      const list = res.data?.messages ?? [];
      if (!list.length) break;
      merge(list);
      if (list.length < 500) setHasOlder(false);
      found = list.find((x) => x.id === hit.id);
      first = list[0];
    }
    if (!found) {
      showToast(t('thread.pinnedOld'));
      return;
    }
    const target = found;
    // Espera a que el mensaje esté pintado (recién cargado o con la info cerrada en el teléfono).
    let tries = 0;
    const go = () => {
      if (document.getElementById(`m-${target.id}`) || tries++ > 30) jumpTo(target);
      else requestAnimationFrame(go);
    };
    requestAnimationFrame(go);
  }

  async function copyText(m: MessageDto) {
    try {
      await navigator.clipboard.writeText(waText(m));
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

  /** La encuesta del menú +: '' si salió (el diálogo se cierra), o el código de error. */
  async function sendPoll(poll: PollDraft): Promise<string> {
    const res = await api<MessageDto>(`/api/groups/chats/${via || chat.id}/messages`, { body: { poll } });
    if (!res.data) return res.error || 'send_failed';
    merge([res.data]);
    if (res.data.status === 'failed') return res.data.error || 'send_failed';
    setPollOpen(false);
    refresh();
    return '';
  }

  /** Dictar con Voice: el texto entra en el campo (como en Inbox). */
  function dictate() {
    inputRef.current?.focus();
    window.dispatchEvent(new Event('zs:voice-dictate'));
  }

  /** "Sticker nuevo" del menú +: lo crea desde la imagen (queda en la colección) y lo manda. */
  async function newSticker(file: File) {
    const r = await createSticker('/api/groups/stickers', stickerLine, file);
    if (!r.sticker) {
      showToast(r.error === 'sticker_too_large' ? t('wa.stickers.tooLarge') : r.error === 'sticker_convert_unavailable' ? t('wa.stickers.convertUnavailable') : t('wa.stickers.createFailed'), true);
      return;
    }
    await sendSticker(r.sticker.id);
  }

  // La bandeja de ahora (para lo que espera una subida dentro de una función async).
  const trayNow = useRef(tray.items);
  trayNow.current = tray.items;

  function scheduledMedia() {
    const f = tray.items.find((x) => x.status === 'ready');
    return f ? { url: f.url, mimetype: f.type, filename: f.name } : null;
  }

  /**
   * Lo que saldría si se programa ahora: el texto (o el pie del archivo) y
   * hasta un archivo. Si no se puede programar, el motivo, para decirlo.
   */
  function laterDraft(items = tray.items): { body: string; media: { url: string; mimetype: string; filename: string } | null; mentions: WaMentionPick[] } | { reason: string } {
    if (items.some((f) => f.status === 'uploading')) return { reason: t('wa.waitUploads') };
    const files = items.filter((f) => f.status === 'ready');
    if (files.length > 1) return { reason: t('later.oneFile') };
    const f = files[0];
    const caption = (f?.caption ?? '').trim();
    const body = (caption || text.trim()).slice(0, 4096);
    if (!body && !f?.url) return { reason: t('later.needsText') };
    // En un grupo, las menciones van con el programado (al salir "@Nombre" pasa a "@<teléfono>"): las del pie del
    // archivo (a quién se eligió en su lista) o, sin pie, las del campo del chat.
    const mentions = chat.kind !== 'group' ? [] : caption && f?.captionOut?.picks ? f.captionOut.picks : waMentionPicks(body, waPeople);
    return { body, media: f?.url ? { url: f.url, mimetype: f.type, filename: f.name } : null, mentions };
  }

  /** Abre el selector de "cuándo" (reloj junto a Enviar, clic derecho en Enviar, ⌘⇧Enter o el menú +). */
  function openLater(fromPreview = false) {
    if (mode !== 'reply' || editing || later) return;
    // Desde la vista previa de un archivo el selector se abre aunque la foto editada se esté subiendo todavía: se
    // vuelve a mirar al elegir la hora.
    if (fromPreview && tray.items.length === 1) return setLater(true);
    const d = laterDraft();
    if ('reason' in d) return showToast(d.reason, true);
    setLater(true);
  }

  /** Programa lo del composer para `iso`. Queda en la tira del chat; el aviso trae Deshacer. */
  async function scheduleLater(iso: string) {
    setLater(false);
    // El archivo (la foto editada en la vista previa) puede estar terminando de subir: se espera un poco.
    for (let i = 0; i < 300 && trayNow.current.some((f) => f.status === 'uploading'); i++) await new Promise((r) => setTimeout(r, 200));
    const d = laterDraft(trayNow.current);
    if ('reason' in d) return showToast(d.reason, true);
    const quote = replyTo;
    const mentions = d.mentions;
    const res = await api<{ id: string }>('/api/groups/broadcasts', {
      body: { chatIds: [chat.id], body: d.body, media: d.media, scheduledAt: iso, kind: 'scheduled', replyToId: quote?.id ?? null, ...(mentions.length ? { mentions } : {}) },
    });
    if (!res.data) return showToast(errText(res.error), true);
    const id = res.data.id;
    setText('');
    tray.clear();
    setReplyTo(null);
    ai.clearUndo();
    notifyScheduledChanged();
    inputRef.current?.focus();
    showToast(t('later.toast', { when: longWhen(iso, locale) }), false, {
      label: t('later.undo'),
      onClick: () =>
        void (async () => {
          const del = await api(`/api/groups/broadcasts/${id}`, { method: 'DELETE' });
          notifyScheduledChanged();
          if (!del.data) return showToast(errText(del.error), true);
          // El texto vuelve al cuadro (si no escribió otra cosa mientras tanto); el archivo hay que adjuntarlo de nuevo.
          setText((cur) => cur || d.body);
          if (quote) setReplyTo((cur) => cur ?? quote);
          showToast(d.media ? t('later.undoneFile') : t('later.undone'));
          inputRef.current?.focus();
        })(),
    });
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
      const media = scheduledMedia();
      // El texto sale como pie del archivo (si hay uno), con sus menciones.
      const mentions = chat.kind === 'group' ? waMentionPicks(text, waPeople) : [];
      const res = await api<{ nextRunAt: string | null }>('/api/groups/recurring', {
        body: { chatIds: [chat.id], body: text, media, rule, timezone, endsAt: endsIso(endsAt), ...(mentions.length ? { mentions } : {}) },
      });
      if (!res.data) return setSchedule((s) => ({ ...s, busy: false, error: errText(res.error) }));
      setSchedule({ open: false, at: '', busy: false, error: '' });
      setText('');
      tray.clear();
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
    const media = scheduledMedia();
    const mentions = chat.kind === 'group' ? waMentionPicks(text, waPeople) : [];
    const res = await api('/api/groups/broadcasts', {
      body: { chatIds: [chat.id], body: text, media, scheduledAt: new Date(when).toISOString(), kind: 'scheduled', ...(mentions.length ? { mentions } : {}) },
    });
    if (!res.data) {
      setSchedule((s) => ({ ...s, busy: false, error: errText(res.error) }));
      return;
    }
    setSchedule({ open: false, at: '', busy: false, error: '' });
    setText('');
    tray.clear();
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
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.closest('[role="dialog"], [role="menu"], [role="alertdialog"]') || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !el.classList.contains('wa-input'))) return;
      if (document.querySelector('dialog[open], [role="dialog"]:not(dialog):not([hidden]), [role="alertdialog"]:not(dialog), [role="menu"], .wa-viewer')) return;
      if (searchOpen) {
        setSearchOpen(false);
        return;
      }
      if (detailsOpen) {
        setDetailsOpen(false);
        return;
      }
      router.push(`/app/lines/inbox${window.location.search}`);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /** Abre el menú (la flecha) de un mensaje o una fila; con `at` (el clic derecho), en el puntero. */
  function openMenuIn(el: HTMLElement, at?: { x: number; y: number }) {
    openMenuAt(el.querySelector<HTMLButtonElement>('.wa-chevron, .wa-row-chevron'), at);
  }

  function menuItems(m: MessageDto): MenuItem[] {
    const can = messageActions(m, props.caps, viewer);
    const items: MenuItem[] = [];
    const live = m.direction !== 'note' && !m.deletedAt;
    const starred = (m.meta as Record<string, unknown>).starred === true;
    const mayRetry = props.isAdmin || m.authorId === props.me;
    // Una burbuja que todavía no está guardada: si espera la red, borrarla antes de que salga; si no salió,
    // reintentar o quitar. Mientras sale, nada.
    if (isTempId(m.id)) {
      if (m.status === 'queued') return [{ key: 'remove', label: t('wa.deleteQueued'), onSelect: () => discardLinesSend(m.id.slice(TEMP_PREFIX.length)) }];
      if (m.status !== 'failed') return [];
      return [
        { key: 'retry', label: t('wa.retry'), onSelect: () => void retrySend(m) },
        { key: 'remove', label: t('common.remove'), onSelect: () => discardLinesSend(m.id.slice(TEMP_PREFIX.length)) },
      ];
    }
    // El orden de WhatsApp: info, responder, reaccionar, descargar, destacar, fijar, reenviar, copiar, editar |
    // responder en privado, mensaje a quien lo mandó | eliminar | seleccionar. Debajo, la capa del equipo.
    if (m.direction === 'out' && m.status === 'failed' && mayRetry) items.push({ key: 'retry', label: t('wa.retry'), onSelect: () => void retrySend(m) });
    if (m.direction === 'out') items.push({ key: 'info', label: t('wa.messageInfo'), onSelect: () => openInfo(m) });
    if (live)
      items.push({
        key: 'reply',
        label: t('thread.reply'),
        onSelect: () => {
          setReplyTo(m);
          setReplyChat(null);
          setMode('reply');
          inputRef.current?.focus();
        },
      });
    if (live) items.push({ key: 'react', label: t('thread.react'), onSelect: () => setPickerFor(m.id) });
    if (m.media?.url && !m.deletedAt) items.push({ key: 'download', label: t('wa.download'), onSelect: () => downloadMedia(m) });
    if (!m.deletedAt) items.push({ key: 'star', label: starred ? t('wa.unstar') : t('wa.star'), onSelect: () => void toggleStar(m) });
    if (can.pin) items.push({ key: 'pin', label: m.pinnedAt ? t('thread.unpin') : t('thread.pin'), onSelect: () => void togglePin(m) });
    if (can.forward) items.push({ key: 'forward', label: t('thread.forward'), onSelect: () => selection.startForward(m.id) });
    if (m.body.trim() && !m.deletedAt) items.push({ key: 'copy', label: t('thread.copy'), onSelect: () => void copyText(m) });
    if (can.edit) items.push({ key: 'edit', label: t('thread.edit'), onSelect: () => startEdit(m) });
    if (m.media?.kind === 'sticker' && m.media.url && !m.media.pending && !m.deletedAt) items.push({ key: 'stickerFav', label: t('wa.stickers.addFavorite'), onSelect: () => void favoriteSticker(m.id) });
    // Grupo, mensaje de otra persona: escribirle por privado (con la cita o sin ella), como en WhatsApp.
    if (chat.kind === 'group' && m.direction === 'in' && !m.deletedAt && m.senderPhone) {
      items.push({ key: 'replyPrivately', label: t('wa.replyPrivately'), divider: true, onSelect: () => void openPrivateChat(m, true) });
      items.push({ key: 'messageSender', label: t('wa.messageName', { name: inName(m) }), onSelect: () => void openPrivateChat(m, false) });
    }
    // Reportar lo que mandó otra persona, como WhatsApp (una vez; después queda la banderita).
    if (m.direction === 'in' && !m.deletedAt && !(m.meta as Record<string, unknown>).reported)
      items.push({ key: 'report', label: t('wa.report.action'), divider: true, onSelect: () => setReporting(m) });
    if (can.delete)
      items.push({
        key: 'delete',
        label: m.direction === 'note' ? t('thread.deleteNote') : t('thread.deleteForAll'),
        onSelect: () => setDeleting(m),
        danger: true,
        divider: true,
      });
    items.push({ key: 'select', label: t('wa.select'), divider: !can.delete, onSelect: () => setSelecting(new Set([m.id])) });
    // Capa del equipo, debajo.
    const team: MenuItem[] = [];
    if (live && !m.ticketId) team.push({ key: 'ticket', label: t('wa.createTicket'), onSelect: () => openTicket(m) });
    team.push({ key: 'task', label: t('thread.task'), onSelect: () => setTaskFor(m) });
    if (team.length) team[0] = { ...team[0], divider: true };
    return [...items, ...team];
  }

  /** "Enviar mensaje" en una tarjeta de contacto: su chat 1:1 en la misma línea (se crea si no existe). El servidor lee el número de la tarjeta. */
  async function openCardChat(m: MessageDto, card: number) {
    const res = await api<{ id: string }>(`/api/groups/chats/${chat.id}/members`, { body: { action: 'message', messageId: m.id, card } });
    if (!res.data) return showToast(errText(res.error), true);
    router.push(`/app/lines/inbox/${res.data.id}${window.location.search}`);
  }

  /**
   * "Unirme al grupo" en una invitación: entra con la línea por la que llegó el mensaje (en un chat de varias
   * líneas, la suya). El servidor revisa que quien mira vea esa línea, como para crear un chat.
   */
  function inviteJoinFor(m: MessageDto, url: string): InviteJoin | undefined {
    if (!props.caps.groups || props.sample) return undefined;
    const line = chat.lines?.find((l) => l.chatId === m.chatId);
    const numberId = line?.lineId ?? chat.numberId;
    return {
      lineName: line?.name || props.numberName,
      run: async () => {
        const res = await api<{ id: string; name?: string }>('/api/groups/join', { body: { numberId, invite: url } });
        return res.data ? { ok: true, id: res.data.id, name: res.data.name } : { ok: false, code: res.error };
      },
      onOpen: (id) => router.push(`/app/lines/inbox/${id}${window.location.search}`),
    };
  }

  /** "Mensaje a <persona>" o "Responder en privado": su chat 1:1 en la misma línea (se crea si no existe). */
  async function openPrivateChat(m: MessageDto, quote: boolean) {
    const res = await api<{ id: string }>(`/api/groups/chats/${chat.id}/members`, { body: { action: 'message', messageId: m.id } });
    if (!res.data) return showToast(errText(res.error), true);
    if (quote) setPendingPrivateReply(res.data.id, m, { id: chat.id, name: chat.name });
    router.push(`/app/lines/inbox/${res.data.id}${window.location.search}`);
  }

  async function favoriteSticker(messageId: string) {
    const res = await api('/api/groups/stickers', { body: { action: 'favoriteMessage', messageId } });
    showToast(res.data ? t('wa.stickers.favorited') : t('wa.stickers.favoriteFailed'), !res.data);
  }

  /** Un sticker del panel: la media para mandarlo (lib/wa-stickers.ts) y sale como cualquier archivo del chat. */
  async function sendSticker(id: string): Promise<boolean> {
    const res = await api<{ media: Record<string, unknown> }>('/api/groups/stickers', { body: { action: 'use', id } });
    if (!res.data) {
      setSendError(t('wa.stickers.sendFailed'));
      return false;
    }
    // Ya está subido: sale por la cola del chat como cualquier archivo (burbuja al instante, reintentar si no sale).
    const m = res.data.media as { url: string; mimetype?: string; filename?: string; size?: number; width?: number; height?: number };
    notifyChatSent(chat.id);
    void sendLinesText(
      unsentLines.add({
        chatId: chat.id,
        ...(via ? { via } : {}),
        body: '',
        replyToId: replyTo?.id ?? null,
        media: { kind: 'sticker', url: m.url, type: m.mimetype || 'image/webp', name: m.filename || 'sticker.webp', size: m.size ?? 0, width: m.width, height: m.height },
      }).clientId,
    );
    setReplyTo(null);
    return true;
  }

  /** Un GIF de la pestaña GIFs: el servidor baja el MP4 y lo guarda, y sale como video con gifPlayback. '' si salió. */
  async function sendGif(g: GifItem): Promise<string> {
    const res = await api<{ media: Record<string, unknown> }>('/api/groups/gifs', { body: { url: g.mp4, width: g.width, height: g.height } });
    if (!res.data) return res.error || 'send_failed';
    const sent = await post({ note: false, replyToId: replyTo?.id ?? null, body: '', media: res.data.media });
    if (sent) setReplyTo(null);
    return sent ? '' : 'send_failed';
  }

  function downloadMedia(m: MessageDto) {
    if (!m.media?.url) return;
    const a = document.createElement('a');
    a.href = m.media.url;
    a.download = m.media.name || '';
    a.rel = 'noreferrer';
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function toggleStar(m: MessageDto) {
    const starred = (m.meta as Record<string, unknown>).starred === true;
    const res = await api<MessageDto>(`/api/groups/messages/${m.id}`, { body: { action: starred ? 'unstar' : 'star' } });
    if (res.data) merge([res.data]);
    else showToast(errText(res.error), true);
  }

  /** Guarda un contacto compartido en el CRM. */
  async function saveContact(name: string, phone: string) {
    const [first, ...rest] = name.trim().split(/\s+/);
    const res = await api('/api/crm/contacts', { body: { firstName: first || name, lastName: rest.join(' '), phone: phone ? `+${phone}` : '' } });
    showToast(res.data ? t('wa.contactSaved', { name }) : errText(res.error), !res.data);
  }

  /** Editar como en WhatsApp: el texto va al composer con la barra "Editar mensaje". */
  function startEdit(m: MessageDto) {
    setEditing({ id: m.id, text: m.body, busy: false });
    setReplyTo(null);
    setMode(m.direction === 'note' ? 'note' : 'reply');
    setTimeout(() => {
      inputRef.current?.focus();
      const len = inputRef.current?.value.length ?? 0;
      inputRef.current?.setSelectionRange(len, len);
    }, 0);
  }

  async function copySelected() {
    if (!selecting) return;
    const text = messages
      .filter((m) => selecting.has(m.id) && m.body.trim())
      .map((m) => `[${parseDbUtc(m.createdAt).toLocaleString(locale, { day: 'numeric', month: 'numeric', hour: 'numeric', minute: '2-digit' })}] ${m.direction === 'in' ? inName(m) : m.direction === 'note' ? nameOf(m.authorId) : t('wa.you')}: ${waText(m)}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      showToast(t('common.copied'));
    } catch {
      showToast(errText('generic'), true);
    }
    setSelecting(null);
  }

  async function starSelected() {
    if (!selecting) return;
    // Como WhatsApp (e Inbox): si alguno no está destacado se destacan todos; si ya lo estaban todos, se sacan.
    const chosen = messages.filter((m) => selecting.has(m.id) && !m.deletedAt && !isTempId(m.id));
    const star = chosen.some((m) => (m.meta as Record<string, unknown>).starred !== true);
    for (const { id } of chosen) {
      const res = await api<MessageDto>(`/api/groups/messages/${id}`, { body: { action: star ? 'star' : 'unstar' } });
      if (res.data) merge([res.data]);
    }
    setSelecting(null);
  }

  const selectedMsgs = () => messages.filter((m) => selecting?.has(m.id) && !isTempId(m.id));
  const canForward = (m: MessageDto) => messageActions(m, props.caps, viewer).forward;
  const canDelete = (m: MessageDto) => messageActions(m, props.caps, viewer).delete;

  /** Borra los elegidos (para todos en WhatsApp; una nota, del chat). */
  async function deleteSelected() {
    const list = selectedMsgs();
    setDeletingSel(false);
    setSelecting(null);
    let ok = 0;
    for (const target of list) {
      const res = await api<{ removed: boolean; message: MessageDto | null }>(`/api/groups/messages/${target.id}`, { method: 'DELETE' });
      if (!res.data) continue;
      ok++;
      if (res.data.removed) setMessages((all) => all.filter((m) => m.id !== target.id));
      else if (res.data.message) merge([res.data.message]);
      setPinned((all) => all.filter((p) => p.id !== target.id));
    }
    refresh();
    showToast(t('wa.deleteSelectedDone', { n: ok }), ok < list.length);
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
    return m.senderName || memberNames.get(m.senderPhone) || phoneLabel(m.senderPhone) || t('wa.someone');
  }

  // Las menciones se nombran antes de cortar: un corte en medio de "@<dígitos>" dejaría el número a la vista.
  const quoteLine = (q: MessageDto) => waText(q).slice(0, 160) || mediaText({ media: q.media });
  /** En el selector de "cuándo": qué va a salir (texto, archivo, cita). */
  const laterPreview = () => {
    const d = laterDraft();
    if ('reason' in d) return null;
    return (
      <>
        {d.body && <span className="gr-later-preview">{d.body.slice(0, 300)}</span>}
        {d.media && <span className="gr-later-note">{t('later.withFile', { name: d.media.filename })}</span>}
        {replyTo && <span className="gr-later-note">{t('later.asReply', { text: quoteLine(replyTo).slice(0, 80) })}</span>}
      </>
    );
  };
  const quoteAuthor = (q: MessageDto) => (q.direction === 'in' ? (chat.kind === 'group' ? inName(q) : chat.name) : q.direction === 'note' ? t('thread.modeNote') : t('wa.you'));

  const assignee = chat.assignedTo ? nameOf(chat.assignedTo) : '';
  const teamName = props.teams.find((tm) => tm.id === chat.assignedTeamId)?.name ?? '';
  // Como WhatsApp Web: los que tienen nombre, después los teléfonos, y "Vos" al final (nunca el número de la línea).
  const memberLine = groupSubtitle(
    props.members.map((mb) => ({ name: mb.name, phone: phoneLabel(mb.phone), me: mb.me })),
    t('wa.you'),
    chat.memberCount,
  );
  // Como WhatsApp: "escribiendo…" o "grabando audio…" reemplaza la línea de abajo del nombre; "en línea" solo en un 1 a 1.
  const presenceText = presence
    ? presence.state === 'available'
      ? chat.kind === 'dm'
        ? t('wa.online')
        : ''
      : chat.kind === 'group' && presence.name
        ? t(presence.state === 'recording' ? 'wa.recordingBy' : 'wa.typingBy', { name: presence.name })
        : t(presence.state === 'recording' ? 'wa.recordingAudio' : 'wa.typing')
    : '';
  const subtitle =
    chat.kind === 'group'
      ? memberLine || t('thread.groupMeta', { n: chat.memberCount })
      : phoneLabel(chat.phone) || t('wa.whatsappContact');

  // "Responder desde": por defecto, la línea del último mensaje que entró o salió (si puede mandar), si no la del chat
  // abierto. Elegir otra queda hasta cambiar de chat.
  const lastLineChat = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if ((m.direction === 'in' || m.direction === 'out') && !isTempId(m.id)) return m.chatId;
    }
    return null;
  })();
  const pickedLine = pickedFrom?.chat === chat.id ? pickedFrom.line : null;
  const replyLine = pickedLine &&chat.lines?.some((l) => l.chatId === pickedLine && l.canSend) ? pickedLine : (defaultReplyLine(chat.lines ?? [], lastLineChat, chat.id)?.chatId ?? chat.id);
  // El chat por el que sale (vacío: el abierto). Las notas internas siempre quedan en el abierto.
  const via = (chat.lines?.length ?? 0) > 1 && replyLine !== chat.id ? replyLine : '';
  // Los stickers son por línea: los de la línea por la que sale la respuesta (la del chat, o la elegida en "Responder desde").
  const stickerLine = chat.lines?.find((l) => l.chatId === (via || chat.id))?.lineId ?? chat.numberId;
  // El mismo chat en varias líneas: cada mensaje sabe por cuál entró o salió (MessageDto.chatId). La etiqueta de la
  // línea va en el primero y cada vez que cambia; todos la llevan en el título de la hora.
  const lineNames = new Map((chat.lines ?? []).map((l) => [l.chatId, l.name]));
  const lineTags = new Set<string>();
  if (lineNames.size > 1) {
    let last = '';
    for (const m of messages) {
      if (m.direction !== 'in' && m.direction !== 'out') continue;
      if (m.chatId !== last) lineTags.add(m.id);
      last = m.chatId;
    }
  }
  // Un bloque por día: su chip de fecha queda arriba (y flota solo mientras se recorre ese día).
  const days: Array<{ key: string; at: string; items: ReactNode[] }> = [];
  let prev: MessageDto | null = null;
  // Fotos y videos mandados juntos van en un álbum (lib/wa-albums.ts): una tanda, una burbuja.
  const runs = groupAlbums(messages, (m) => ({
    media: (m.media?.kind === 'image' || m.media?.kind === 'video') && Boolean(m.media.url) && !m.media.viewOnce && !m.deletedAt && !m.replyToId && !m.poll && m.status !== 'failed' && (m.direction === 'in' || m.direction === 'out'),
    key: `${senderKey(m)}|${localDayKey(m.createdAt)}|${m.forwarded ? 'f' : ''}|${lineNames.size > 1 ? m.chatId : ''}`,
    at: parseDbUtc(m.createdAt).getTime(),
    caption: Boolean(m.body.trim()),
    start: unreadMark?.id === m.id,
  }));
  for (const run of runs) {
    const m = run[0];
    const day = localDayKey(m.createdAt);
    if (days.at(-1)?.key !== day) {
      days.push({ key: day, at: m.createdAt, items: [] });
      prev = null;
    }
    const rows = days[days.length - 1].items;
    if (m.direction === 'system') {
      rows.push(<SystemLine key={m.id} m={m} nameOf={nameOf} />);
      prev = null;
      continue;
    }
    if (unreadMark?.id === m.id) {
      rows.push(
        <div key="wa-unread" id="wa-unread" className="wa-unread-sep" role="separator">
          <span>{t('wa.unreadCount', { n: unreadMark.n })}</span>
        </div>,
      );
      prev = null;
    }
    const cont = Boolean(prev && senderKey(prev) === senderKey(m) && !lineTags.has(m.id));
    prev = run[run.length - 1];
    rows.push(run.length > 1 ? renderMessage(prev, cont, run) : renderMessage(m, cont));
  }
  const rows = days.map((d) => (
    <section key={`d-${d.key}`} className="wa-dayblock">
      <div className="wa-day" role="separator">
        <span>
          <LocalText>{dayLabel(d.at, locale)}</LocalText>
        </span>
      </div>
      {d.items}
    </section>
  ));

  /** `album`: las fotos y videos que van juntos con `m` (la última); la burbuja es la de `m` con la grilla en vez de una foto. */
  function renderMessage(m: MessageDto, cont: boolean, album?: MessageDto[]) {
    const quoted = m.replyToId ? byId.get(m.replyToId) : null;
    // Respuesta en privado: el citado es de un grupo (viene del servidor o, recién mandado, de acá).
    const privateQuote = !quoted && m.replyToId ? (m.replyQuote ?? knownPrivateQuote(m.replyToId)) : null;
    const isNote = m.direction === 'note';
    // Lo propio mandado desde el teléfono no lleva firma (como en WhatsApp); lo del equipo, agentes o envíos sí.
    const showName = !cont && (isNote || (m.direction === 'in' && chat.kind === 'group') || (m.direction === 'out' && m.authorKind !== 'phone'));
    const author = isNote ? nameOf(m.authorId) : m.direction === 'in' ? inName(m) : outAuthor(m);
    const tr = translateOn && m.direction === 'in' ? translations[m.id] : undefined;
    const showTr = tr && tr.text && !showOriginal.has(m.id);
    const isEditing = editing?.id === m.id;
    // Lo que se mandó desde esta pestaña sigue con su copia local (sin volver a bajarse al guardarse).
    const media = withLocalMedia(m);
    const kind = media?.kind ?? '';
    const sticker = kind === 'sticker';
    const bigEmoji = !media && !m.poll && !quoted && !m.deletedAt && onlyEmoji(m.body);
    const location = m.location;
    const contacts = m.contacts ?? [];
    const caption = Boolean(m.body);
    const color = m.direction === 'in' && chat.kind === 'group' ? `wa-n${colorIndex(m.senderPhone || m.senderName)}` : '';
    const reactions = new Map<string, number>();
    for (const r of (album ?? [m]).flatMap((x) => x.reactions)) reactions.set(r.emoji, (reactions.get(r.emoji) ?? 0) + 1);
    const rxLite = (album ?? [m]).flatMap((x) => x.reactions.map((r) => ({ messageId: x.id, emoji: r.emoji, me: r.fromMe })));
    const time = parseDbUtc(m.createdAt).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
    const items = isEditing ? [] : menuItems(m);
    // Foto o video (aunque no esté disponible: su lugar ocupa el mismo ancho) al ras de la burbuja.
    const flush = (kind === 'image' || kind === 'video') && !media?.viewOnce && !(m.deletedAt && !revealed.has(m.id));
    const groupIn = m.direction === 'in' && chat.kind === 'group';
    const starred = (m.meta as Record<string, unknown>).starred === true;
    // Borrado: "Se eliminó este mensaje"; un admin puede ver el original.
    const hidden = Boolean(m.deletedAt) && !revealed.has(m.id);
    // En un álbum cada foto se elige sola (su casilla va en la foto).
    const selected = !album && ((selecting?.has(m.id) ?? false) || held?.id === m.id);
    const toggleSelected = selection.toggle;
    const pickable = canPickMsg(m, selection.forwardOnly);
    // Reaccionar desde el menú de una foto del álbum abre las reacciones de esa foto.
    const reactTo = album?.find((x) => x.id === pickerFor) ?? (pickerFor === m.id ? m : null);
    const fullFor = album?.find((x) => x.id === fullPickerFor) ?? (fullPickerFor === m.id ? m : null);
    return (
      <article
        key={m.id}
        className={`gr-msg gr-msg-${m.direction}${m.deletedAt ? ' is-deleted' : ''}${cont ? ' is-cont' : ' has-tail'}${bigEmoji || sticker ? ' is-bare' : ''}${reactions.size ? ' has-reactions' : ''}${groupIn ? ' has-avatar' : ''}${selected ? ' is-selected' : ''}${selecting && !pickable ? ' is-unpickable' : ''}`}
        id={`m-${m.id}`}
        data-testid="wa-message"
        data-status={m.direction === 'out' ? m.status : undefined}
        data-unsent={isTempId(m.id) ? 'true' : undefined}
        data-line={lineNames.size > 1 ? m.chatId : undefined}
        onContextMenu={(e) => {
          if (selecting || (e.target as HTMLElement).closest('a, input, textarea, video, audio')) return;
          e.preventDefault();
          openMenuIn(e.currentTarget, pointerOf(e));
        }}
        {...swipeAndHold({
          // Deslizar a la derecha responde (como WhatsApp); una nota o algo borrado, no.
          onSwipe:
            selecting || isNote || m.deletedAt || isEditing || isTempId(m.id)
              ? undefined
              : () => {
                  setReplyTo(m);
                  setMode('reply');
                  inputRef.current?.focus({ preventScroll: true });
                },
          onHold: (el) => (selecting ? !album && toggleSelected(m.id) : items.length > 0 && setHeld({ id: m.id, el })),
        })}
        onClick={
          selecting
            ? album
              ? undefined
              : () => toggleSelected(m.id)
            : chat.kind === 'group'
              ? (e) => {
                  // Una mención ("@Nombre") abre la ficha de esa persona, como en WhatsApp.
                  const el = (e.target as HTMLElement).closest<HTMLElement>('.wa-mention[data-mention]');
                  const d = el?.dataset.mention ?? '';
                  const phone = (m.mentionNames?.[d]?.phone || (memberNames.has(d) || memberPics.has(d) ? d : '')).replace(/\D/g, '');
                  if (!el || !/^\d{8,15}$/.test(phone)) return;
                  e.stopPropagation();
                  personSheet.open({ phone }, memberNames.get(phone) || (el.textContent ?? '').replace(/^@/, ''), memberPics.get(phone));
                }
              : undefined
        }
      >
        {selecting && !album && pickable && <SelectCheck id={m.id} checked={selecting.has(m.id)} label={t('wa.selectMessage')} preview={m.body} onToggle={toggleSelected} />}
        <span className="wa-swipe-reply" aria-hidden="true">
          <ArrowLeft size={18} />
        </span>
        {groupIn && (
          <span className="wa-sender-avatar">
            {!cont && (
              <button
                type="button"
                className="wa-person"
                tabIndex={-1}
                aria-label={tsheet('openFor', { name: inName(m) })}
                onClick={() => personSheet.open({ messageId: m.id }, inName(m), memberPics.get(m.senderPhone))}
                data-testid="wa-sender-avatar"
              >
                <Avatar name={inName(m)} kind="dm" size={26} src={memberPics.get(m.senderPhone) || undefined} seed={m.senderPhone || m.senderName} />
              </button>
            )}
          </span>
        )}
        <div className={`gr-bubble${flush ? ' is-media' : ''}`}>
          {showName && author && (
            <p className={`gr-msg-author ${color}`}>
              {isNote ? (
                <>
                  <Lock size={11} /> {t('thread.noteBy', { name: author })}
                </>
              ) : (
                <>
                  {m.direction === 'in' && chat.kind === 'group' && m.senderPhone ? (
                    <button
                      type="button"
                      className="wa-person wa-author-name"
                      onClick={() => personSheet.open({ messageId: m.id }, author, memberPics.get(m.senderPhone))}
                      data-testid="wa-sender-name"
                    >
                      {author}
                    </button>
                  ) : (
                    <span className="wa-author-name">{author}</span>
                  )}
                  {m.direction === 'in' && chat.kind === 'group' && (m.senderInternal || internalPhones.has(m.senderPhone)) && (
                    <span className="wa-internal-tag" data-testid="wa-internal-tag">
                      {t('wa.internal.tag')}
                    </span>
                  )}
                  {m.direction === 'in' && chat.kind === 'group' && m.senderName && m.senderPhone && <span className="wa-phone">{phoneLabel(m.senderPhone)}</span>}
                </>
              )}
            </p>
          )}
          {m.forwarded && (
            <p className="gr-forwarded" data-forwarded={forwardedMany(m.forwarded, m.meta) ? 'many' : 'once'}>
              <Forwarded size={13} /> {forwardedMany(m.forwarded, m.meta) ? t('thread.forwardedMany') : t('thread.forwarded')}
            </p>
          )}
          {privateQuote && (
            <button
              type="button"
              className={`gr-quote ${privateQuote.direction === 'in' ? `wa-q${colorIndex(privateQuote.senderPhone || privateQuote.senderName)}` : 'wa-q-me'}`}
              onClick={() => router.push(`/app/lines/inbox/${privateQuote.chatId}#m-${privateQuote.id}`)}
              data-testid="wa-private-quote"
            >
              <strong>
                {privateQuote.direction === 'in' ? privateQuote.senderName || phoneLabel(privateQuote.senderPhone) || chat.name : t('wa.you')}
                <span className="wa-quote-chat"> · {privateQuote.chatName}</span>
              </strong>
              <span>{privateQuote.deleted ? t('wa.deletedMessage') : privateQuote.body.slice(0, 160) || mediaText({ media: privateQuote.mediaType ? { type: privateQuote.mediaType, name: '' } : null })}</span>
            </button>
          )}
          {quoted && (
            <button
              type="button"
              className={`gr-quote ${quoted.direction === 'in' && chat.kind === 'group' ? `wa-q${colorIndex(quoted.senderPhone || quoted.senderName)}` : quoted.direction === 'in' ? 'wa-q-them' : 'wa-q-me'}`}
              onClick={() => jumpTo(quoted)}
            >
              <strong>{quoteAuthor(quoted)}</strong>
              <span>
                <RichText text={quoteLine(quoted)} inline />
              </span>
            </button>
          )}
          {hidden ? (
            <p className="wa-deleted">
              <Ban size={15} /> {m.direction === 'out' ? t('wa.youDeleted') : t('wa.deletedMessage')}
              {props.isAdmin && (m.body || media) && (
                <button
                  type="button"
                  className="gr-link-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    setRevealed((r) => new Set(r).add(m.id));
                  }}
                >
                  {t('wa.showDeleted')}
                </button>
              )}
              <span className="wa-spacer" aria-hidden="true" style={{ width: `${Math.ceil(time.length * 6.6 + 8)}px` }} />
            </p>
          ) : null}
          {media && !hidden && (
            <div className="gr-media">
              {album ? (
                <MediaAlbum
                  tiles={album.map((x) => ({
                    id: x.id,
                    kind: x.media?.kind === 'video' ? 'video' : 'image',
                    url: withLocalMedia(x)?.url ?? '',
                    alt: x.media?.name || t('thread.image'),
                    thumbnail: x.media?.thumbnail,
                    seconds: x.media?.duration,
                    menu: menuItems(x),
                    selected: (selecting?.has(x.id) ?? false) || held?.id === x.id,
                  }))}
                  onOpen={setViewerAt}
                  selecting={Boolean(selecting)}
                  onSelect={toggleSelected}
                  onHold={(id, el) => (selecting ? toggleSelected(id) : setHeld({ id, el }))}
                  menuLabel={t('thread.moreActions')}
                  align={m.direction === 'out' ? 'right' : 'left'}
                  onLoad={keepAtEnd}
                />
              ) : media.viewOnce ? (
                <span className="wa-viewonce">
                  <ViewOnce size={20} /> {t('wa.viewOnce')}
                </span>
              ) : sticker && !media.url ? (
                <StickerMissing label={t('wa.stickers.missing')} />
              ) : !media.url && (kind === 'image' || kind === 'video') ? (
                <MissingMedia
                  kind={kind}
                  width={media.width}
                  height={media.height}
                  thumbnail={media.thumbnail}
                  seconds={media.duration}
                  gone={(m.meta as Record<string, unknown>).mediaGone === true}
                  onRetry={isTempId(m.id) ? undefined : () => retryLinesMedia(m.id)}
                  retryKey={`lines:${m.id}`}
                />
              ) : !media.url && (kind === 'audio' || kind === 'voice') ? (
                // Sin archivo: el botón lo va a buscar (al gateway y, si hace falta, al teléfono) y, si vuelve, suena.
                <VoicePlayer id={m.id} src="" seconds={media.duration} voice={kind === 'voice' || media.ptt === true} name={kind === 'audio' ? media.name : undefined}
                  waveform={media.waveform}
                  gone={(m.meta as Record<string, unknown>).mediaGone === true}
                  onRetry={isTempId(m.id) ? undefined : () => retryLinesMedia(m.id)}
                  onRecovered={() => setRecoveredAudio((prev) => ({ ...prev, [m.id]: (prev[m.id] ?? 0) + 1 }))}
                  avatar={
                    m.direction === 'in'
                      ? chat.kind === 'dm'
                        ? { name: chat.name, src: chat.pictureUrl || undefined, seed: chat.id }
                        : { name: inName(m), seed: m.senderPhone || m.senderName }
                      : { name: author || '', src: outImage(m.authorId), seed: m.authorId || 'me' }
                  }
                />
              ) : !media.url ? (
                <DocCard
                  url=""
                  name={media.name || t(`media.${kind === 'voice' ? 'audio' : kind === 'document' ? 'file' : kind || 'file'}`)}
                  type={media.type}
                  size={media.size}
                  pages={media.pages}
                  thumbnail={media.thumbnail}
                  gone={(m.meta as Record<string, unknown>).mediaGone === true}
                  onRetry={isTempId(m.id) ? undefined : () => retryLinesMedia(m.id)}
                />
              ) : kind === 'image' || kind === 'sticker' ? (
                <ImageView
                  url={media.url}
                  alt={media.name || t('thread.image')}
                  sticker={sticker}
                  caption={!sticker && Boolean(m.body?.trim())}
                  thumbnail={media.thumbnail}
                  width={media.width}
                  height={media.height}
                  onLoad={keepAtEnd}
                  onOpen={() => setViewerAt(m.id)}
                />
              ) : kind === 'video' && media.animated ? (
                <GifView url={media.url} thumbnail={media.thumbnail} width={media.width} height={media.height} onOpen={() => setViewerAt(m.id)} />
              ) : kind === 'video' ? (
                <VideoView url={media.url} seconds={media.duration} thumbnail={media.thumbnail} width={media.width} height={media.height} onOpen={() => setViewerAt(m.id)} />
              ) : kind === 'audio' || kind === 'voice' ? (
                <VoicePlayer id={m.id} src={media.url} seconds={media.duration} voice={kind === 'voice' || media.ptt === true} name={kind === 'audio' ? media.name : undefined}
                  waveform={media.waveform}
                  onRecovered={() => setRecoveredAudio((prev) => ({ ...prev, [m.id]: (prev[m.id] ?? 0) + 1 }))}
                  avatar={
                    m.direction === 'in'
                      ? chat.kind === 'dm'
                        ? { name: chat.name, src: chat.pictureUrl || undefined, seed: chat.id }
                        : { name: inName(m), seed: m.senderPhone || m.senderName }
                      : { name: author || '', src: outImage(m.authorId), seed: m.authorId || 'me' }
                  }
                />
              ) : (
                <DocCard url={media.url} name={media.name} type={media.type} size={media.size} pages={media.pages} thumbnail={media.thumbnail} saveThumbTo={isTempId(m.id) ? undefined : `/api/groups/media/${m.id}`} />
              )}
              {(album ?? [m]).some((x) => isTempId(x.id) && x.status === 'pending') && (
                <UploadRing
                  ids={(album ?? [m]).filter((x) => isTempId(x.id) && x.status === 'pending').map((x) => x.id.slice(TEMP_PREFIX.length))}
                  label={t('wa.uploading', { name: media.name || t('thread.image') })}
                  overlay={Boolean(album) || kind === 'image' || kind === 'video' || kind === 'sticker'}
                />
              )}
            </div>
          )}
          {media && !hidden && (kind === 'audio' || kind === 'voice') && (media.url || recoveredAudio[m.id]) && !media.viewOnce && (
            <Transcript
              endpoint={`/api/groups/messages/${m.id}/transcript`}
              retryKey={recoveredAudio[m.id] ?? 0}
              labels={{ working: tw('transcribing'), failed: tw('transcribeFailed'), more: tw('showMore'), less: tw('showLess'), summary: tw('audioSummary'), title: tw('transcript') }}
            />
          )}
          {!media && !hidden && !m.poll && !m.meta?.noPreview && previewUrl(m.body) && (
            <LinkPreview url={previewUrl(m.body)} given={linkFromMeta(m.meta)} join={isTempId(m.id) ? undefined : inviteJoinFor(m, previewUrl(m.body))} />
          )}
          {location && !hidden && <LocationCard lat={location.lat} lng={location.lng} name={location.name ?? ''} address={location.address} url={location.url} live={location.live} />}
          {!hidden && contacts.length > 0 && (
            <ContactCards
              cards={contacts}
              onMessage={isTempId(m.id) ? undefined : (i) => void openCardChat(m, i)}
              // Guardar en el CRM solo con el número a la vista (con los teléfonos ocultos llega enmascarado).
              onSave={
                props.crm && contacts.every((c) => /^\d{6,15}$/.test(c.phones?.[0] ?? '')) ? (i) => void saveContact(contacts[i].name, contacts[i].phones?.[0] ?? '') : undefined
              }
            />
          )}
          {m.poll && !hidden ? (
            <PollResults poll={m.poll} />
          ) : (
            caption &&
            !hidden && (
              <p className={`gr-pre wa-text${bigEmoji ? ' is-emoji' : ''}${isEditing ? ' is-editing' : ''}`}>
                {showTr
                  ? waText(m, tr.text)
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
                    : <RichText text={m.body} mentions={mentionsFor(m)} />}
                {/* Lugar para la hora flotante (como en WhatsApp: el texto no se pisa con la hora). */}
                <span className="wa-spacer" aria-hidden="true" style={{ width: `${Math.ceil(time.length * 6.6 + (m.direction === 'out' ? 26 : 8) + (m.editedAt ? 52 : 0) + (m.pinnedAt ? 16 : 0) + ((m.meta as Record<string, unknown>).reported ? 16 : 0))}px` }} />
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
          {(m.ticketId || (m.direction === 'in' && m.needsReply === true) || (m.deletedAt && !hidden) || lineTags.has(m.id)) && (
            <p className="wa-tags">
              {lineTags.has(m.id) && (
                <span className="gr-line-tag" data-testid="msg-line">
                  {t(m.direction === 'out' ? 'thread.sentFromLine' : 'thread.receivedOnLine', { line: lineNames.get(m.chatId) ?? '' })}
                </span>
              )}
              {m.deletedAt && !hidden && <span className="gr-deleted-tag">{t('thread.deletedTag')}</span>}
              {m.ticketId && (
                <Link href={`/app/lines/tickets?open=${m.ticketId}`} className="gr-ticket-tag">
                  {t('thread.hasTicket')}
                </Link>
              )}
              {m.direction === 'in' && m.needsReply === true && <span className="gr-question-tag">{t('thread.question')}</span>}
              {/* Lugar para la hora (va abajo a la derecha, encima del último renglón): sin esto, "Enviado desde …" se pisaba con la hora. */}
              <span className="wa-spacer" aria-hidden="true" style={{ width: `${Math.ceil(time.length * 6.6 + (m.direction === 'out' ? 26 : 8) + (m.editedAt ? 52 : 0) + (m.pinnedAt ? 16 : 0) + ((m.meta as Record<string, unknown>).reported ? 16 : 0))}px` }} />
            </p>
          )}
          <p className="gr-msg-foot">
            {starred && <span className="wa-star" role="img" aria-label={t('wa.starred')}>★</span>}
            {m.pinnedAt && <PinIcon size={12} label={t('thread.pinned')} />}
            {!!(m.meta as Record<string, unknown>).reported && <FlagIcon size={12} label={t('wa.report.reported')} data-testid="msg-reported" />}
            {m.editedAt && !m.deletedAt && <span className="wa-edited">{t('thread.edited')}</span>}
            <time dateTime={m.createdAt} title={lineNames.size > 1 ? lineNames.get(m.chatId) : undefined}>
              <LocalText>{time}</LocalText>
            </time>
            {m.direction === 'out' && !m.deletedAt && <Ticks status={m.status} label={t(m.status === 'read' && chat.readHidden ? 'status.readHidden' : `status.${m.status}`)} />}
            {m.direction === 'out' && m.status === 'failed' && (props.isAdmin || m.authorId === props.me) && (
              <button type="button" className="wa-retry" onClick={() => void retrySend(m)} aria-label={t('wa.retry')} title={t('wa.retry')}>
                <Retry size={14} />
              </button>
            )}
          </p>
          {items.length > 0 && !selecting && (
            <span className="wa-hover">
              <MessageMenu label={t('thread.moreActions')} items={items} trigger={<Chevron size={18} />} className="wa-chevron" align={m.direction === 'out' ? 'right' : 'left'} />
            </span>
          )}
        </div>
        {/* Como WhatsApp: hasta tres emojis (los más usados) y el total; un clic abre quién reaccionó. */}
        {reactions.size > 0 && (
          <ReactionChip
            reactions={rxLite}
            expanded={rxFor?.id === m.id}
            onOpen={(el) => (selecting ? !album && toggleSelected(m.id) : setRxFor(rxFor?.id === m.id ? null : { id: m.id, anchor: el }))}
          />
        )}
        {rxFor?.id === m.id && (
          <ReactionDetails
            anchor={rxFor.anchor}
            reactions={rxLite}
            load={() => loadReactions((album ?? [m]).map((x) => x.id))}
            me={{ picture: outImage(null) }}
            canReact={!isNote && !m.deletedAt && !isEditing && !selecting}
            align={m.direction === 'out' ? 'right' : 'left'}
            onReact={() => {
              setRxFor(null);
              setPickerFor(m.id);
              // El foco pasa a la barra de emojis (así se ve aunque el mouse no esté encima; Esc la cierra).
              requestAnimationFrame(() => document.getElementById(`m-${m.id}`)?.querySelector<HTMLButtonElement>('.gr-emoji-picker button')?.focus());
            }}
            onRemove={async ({ messageId, emoji }) => {
              const target = (album ?? [m]).find((x) => x.id === messageId);
              if (target) await react(target, emoji);
            }}
            onClose={(restore) => {
              const anchor = rxFor.anchor;
              setRxFor(null);
              if (restore && anchor.isConnected) anchor.focus();
            }}
          />
        )}
        {!isNote && !m.deletedAt && !isEditing && !selecting && (
          <div className="gr-msg-actions">
            <button
              type="button"
              className="wa-react-btn"
              onClick={() => setPickerFor(pickerFor === m.id ? null : m.id)}
              aria-haspopup="true"
              aria-expanded={pickerFor === m.id}
              aria-label={t('thread.react')}
              title={t('thread.react')}
            >
              <Smiley size={18} />
            </button>
          </div>
        )}
        {/* La barra rápida va sobre el mensaje (no al costado, donde con el dedo quedaba fuera de la pantalla). */}
        {reactTo && (
          <span className="gr-emoji-picker" role="group" aria-label={t('thread.react')} ref={quickBar} data-testid="wa-quick-react">
            {[...new Set([...QUICK_EMOJIS, props.ticketEmoji].filter(Boolean))].map((e) => (
              <button key={e} type="button" onClick={() => void react(reactTo, e)} aria-label={e === props.ticketEmoji ? t('thread.reactTicket', { emoji: e }) : e}>
                {e}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setPickerFor(null);
                setFullPickerFor(reactTo.id);
              }}
              aria-label={t('wa.reactions.more')}
              title={t('wa.reactions.more')}
            >
              <Plus size={20} />
            </button>
          </span>
        )}
        {fullFor && (
          <FloatingReactPicker anchorId={`m-${m.id}`} align={m.direction === 'out' ? 'right' : 'left'}>
            <EmojiPicker onPick={(e) => void react(fullFor, e)} onClose={() => setFullPickerFor(null)} />
          </FloatingReactPicker>
        )}
      </article>
    );
  }

  const canSend = Boolean(text.trim() || (mode === 'reply' && tray.items.length > 0));
  const unseen = atBottom ? 0 : messages.filter((m) => m.direction === 'in' && m.createdAt > bottomAt).length;
  const viewerItems = messages
    .filter((m) => m.media?.url && /^(image|video)\//.test(m.media.type) && m.media.kind !== 'sticker')
    .map((m) => {
      const author = m.direction === 'in' ? (chat.kind === 'group' ? inName(m) : chat.name) : t('wa.you');
      // En un 1 a 1 lo recibido lleva la foto del chat; en un grupo, la de quien lo mandó (o sus iniciales).
      const avatar = m.direction === 'in' && chat.kind === 'dm' ? { src: chat.pictureUrl, seed: chat.id, kind: 'dm' as const } : { src: memberPics.get(m.senderPhone) ?? '', seed: m.senderPhone || author, kind: 'dm' as const };
      return { id: m.id, url: m.media!.url, type: m.media!.type, name: m.media!.name, caption: m.body, author, createdAt: m.createdAt, avatar };
    });
  const viewerIndex = viewerAt ? viewerItems.findIndex((v) => v.id === viewerAt) : -1;

  return (
    <>
      <section
        className={`gr-thread wa-thread${dragging ? ' is-dragging' : ''}`}
        aria-label={chat.name}
        onDragEnter={(e) => {
          if (!hasFiles(e.dataTransfer)) return;
          e.preventDefault();
          dragDepth.current++;
          setDragging(true);
        }}
        onDragOver={(e) => {
          if (!hasFiles(e.dataTransfer)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        }}
        onDrop={(e) => {
          if (!hasFiles(e.dataTransfer)) return;
          e.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          addFiles(filesFrom(e.dataTransfer));
        }}
      >
        {dragging && (
          <div className="wa-drop" aria-hidden="true">
            <span>
              <Plus size={34} />
              <strong>{t('wa.dropToAttach')}</strong>
            </span>
          </div>
        )}
        <header className="gr-thread-head wa-head">
          <Link href="/app/lines/inbox" className="wa-icon-btn gr-back" aria-label={t('thread.back')} title={t('thread.back')}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M15 5 8 12l7 7" />
            </svg>
          </Link>
          {/* El avatar abre la info del chat (como en WhatsApp); el nombre también, con el mouse. El título queda como encabezado. */}
          <div className="wa-head-who">
            <button type="button" className="wa-head-avatar" onClick={toggleDetails} aria-label={t('wa.openInfo', { name: chat.name })} aria-expanded={detailsShown}>
              <Avatar name={chat.name} kind={chat.kind} src={chat.pictureUrl} size={36} seed={chat.id} />
            </button>
            <div className="gr-thread-title" onClick={toggleDetails}>
              <h2>{chat.name}</h2>
              <span className={`wa-head-sub${presenceText && presence?.state !== 'available' ? ' is-typing' : ''}`} aria-live="polite" data-testid="wa-head-sub">
                {presenceText || subtitle}
              </span>
            </div>
          </div>
          <div className="gr-thread-actions">
            {/* Capa del equipo, compacta: a quién está asignado (avatar), el equipo y cerrar. */}
            <span className="wa-pick" title={assignee ? `${t('thread.assignee')}: ${assignee}` : t('thread.unassigned')} data-tour="lines-assign">
              {assignee ? <Avatar name={assignee} kind="dm" size={28} seed={chat.assignedTo ?? ''} /> : <UserPlus size={20} />}
              <select value={chat.assignedTo ?? ''} onChange={(e) => void patchChat({ assignedTo: e.target.value || null })} aria-label={t('thread.assignee')} data-testid="chat-assignee">
                <option value="">{t('thread.unassigned')}</option>
                {props.people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name || p.email}
                  </option>
                ))}
              </select>
            </span>
            {props.teams.length > 0 && (
              <span className={`wa-pick${chat.assignedTeamId ? ' is-on' : ''}`} title={teamName ? `${t('thread.team')}: ${teamName}` : t('thread.noTeam')}>
                <GroupIcon size={21} />
                <select value={chat.assignedTeamId ?? ''} onChange={(e) => void patchChat({ assignedTeamId: e.target.value || null })} aria-label={t('thread.team')}>
                  <option value="">{t('thread.noTeam')}</option>
                  {props.teams.map((tm) => (
                    <option key={tm.id} value={tm.id}>
                      {tm.name}
                    </option>
                  ))}
                </select>
              </span>
            )}
            <button
              type="button"
              className="wa-icon-btn wa-close-icon"
              onClick={() => void patchChat({ status: chat.status === 'open' ? 'closed' : 'open' })}
              aria-label={`${chat.status === 'open' ? t('thread.close') : t('thread.reopen')} (E)`}
              title={`${chat.status === 'open' ? t('thread.close') : t('thread.reopen')} (E)`}
            >
              {chat.status === 'open' ? <CheckCircle /> : <Retry />}
            </button>
            <button
              type="button"
              className={`wa-icon-btn wa-search-btn${searchOpen ? ' is-on' : ''}`}
              onClick={() => setSearchOpen((o) => !o)}
              aria-expanded={searchOpen}
              aria-label={t('wa.chatSearch.open')}
              title={`${t('wa.chatSearch.open')} (${t('wa.chatSearch.shortcut')})`}
              data-testid="chat-search-open"
            >
              <SearchIcon size={20} />
            </button>
            <MessageMenu
              label={t('thread.chatMenu')}
              className="wa-icon-btn"
              align="right"
              items={[
                // Como el ⋯ de WhatsApp: info, seleccionar, silenciar, fijar, leído; después lo del equipo (IA) y, en el teléfono, asignar y cerrar.
                { key: 'details', glyph: <InfoIcon size={18} />, label: chat.kind === 'group' ? t('wa.groupInfo') : t('wa.contactInfo'), onSelect: toggleDetails },
                // También en el menú: en el teléfono la lupa no entra en la cabecera.
                { key: 'search', glyph: <SearchIcon size={18} />, label: t('wa.chatSearch.open'), onSelect: () => setSearchOpen(true) },
                { key: 'select', glyph: <CheckCircle size={18} />, label: t('wa.selectMessages'), onSelect: () => setSelecting(new Set()) },
                { key: 'mute', glyph: chat.muted ? <Bell size={18} /> : <MuteIcon size={18} />, label: chat.muted ? t('wa.unmute') : t('wa.mute'), onSelect: () => void toggleMute() },
                { key: 'pin', glyph: <PinIcon size={18} />, label: chat.pinned ? t('thread.unpinChat') : t('thread.pinChat'), onSelect: () => void patchChat({ pinned: !chat.pinned }) },
                {
                  key: 'favorite',
                  glyph: <HeartIcon size={18} />,
                  label: chat.favorite ? t('favorites.remove') : t('favorites.add'),
                  onSelect: () => {
                    const on = !chat.favorite;
                    void patchChat({ favorite: on }).then((res) => res && showToast(on ? t('favorites.added') : t('favorites.removed')));
                  },
                },
                ...(chat.kind === 'dm' && chat.phone
                  ? [
                      {
                        key: 'vip',
                        glyph: <VipIcon size={18} />,
                        label: chat.vip ? t('vip.remove') : t('vip.add'),
                        onSelect: () => {
                          const on = !chat.vip;
                          void patchChat({ vip: on }).then((res) => res && showToast(on ? t('vip.added', { name: chat.name }) : t('vip.removed', { name: chat.name })));
                        },
                      },
                    ]
                  : []),
                { key: 'unread', glyph: chat.unread > 0 ? <ReadIcon size={18} /> : <UnreadIcon size={18} />, label: chat.unread > 0 ? t('thread.markRead') : t('thread.markUnread'), onSelect: () => void toggleUnread() },
                ...(chat.archived
                  ? [
                      {
                        key: 'keepArchived',
                        glyph: <ArchiveIcon size={18} />,
                        label: chat.keepArchived ? t('wa.keepArchivedOff') : t('wa.keepArchived'),
                        onSelect: () => {
                          const on = !chat.keepArchived;
                          void patchChat({ keepArchived: on }).then((res) => res && showToast(on ? t('wa.keepArchivedOn') : t('wa.keepArchivedOffToast')));
                        },
                      },
                    ]
                  : []),
                { key: 'summary', glyph: <Sparkle size={18} />, label: t('thread.summary'), divider: true, onSelect: () => void summarize() },
                { key: 'translate', glyph: <TranslateIcon size={18} />, label: translateOn ? t('thread.translateOff') : t('thread.translate'), onSelect: toggleTranslate },
                ...(props.caps.fetchHistory ? [{ key: 'fetchMissing', glyph: <Retry size={18} />, label: t('thread.fetchMissing'), onSelect: () => void refreshMissing.run() }] : []),
                ...(narrow
                  ? [
                      { key: 'assign', glyph: <UserPlus size={18} />, label: chat.assignedTo === props.me ? t('wa.unassignMe') : t('wa.assignMe'), divider: true, onSelect: () => void patchChat({ assignedTo: chat.assignedTo === props.me ? null : props.me }) },
                      { key: 'close', glyph: chat.status === 'open' ? <CheckCircle size={18} /> : <Retry size={18} />, label: chat.status === 'open' ? t('thread.close') : t('thread.reopen'), onSelect: () => void patchChat({ status: chat.status === 'open' ? 'closed' : 'open' }) },
                    ]
                  : []),
                // Visualización (texto, fotos, lista, fondo): vale para Lines e Inbox; abre Ajustes en esa sección.
                { key: 'display', glyph: <DisplayIcon size={18} />, label: tw('display.title'), divider: true, onSelect: () => router.push('/app/lines/settings?tab=appearance#chat-display') },
              ]}
            />
            <button type="button" className={`wa-icon-btn gr-details-toggle${detailsShown ? ' is-on' : ''}`} onClick={toggleDetails} aria-expanded={detailsShown} aria-label={t('thread.details')} title={t('thread.details')}>
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

        <RefreshMissingBar state={refreshMissing.state} count={refreshMissing.count} onRetry={() => void refreshMissing.run()} onDismiss={refreshMissing.dismiss} />
        <PinnedBar pinned={pinned} onJump={jumpTo} onUnpin={(m) => void togglePin(m)} textOf={waText} />

        <div className="wa-scroll">
          <div className={`gr-messages wa-messages${selecting ? ' is-selecting' : ''}`} role="log" aria-live="polite" ref={boxRef} onScroll={onScroll} onClick={tapClosesKeyboard} data-voice-off>
            {!hasOlder && messages.length > 0 && props.caps.fetchHistory && !props.sample && (
              <OlderHistoryChip state={olderHistory.state} offline={props.numberConnected === false} onLoad={() => void olderHistory.run()} />
            )}
            {hasOlder && (
              <p className="wa-older">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadOlder()} aria-busy={loadingOlder || undefined}>
                  {t('wa.loadOlder')}
                </button>
              </p>
            )}
            {chat.kind === 'group' && !hasOlder && !messages.some((m) => m.direction !== 'system') ? (
              <NewGroupCard
                name={chat.name}
                avatar={chat.pictureUrl || undefined}
                seed={chat.id}
                created={createdEvent}
                members={chat.memberCount || props.members.length}
                actions={
                  props.caps.groups
                    ? [
                        { key: 'add', label: tg('addMembers'), icon: <UserPlus size={18} />, onSelect: () => openDetailsAt('add-members') },
                        { key: 'invite', label: tg('invite'), icon: <LinkIcon size={18} />, onSelect: () => void copyInvite() },
                        { key: 'description', label: tg('description'), icon: <Note size={18} />, onSelect: () => openDetailsAt('description') },
                      ]
                    : []
                }
              />
            ) : (
              messages.length === 0 && (
                <p className="wa-empty-thread">
                  <Lock size={13} /> {t('thread.noMessages')}
                </p>
              )
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

        <ScheduledStrip chatId={chat.id} onToast={showToast} />
        {searchOpen && (
          <ChatSearchPanel chatKey={chat.id} chatName={chat.name} group={chat.kind === 'group'} search={searchChat} onPick={(h, covering) => void jumpToHit(h, covering)} onClose={() => setSearchOpen(false)} />
        )}

        <div
          className={`gr-composer wa-composer${editing ? '' : ' has-mode'}${mode === 'note' ? ' is-note' : ''}`}
          data-voice-off
          data-tour="lines-composer"
        >
          {/* A dónde va lo que se escribe: al chat de WhatsApp o a una nota que solo ve el equipo. Dos solapas;
              las flechas (y Inicio/Fin) pasan de una a otra, como en cualquier lista de pestañas. */}
          {!editing && (
            <div
              className="wa-mode"
              role="tablist"
              aria-label={t('thread.modeLabel')}
              data-tour="lines-note"
              onKeyDown={(e) => {
                const next = e.key === 'ArrowLeft' || e.key === 'Home' ? 'reply' : e.key === 'ArrowRight' || e.key === 'End' ? 'note' : null;
                if (!next) return;
                e.preventDefault();
                setMode(next);
                e.currentTarget.querySelector<HTMLButtonElement>(`.wa-mode-${next}`)?.focus();
              }}
            >
              {(['reply', 'note'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  className={`wa-mode-tab wa-mode-${m}`}
                  aria-selected={mode === m}
                  tabIndex={mode === m ? 0 : -1}
                  title={m === 'note' ? t('wa.writeNote') : t('wa.backToWhatsApp')}
                  onClick={() => {
                    setMode(m);
                    inputRef.current?.focus();
                  }}
                >
                  {m === 'note' && <Lock size={13} />}
                  {m === 'note' ? t('thread.modeNote') : t('thread.modeReply')}
                </button>
              ))}
            </div>
          )}
          {mode === 'reply' && !editing && (chat.lines?.length ?? 0) > 1 && (
            <ReplyFromSelect
              lines={chat.lines ?? []}
              value={replyLine}
              onChange={(id) => {
                setPickedFrom({ chat: chat.id, line: id });
                inputRef.current?.focus();
              }}
              label={t('thread.replyFrom')}
              unavailable={t('thread.lineUnavailable')}
            />
          )}
          {mode === 'note' && (
            <p className="wa-note-strip">
              {t('thread.noteHint')}
            </p>
          )}
          {aiAllowed && <AiComposeBar ai={ai} floating />}
          {editing && (
            <div className="wa-replying wa-editing">
              <span className="gr-quote wa-q-me">
                <strong>{t('wa.editMessage')}</strong>
                <span>{((x) => (x ? waText(x) : ''))(messages.find((x) => x.id === editing.id))}</span>
              </span>
              <button type="button" className="wa-icon-btn" onClick={() => setEditing(null)} aria-label={t('common.cancel')} title={t('common.cancel')}>
                <Close size={18} />
              </button>
            </div>
          )}
          {replyTo && (
            <div className="wa-replying">
              <span className={`gr-quote ${replyTo.direction === 'in' ? 'wa-q-them' : 'wa-q-me'}`}>
                <strong>
                  {t('thread.replyingTo')} {quoteAuthor(replyTo)}
                  {replyChat?.msgId === replyTo.id && <span className="wa-quote-chat"> · {replyChat.chatName}</span>}
                </strong>
                <span>{quoteLine(replyTo)}</span>
              </span>
              <button type="button" className="wa-icon-btn" onClick={() => setReplyTo(null)} aria-label={t('common.cancel')} title={t('common.cancel')}>
                <Close size={18} />
              </button>
            </div>
          )}
          {!selecting && linkPv.card}
          {slash.menu}
          {emojiSuggest.strip}
          {mentionMatches.length > 0 && !slash.open && (
            <ul className="wa-mention-pop" role="listbox" aria-label={t('thread.mentionPeople')} onMouseDown={(e) => e.preventDefault()}>
              {mentionMatches.map((p, i) => (
                <li key={p.id} role="option" aria-selected={i === mentionIndex}>
                  {waMentions && p.id === MENTION_ALL ? (
                    <button
                      type="button"
                      data-testid="mention-all"
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => i !== mentionIndex && setMentionIndex(i)}
                      onClick={() => pickMention(i)}
                    >
                      <Avatar name={chat.name} kind="group" size={32} src={chat.pictureUrl || undefined} seed={chat.id} />
                      <span className="wa-mention-who">
                        <span className="wa-mention-name">{t('thread.mentionAll', { word: p.name ?? MENTION_ALL })}</span>
                        <span className="wa-mention-phone">{t('thread.mentionAllHint', { count: memberCount })}</span>
                      </span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      title={waMentions ? `+${p.id}` : p.email}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => i !== mentionIndex && setMentionIndex(i)}
                      onClick={() => pickMention(i)}
                    >
                      <Avatar name={p.name || p.email} kind="dm" size={32} src={(waMentions && memberPics.get(p.id)) || undefined} seed={p.id} />
                      <span className="wa-mention-who">
                        <span className="wa-mention-name">{p.name || p.email}</span>
                        {waMentions && p.name !== p.id && <span className="wa-mention-phone">+{p.id}</span>}
                      </span>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {sendError && (
            <p className="ui-error" role="alert">
              {sendError}
            </p>
          )}
          {selecting ? (
            <SelectionBar
              count={selecting.size}
              label={t('wa.selectedN', { n: selecting.size })}
              cancelLabel={t('common.cancel')}
              onCancel={() => setSelecting(null)}
              actions={[
                { key: 'star', label: t('wa.star'), icon: <StarIcon size={22} />, onClick: () => void starSelected() },
                { key: 'copy', label: t('thread.copy'), icon: <CopyIcon size={22} />, onClick: () => void copySelected(), disabled: !selectedMsgs().some((m) => m.body.trim()) },
                {
                  key: 'forward',
                  label: t('thread.forward'),
                  icon: <Forwarded size={22} />,
                  onClick: () => setForwarding(selectedMsgs().filter(canForward)),
                  disabled: !selectedMsgs().some(canForward),
                },
                { key: 'delete', label: t('thread.deleteForAll'), icon: <Trash size={22} />, onClick: () => setDeletingSel(true), danger: true, disabled: !selectedMsgs().length || !selectedMsgs().every(canDelete) },
              ]}
            />
          ) : chat.leftAt && mode === 'reply' && !editing ? (
            // La línea ya no está en el grupo: el aviso de WhatsApp en lugar del campo; la nota interna sigue.
            <LeftGroupBar />
          ) : recording ? (
            <div className="wa-bar wa-recording" role="group" aria-label={t('wa.recording')} aria-busy={voiceBusy || undefined}>
              <button type="button" className="wa-icon-btn" onClick={() => stopRecording(true)} disabled={voiceBusy} aria-label={t('wa.discardVoice')} title={t('wa.discardVoice')}>
                <Trash />
              </button>
              <span className={`wa-rec-dot${recording.paused ? ' is-paused' : ''}`} aria-hidden="true" />
              <span className="wa-rec-time" aria-live="off">
                {Math.floor(recording.elapsed / 60)}:{String(recording.elapsed % 60).padStart(2, '0')}
              </span>
              <span className="sr-only">{recording.paused ? t('wa.paused') : t('wa.recording')}</span>
              <LiveWaveform stream={recorder.current?.stream} paused={recording.paused} />
              <button type="button" className="wa-icon-btn" onClick={togglePause} disabled={voiceBusy} aria-label={recording.paused ? t('wa.resume') : t('wa.pause')} title={recording.paused ? t('wa.resume') : t('wa.pause')}>
                {recording.paused ? <Mic size={22} /> : <Pause size={22} />}
              </button>
              {mode === 'reply' && (
                <button type="button" className="wa-icon-btn wa-later-btn" data-testid="lines-voice-later" onClick={openVoiceLater} disabled={voiceBusy} aria-busy={voiceBusy || undefined} aria-label={t('later.voiceButton')} title={t('later.voiceButton')}>
                  <ClockIcon size={20} />
                </button>
              )}
              <button type="button" className="wa-send" onClick={() => stopRecording(false)} disabled={voiceBusy} aria-label={t('wa.sendVoice')} title={t('wa.sendVoice')}>
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
                  aria-haspopup="dialog"
                  aria-expanded={emojiOpen}
                  aria-label={t('wa.emoji')}
                  title={t('wa.emoji')}
                >
                  <Smiley size={24} />
                </button>
                {emojiOpen && (
                  <EmojiPicker
                    stickers={mode === 'reply' ? { api: '/api/groups/stickers', line: stickerLine, onSend: (s) => sendSticker(s.id) } : undefined}
                    gifs={mode === 'reply' ? { api: '/api/groups/gifs', onSend: sendGif } : undefined}
                    onPick={(e) => {
                      insertEmoji(e);
                    }}
                    onClose={(reason) => {
                      setEmojiOpen(false);
                      // Un toque afuera deja el foco donde se tocó.
                      if (reason !== 'outside') inputRef.current?.focus();
                    }}
                  />
                )}
              </span>
              {mode === 'reply' && (
                <AttachMenu
                  ref={attachRef}
                  onFiles={addFiles}
                  onContact={props.caps.contacts ? () => setContactOpen(true) : undefined}
                  onPoll={props.caps.polls ? () => setPollOpen(true) : undefined}
                  onNewSticker={(f) => void newSticker(f)}
                  extra={[
                    ...(aiAllowed ? [{ key: 'ai', glyph: <PencilSparkle size={18} />, label: tc('open'), onSelect: ai.openBar }] : []),
                    { key: 'dictate', glyph: <Mic size={18} />, label: t('wa.dictate'), onSelect: dictate },
                    { key: 'schedule', glyph: <ClockIcon size={18} />, label: t('later.title'), onSelect: () => openLater() },
                    { key: 'commands', glyph: <SlashIcon size={18} />, label: ts('menuItem'), onSelect: slash.openFromButton },
                  ]}
                />
              )}
              <MentionTextarea
                ref={inputRef}
                className="textarea gr-input wa-input"
                data-testid="composer-input"
                adornment={aiAllowed ? <AiComposeChip ai={ai} /> : null}
                rows={1}
                highlights={editing ? [] : mentionHits}
                value={editing ? editing.text : text}
                disabled={leaving}
                onChange={(e) => {
                  if (editing) {
                    setEditing({ ...editing, text: e.target.value });
                    return;
                  }
                  setText(e.target.value);
                  setCaret(e.target.selectionStart ?? e.target.value.length);
                  setMentionIndex(0);
                  if (mentionClosedAt !== null && !e.target.value.slice(mentionClosedAt).startsWith('@')) setMentionClosedAt(null);
                }}
                onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
                // Tocar afuera cierra la lista del "@" (elegir una opción no saca el foco: onMouseDown la frena).
                onFocus={() => setComposerFocused(true)}
                onBlur={() => setComposerFocused(false)}
                onKeyDown={onComposerKey}
                placeholder={mode === 'note' ? t('thread.notePlaceholder') : tray.items.length ? t('wa.addCaption') : slash.placeholder(t('wa.typeMessage'))}
                {...slash.inputProps}
                aria-label={editing ? t('thread.editLabel') : mode === 'note' ? t('thread.modeNote') : t('thread.modeReply')}
                onPaste={(e) => {
                  const files = filesFrom(e.clipboardData);
                  if (files.length && mode === 'reply') {
                    e.preventDefault();
                    addFiles(files);
                  }
                }}
              />
              {aiAllowed && <AiComposeButton ai={ai} className="wa-icon-btn wa-ai-btn" />}
              {mode === 'reply' && !editing && canSend && (
                <button type="button" className="wa-icon-btn wa-later-btn" data-testid="lines-send-later" onClick={() => openLater()} aria-label={t('later.button')} title={t('later.hint')}>
                  <ClockIcon size={20} />
                </button>
              )}
              {editing ? (
                <button
                  type="button"
                  className="wa-send"
                  {...keepFocus}
                  onClick={() => void saveEdit()}
                  disabled={editing.busy || !editing.text.trim()}
                  aria-busy={editing.busy || undefined}
                  aria-label={t('wa.saveEdit')}
                  title={t('wa.saveEdit')}
                >
                  <CheckIcon size={22} />
                </button>
              ) : canSend || mode === 'note' || !voiceSupported ? (
                <button
                  type="button"
                  className={`wa-send${mode === 'note' ? ' is-note' : ''}`}
                  data-testid="composer-send"
                  {...keepFocus}
                  onClick={() => void send()}
                  onContextMenu={(e) => {
                    // Clic derecho en Enviar: programar el envío (como en Inbox).
                    if (mode !== 'reply' || !canSend) return;
                    e.preventDefault();
                    openLater();
                  }}
                  disabled={sending || !canSend}
                  aria-busy={sending || tray.items.some((f) => f.status === 'uploading') || undefined}
                  aria-label={mode === 'note' ? t('thread.saveNote') : t('thread.send')}
                  title={mode === 'note' ? t('thread.saveNote') : t('thread.send')}
                >
                  <SendIcon />
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
        {previewOpen && (
          <AttachPreview
            items={tray.items}
            errText={errText}
            onCaption={tray.setCaption}
            onRemove={tray.remove}
            onRetry={tray.retry}
            onAdd={() => attachRef.current?.pickFiles()}
            onSend={() => void send()}
            onClose={tray.clear}
            onFiles={addFiles}
            onReplace={tray.replace}
            stickerApi="/api/groups/stickers"
            stickerLine={stickerLine}
            sending={sending}
            mentionables={captionMentionables}
            mentionAll={allWord ? { word: allWord, count: memberCount, name: chat.name, picture: chat.pictureUrl || undefined, seed: chat.id } : null}
            onLater={!editing ? () => openLater(true) : undefined}
          />
        )}
      </section>

      <aside className={`gr-details${detailsOpen ? ' is-open' : ''}`} aria-label={t('thread.details')}>
        <div className="wa-details-head">
          <Avatar name={chat.name} kind={chat.kind} src={chat.pictureUrl} size={84} seed={chat.id} />
          <strong>{chat.name}</strong>
          {chat.kind === 'group' ? (
            <span>{t('thread.groupMeta', { n: chat.memberCount })}</span>
          ) : visiblePhone(chat.phone) ? (
            // El teléfono con formato (un toque lo copia). Oculto para quien no ve los números (llega enmascarado).
            <PhoneCopy phone={chat.phone} copyLabel={t('wa.copyPhone')} onCopied={() => showToast(t('wa.phoneCopied'))} />
          ) : (
            <span>{t('wa.whatsappContact')}</span>
          )}
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
          starredKey={starredKey}
          notesKey={notesKey}
          aiUnread={unreadMark?.n ?? 0}
          aiUnreadFrom={unreadMark?.id}
          onJumpToMessage={(id) => {
            const m = messages.find((x) => x.id === id);
            if (!m) {
              showToast(t('thread.pinnedOld'));
              return;
            }
            // En el teléfono la info tapa el chat: se cierra para ver el mensaje.
            if (!side.wide) setDetailsOpen(false);
            window.setTimeout(() => jumpTo(m), 0);
          }}
        />
      </aside>

      {personSheet.sheet}

      {/* El panel de HubSpot fijado al costado sigue al chat abierto. */}
      {!props.sample && <HubspotDock source={{ app: 'lines', chatId: chat.id }} isAdmin={props.isAdmin} />}

      <TaskModal
        open={!!taskFor}
        chatId={chat.id}
        message={taskMessage}
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
          {ticketFor?.body && <p className="gr-quote gr-quote-plain">{waText(ticketFor).slice(0, 280)}</p>}
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

      <WhenDialog
        open={later}
        title={t('later.title')}
        mode="send"
        labels={whenLabels}
        help={later ? laterPreview() : undefined}
        extra={
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              // Repetir (todos los lunes, cada mes...) sigue en su formulario.
              setLater(false);
              setRepeat(true);
              setSchedule({ open: true, at: '', busy: false, error: '' });
            }}
          >
            {t('later.repeat')}
          </button>
        }
        onPick={(iso) => void scheduleLater(iso)}
        onClose={() => setLater(false)}
      />
      {/* "Enviar más tarde" de la nota de voz que se está grabando: al cerrarlo (Esc o clic afuera) la grabación sigue, en pausa. */}
      <WhenDialog
        open={voiceLater}
        title={t('later.title')}
        mode="send"
        labels={whenLabels}
        help={
          voiceLater && recording ? (
            <>
              <span className="gr-later-preview">{t('later.voiceTag', { time: `${Math.floor(recording.elapsed / 60)}:${String(recording.elapsed % 60).padStart(2, '0')}` })}</span>
              {replyTo && <span className="gr-later-note">{t('later.asReply', { text: quoteLine(replyTo).slice(0, 80) })}</span>}
            </>
          ) : undefined
        }
        onPick={(iso) => void scheduleVoice(iso)}
        onClose={() => setVoiceLater(false)}
      />

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

      <ReportDialog
        open={!!reporting}
        name={chat.name}
        extra={chat.kind === 'dm' ? (chat.canBlock && !chat.blocked ? 'block' : null) : !chat.leftAt && props.caps.groups && !props.sample ? 'leave' : null}
        busy={reportBusy}
        onConfirm={(opts) => void confirmReport(opts)}
        onCancel={() => setReporting(null)}
      />

      <ConfirmDialog
        open={deletingSel && !!selecting}
        title={t('wa.deleteSelectedTitle', { n: selecting?.size ?? 0 })}
        body={t('wa.deleteSelectedForAll')}
        confirmLabel={t('thread.deleteForAll')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={() => void deleteSelected()}
        onCancel={() => setDeletingSel(false)}
      />
      {held &&
        (() => {
          const m = messages.find((x) => x.id === held.id);
          if (!m) return null;
          const live = m.direction !== 'note' && !m.deletedAt && !isTempId(m.id);
          return (
            <TouchMessageMenu
              anchor={held.el}
              label={t('thread.moreActions')}
              items={menuItems(m)}
              reactions={
                live
                  ? {
                      quick: [...new Set([...QUICK_EMOJIS, props.ticketEmoji].filter(Boolean))],
                      mine: m.reactions.filter((r) => r.fromMe).map((r) => r.emoji),
                      onPick: (e) => void react(m, e),
                      label: t('thread.react'),
                    }
                  : null
              }
              onClose={() => setHeld(null)}
              onOutside={(target) => {
                // Tocar otro mensaje lo suma a la selección, como WhatsApp (una foto de un álbum es su propio mensaje).
                setHeld(null);
                const other = target.closest<HTMLElement>('[data-msg-id], .gr-msg');
                const otherId = other?.dataset.msgId ?? other?.id.replace(/^m-/, '');
                if (!other || !otherId || otherId === held.id || !boxRef.current?.contains(other) || isTempId(held.id) || isTempId(otherId)) return false;
                setSelecting(new Set([held.id, otherId]));
                return true;
              }}
            />
          );
        })()}

      <ForwardModal
        message={forwarding}
        textOf={waText}
        fromChatId={chat.id}
        onClose={() => setForwarding(null)}
        onDone={(results) => {
          setForwarding(null);
          setSelecting(null);
          const ok = results.filter((r) => r.ok).length;
          const bad = results.filter((r) => !r.ok);
          showToast(bad.length ? t('forward.partial', { ok, total: results.length, error: errText(bad[0].error) }) : t('forward.done', { n: ok }), bad.length > 0);
          refresh();
        }}
      />

      <PollDialog open={pollOpen} supported={props.caps.polls} onClose={() => setPollOpen(false)} onSend={sendPoll} />
      {infoFor && (
        <MessageInfo
          anchor={infoFor.anchor}
          load={() => loadInfo(infoFor.m.id)}
          preview={quoteLine(infoFor.m)}
          previewTime={parseDbUtc(infoFor.m.createdAt).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })}
          status={infoFor.m.deletedAt ? '' : infoFor.m.status}
          statusLabel={t(infoFor.m.status === 'read' && chat.readHidden ? 'status.readHidden' : `status.${infoFor.m.status}`)}
          by={outAuthor(infoFor.m) || t('thread.byPhone')}
          onClose={() => setInfoFor(null)}
        />
      )}
      <ContactPicker
        open={contactOpen}
        chatId={via || chat.id}
        onClose={() => setContactOpen(false)}
        onSent={(m) => {
          merge([m]);
          setContactOpen(false);
          if (m.status === 'failed') showToast(errText(m.error || 'send_failed'), true);
          refresh();
        }}
      />
      {viewerIndex >= 0 && <MediaViewer items={viewerItems} index={viewerIndex} onIndex={(i) => setViewerAt(viewerItems[i]?.id ?? null)} onClose={() => setViewerAt(null)} />}
      {toast}
    </>
  );
}

