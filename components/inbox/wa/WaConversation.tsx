'use client';

import { forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { FolderDto, MessageDto, ScheduledDto, SnippetDto, ThreadDto, WaDetailsDto } from '@/lib/inbox/types';
import { useScrollAnchor } from '@/components/ui/useScrollAnchor';
import { atBottom as isAtBottom } from '@/lib/scroll-anchor';
import Avatar from '@/components/groups/wa/Avatar';
import RichText from '@/components/groups/wa/RichText';
import MediaViewer, { type ViewerItem } from '@/components/groups/wa/MediaViewer';
import EmojiPicker from '@/components/groups/wa/EmojiPicker';
import { ContactCard, DocCard, ImageView, LocationCard, VideoView, VoicePlayer } from '@/components/groups/wa/MediaParts';
import { MessageMenu, type MenuItem } from '@/components/groups/wa/Menu';
import { colorIndex, dayLabel, firstUrl, localDayKey, onlyEmoji } from '@/components/groups/wa/format';
import { ArrowDown, ArrowLeft, Ban, Bell, CheckCircle, Chevron, ClockIcon, FolderIcon, Forwarded, Note, PinIcon, PollIcon, Plus, Smiley, Ticks } from '@/components/groups/wa/icons';
import { api, longWhen } from '../api';
import { Modal } from '../InboxDialogs';
import type { ComposerHandle } from '../Composer';
import WaComposer, { ComposerBanner } from './WaComposer';
import { chatName, formatPhone, groupReactions, senderLabel } from './util';
import { mentionLabels, replaceMentions } from '@/lib/wa-mentions';
import type { MentionLabels } from '@/components/groups/wa/RichText';
import { swipeAndHold } from './gestures';
import { useChatStyle } from '@/components/chat-style/ChatStyle';
import LinkPreview from '@/components/groups/wa/LinkPreview';
import Transcript from '@/components/groups/wa/Transcript';
import { AttachButton, useSendTray, VoiceBar } from './media-send';
import { pendingSends } from './pending';
import { isTempId } from '@/lib/optimistic-send';
import AttachPreview from '@/components/groups/wa/AttachPreview';
import { filesFrom, hasFiles } from '@/components/groups/wa/attachments';
import ScheduledList from '../ScheduledList';
import { useInboxThreadCommands } from '../slash-commands';
import { typingLabel } from './ChatRow';

export interface WaThreadDetail {
  thread: ThreadDto;
  messages: MessageDto[];
  more: boolean;
  scheduled: ScheduledDto[];
  wa?: WaDetailsDto | null;
  /** Se cargaron mensajes anteriores a la primera página. */
  extended?: boolean;
  /** Mensaje al que ir (resultado de búsqueda). */
  focus?: string;
}

const QUICK = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

function senderKey(m: MessageDto): string {
  return m.fromMe ? 'me' : m.senderHandle || m.senderName || 'them';
}

/** "últ. vez hoy a las 14:05" / "ayer" / la fecha. */
function lastSeen(iso: string, locale: string, w: ReturnType<typeof useTranslations>): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  const today = new Date();
  const y = new Date(today.getTime() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return w('lastSeenToday', { time });
  if (d.toDateString() === y.toDateString()) return w('lastSeenYesterday', { time });
  return w('lastSeenOn', { date: d.toLocaleDateString(locale, { day: 'numeric', month: 'short' }), time });
}

/**
 * Conversación de WhatsApp como en WhatsApp Web: cabecera con foto, nombre y
 * estado (escribiendo, en línea, últ. vez, participantes), fondo del chat,
 * burbujas con cola en el primero de cada tanda, nombres de color en grupos,
 * separadores de día, citas, reacciones, reenviado, editado, borrado, media
 * con visor, tildes. Menú por mensaje (flecha al pasar, clic derecho o toque
 * largo) y deslizar a la derecha para responder en el teléfono.
 */
const WaConversation = forwardRef<
  ComposerHandle,
  {
    detail: WaThreadDetail;
    folders: FolderDto[];
    snippets: SnippetDto[];
    connected: boolean;
    /** Se está abriendo otro chat (esta conversación es la anterior hasta que llegue). */
    paused?: boolean;
    threads: ThreadDto[];
    infoOpen: boolean;
    onBack: () => void;
    onAction: (action: string) => void;
    onSent: (messages: MessageDto[]) => void;
    onSendLater: (text: string) => void;
    onScheduledChange: () => void;
    onError: (code: string) => void;
    onToast: (text: string) => void;
    onToggleInfo: () => void;
    onRename: (title: string) => void;
    onRefresh: () => void;
    loadOlder: () => Promise<void>;
  }
>(function WaConversation(props, composerRef) {
  const { detail, connected, onAction, onError, onRefresh } = props;
  const t = useTranslations('inbox');
  const w = useTranslations('inboxWa');
  const { style: chatStyle, setStyle: setChatStyle } = useChatStyle();
  const locale = useLocale();
  const { thread, messages, scheduled } = detail;
  const wa = detail.wa ?? null;
  const group = thread.kind === 'group';
  const name = chatName(thread, w('group'));
  const scroller = useRef<HTMLDivElement>(null);
  const openedFor = useRef('');
  const [replyTo, setReplyTo] = useState<MessageDto | null>(null);
  const [editing, setEditing] = useState<MessageDto | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [fullPickerFor, setFullPickerFor] = useState<string | null>(null);
  const [viewerAt, setViewerAt] = useState<string | null>(null);
  const [infoFor, setInfoFor] = useState<MessageDto | null>(null);
  const [forwardFor, setForwardFor] = useState<MessageDto | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [atBottom, setAtBottom] = useState(true);
  const [flash, setFlash] = useState<string | null>(null);
  const [hitId, setHitId] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [notesState, setNotesState] = useState<'' | 'saving' | 'saved'>('');
  const [recording, setRecording] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  // Lo que mando desde acá: la conversación va abajo de todo (aunque estuviera leyendo más arriba).
  const sentHere = (msgs: MessageDto[]) => {
    anchor.toBottom();
    props.onSent(msgs);
  };
  const tray = useSendTray(thread.id, sentHere);
  // El texto que se acaba de mandar aparece ya (burbuja provisoria, ./pending.ts): la conversación va abajo de todo.
  useEffect(() => pendingSends.subscribe((e) => void (e.type === 'add' && e.threadId === thread.id && anchor.toBottom())), [thread.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Presencia: al abrir se suscribe a la del otro; escribiendo y grabando salen cada 4 s como mucho.
  const lastPresence = useRef(0);
  const presence = useCallback(
    (state: 'composing' | 'recording' | 'paused') => {
      if (!connected) return;
      if (state !== 'paused') {
        const now = Date.now();
        if (now - lastPresence.current < 4000) return;
        lastPresence.current = now;
      }
      void api(`/api/inbox/threads/${thread.id}/wa`, { method: 'POST', json: { action: 'presence', state } });
    },
    [connected, thread.id],
  );
  useEffect(() => {
    lastPresence.current = 0;
    presence('paused');
  }, [thread.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setReplyTo(null);
    setEditing(null);
    setPickerFor(null);
    setFullPickerFor(null);
    setRevealed(new Set());
    setNotesOpen(false);
  }, [thread.id]);

  // Nombres de los participantes (para remitentes, menciones y "escribiendo").
  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of wa?.participants ?? []) if (p.name) m.set(p.phone, p.name);
    for (const msg of messages) if (!msg.fromMe && msg.senderHandle && msg.senderName && !m.has(msg.senderHandle)) m.set(msg.senderHandle, msg.senderName);
    if (wa?.myPhone) m.set(wa.myPhone, w('you'));
    return m;
  }, [wa, messages, w]);

  // Menciones ("@<dígitos>" → "@Nombre"): los participantes y, por mensaje, lo que resolvió el servidor (también lids).
  const baseMentions = useMemo<MentionLabels>(() => Object.fromEntries(names), [names]);
  // Solo el teléfono: "@+teléfono"; nada (un lid sin resolver): "@alguien", nunca los dígitos.
  const someone = w('mentionSomeone');
  const mentionsFor = (m: { body: string; mentionNames?: MessageDto['mentionNames'] }): MentionLabels | undefined => {
    if (!m.body || !m.body.includes('@')) return undefined;
    return mentionLabels(baseMentions, m.mentionNames, formatPhone, someone);
  };
  /** Texto plano con las menciones nombradas (copiar, editar, info). */
  const mentionText = (m: { body: string; mentionNames?: MessageDto['mentionNames'] }) => replaceMentions(m.body, mentionsFor(m));

  // Leyendo más arriba, la conversación no se mueve sola (fotos que cargan, reacciones o
  // "editado" que llegan con la consulta, anteriores que se suman arriba); abajo de todo, sigue al final.
  const anchor = useScrollAnchor(scroller, [messages]);
  // Al abrir el chat: abajo de todo, una sola vez. Las cargas que siguen (la página completa, la
  // consulta periódica) no fuerzan nada: si se estaba leyendo más arriba, ahí se queda.
  useLayoutEffect(() => {
    const last = messages[messages.length - 1];
    if (!scroller.current || !last) return;
    // Por chat (no por mensaje): cambiar de chat abre el nuevo abajo de todo en el mismo render.
    if (openedFor.current !== thread.id) anchor.toBottom();
    openedFor.current = thread.id;
  }, [messages, thread.id]); // eslint-disable-line react-hooks/exhaustive-deps


  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    anchor.capture();
    setAtBottom(isAtBottom(el));
  };

  // Una foto que terminó de cargar: la conversación queda donde estaba (o abajo de todo, si estaba ahí).
  const keepAtEnd = () => anchor.restore();

  const jumpTo = (id: string) => {
    const el = document.getElementById(`m-${id}`);
    if (!el) return;
    anchor.unstick();
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setFlash(id);
    window.setTimeout(() => setFlash((f) => (f === id ? null : f)), 1500);
  };

  // Ir al mensaje buscado (después de que se pintó la conversación).
  useEffect(() => {
    if (!detail.focus) return;
    const focus = detail.focus;
    let off = 0;
    const id = window.setTimeout(() => {
      jumpTo(focus);
      // Marcado un rato más largo que el de una cita (para encontrarlo al llegar).
      setHitId(focus);
      off = window.setTimeout(() => setHitId((h) => (h === focus ? null : h)), 3000);
    }, 60);
    return () => {
      window.clearTimeout(id);
      window.clearTimeout(off);
    };
  }, [detail.focus, detail.thread.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = useCallback(
    async (m: MessageDto, body: Record<string, unknown>, method: 'PATCH' | 'DELETE' = 'PATCH'): Promise<boolean> => {
      const r = await api(`/api/inbox/messages/${m.id}`, { method, ...(method === 'PATCH' ? { json: body } : {}) });
      if (!r.ok) {
        onError(r.data.error ?? 'generic');
        return false;
      }
      onRefresh();
      return true;
    },
    [onError, onRefresh],
  );

  const react = async (m: MessageDto, emoji: string) => {
    setPickerFor(null);
    setFullPickerFor(null);
    const mine = (m.reactions ?? []).find((r) => r.by === 'me');
    await act(m, { action: 'react', emoji: mine?.emoji === emoji ? '' : emoji });
  };

  const copy = async (m: MessageDto) => {
    try {
      await navigator.clipboard.writeText(mentionText(m));
      props.onToast(w('copied'));
    } catch {
      onError('generic');
    }
  };

  const startReply = (m: MessageDto) => {
    setEditing(null);
    setReplyTo(m);
  };
  const startEdit = (m: MessageDto) => {
    setReplyTo(null);
    setEditing(m);
  };
  const openFullPicker = (id: string) => {
    setPickerFor(null);
    setFullPickerFor(id);
  };

  const canEdit = (m: MessageDto) => m.fromMe && !m.revoked && !m.mediaType && Date.now() - Date.parse(m.sentAt) < 15 * 60_000;
  const canDeleteAll = (m: MessageDto) => m.fromMe && !m.revoked && Date.now() - Date.parse(m.sentAt) < 60 * 3600_000;

  const menuFor = (m: MessageDto): MenuItem[] => {
    // Una burbuja que todavía se está mandando no existe en el servidor: solo se puede copiar.
    if (isTempId(m.id)) return [{ key: 'copy', label: w('copy'), onSelect: () => void copy(m) }];
    const items: MenuItem[] = [];
    if (!m.revoked) {
      items.push({ key: 'reply', label: w('reply'), onSelect: () => startReply(m) });
      items.push({ key: 'react', label: w('react'), onSelect: () => setFullPickerFor(m.id) });
      if (m.body && !m.mediaType) items.push({ key: 'forward', label: w('forward'), onSelect: () => setForwardFor(m) });
      if (m.body) items.push({ key: 'copy', label: w('copy'), onSelect: () => void copy(m) });
      items.push({ key: 'star', label: m.starred ? w('unstar') : w('star'), onSelect: () => void act(m, { action: m.starred ? 'unstar' : 'star' }) });
      if (canEdit(m)) items.push({ key: 'edit', label: w('edit'), onSelect: () => startEdit(m) });
      if (m.fromMe) items.push({ key: 'info', label: w('info'), onSelect: () => setInfoFor(m) });
    }
    items.push({ key: 'hide', label: w('deleteForMe'), divider: true, danger: true, onSelect: () => void act(m, { action: 'hide' }) });
    if (canDeleteAll(m)) items.push({ key: 'deleteAll', label: w('deleteForEveryone'), danger: true, onSelect: () => void act(m, {}, 'DELETE') });
    return items;
  };

  const quoteAuthor = (q: { fromMe: boolean; senderName: string; senderHandle: string }) => (q.fromMe ? w('you') : group ? names.get(q.senderHandle) || senderLabel(q.senderName, q.senderHandle) : name);
  const quoteText = (q: { body: string; mediaType: string }) => q.body || (q.mediaType ? w(`kind.${['image', 'video', 'audio', 'document', 'sticker'].includes(q.mediaType) ? q.mediaType : 'document'}`) : '');

  // Media para el visor (fotos y videos del chat, en orden).
  const viewerItems: ViewerItem[] = useMemo(
    () =>
      messages
        .filter((m) => m.hasMedia && (m.mediaType === 'image' || m.mediaType === 'video') && !m.revoked)
        .map((m) => ({
          id: m.id,
          url: `/api/inbox/media/${m.id}`,
          type: m.mediaType === 'video' ? 'video/mp4' : 'image/jpeg',
          name: m.mediaName,
          caption: m.body,
          author: m.fromMe ? w('you') : group ? names.get(m.senderHandle) || senderLabel(m.senderName, m.senderHandle) : name,
          createdAt: m.sentAt,
          avatar: m.fromMe ? undefined : group ? { src: '', seed: m.senderHandle || m.senderName, kind: 'dm' as const } : { src: thread.avatar, seed: thread.id, kind: 'dm' as const },
        })),
    [messages, names, group, name, thread.avatar, thread.id, w],
  );
  const viewerIndex = viewerAt ? viewerItems.findIndex((v) => v.id === viewerAt) : -1;

  // Subtítulo de la cabecera.
  let subtitle = '';
  let live = false;
  if (thread.presence === 'typing' || thread.presence === 'recording') {
    live = true;
    subtitle = typingLabel(thread, w, names);
  } else if (!group && thread.presence === 'online') subtitle = w('online');
  else if (!group && thread.lastSeenAt) subtitle = lastSeen(thread.lastSeenAt, locale, w);
  else if (group && wa?.participants.length) {
    const list = wa.participants.map((p) => (p.me ? w('you') : p.name || formatPhone(p.phone)));
    const mine = list.indexOf(w('you'));
    if (mine > 0) list.push(list.splice(mine, 1)[0]);
    subtitle = list.join(', ');
  } else subtitle = w('clickInfo');

  const openNotes = async () => {
    if (notesOpen) {
      setNotesOpen(false);
      return;
    }
    const r = await api<{ notes: string }>(`/api/inbox/threads/${thread.id}`);
    setNotes(r.ok ? String(r.data.notes ?? '') : '');
    setNotesOpen(true);
  };

  // Comandos "/" del campo: las mismas acciones de esta cabecera y de su menú.
  const slashCommands = useInboxThreadCommands({
    thread,
    onAction,
    openNotes: () => void openNotes(),
    openInfo: props.onToggleInfo,
    rename: () => setRenaming(thread.title),
    attach: connected ? () => document.querySelector<HTMLInputElement>('.ib-wa-attach input[type=file]')?.click() : undefined,
  });

  const mo = useTranslations('inbox.more');
  const headMenu: MenuItem[] = [
    { key: 'info', label: group ? w('groupInfo') : w('contactInfo'), onSelect: props.onToggleInfo },
    { key: 'followUp', label: t('actions.followUp'), onSelect: () => onAction('followUp') },
    { key: 'move', label: t('actions.move'), onSelect: () => onAction('move') },
    { key: 'notes', label: t('actions.notes'), onSelect: () => void openNotes() },
    { key: 'rename', label: t('actions.rename'), onSelect: () => setRenaming(thread.title) },
    { key: 'unread', label: thread.unread ? mo('read') : mo('unread'), divider: true, onSelect: () => onAction('unread') },
    { key: 'pin', label: thread.pinned ? mo('unpin') : mo('pin'), onSelect: () => onAction('pin') },
    { key: 'archive', label: thread.archived ? t('actions.unarchive') : t('actions.archive'), onSelect: () => onAction(thread.archived ? 'unarchive' : 'archive') },
    { key: 'aiDraft', label: mo('aiDraft'), onSelect: () => onAction('aiDraft') },
    ...(thread.mutedUntil
      ? [{ key: 'unmute', label: mo('unmute'), onSelect: () => onAction('unmute') }]
      : [
          { key: 'mute8h', label: mo('mute8h'), onSelect: () => onAction('mute8h') },
          { key: 'muteWeek', label: mo('muteWeek'), onSelect: () => onAction('muteWeek') },
        ]),
    ...(thread.followUpAt ? [{ key: 'clearFollowUp', label: mo('clearFollowUp'), onSelect: () => onAction('clearFollowUp') }] : []),
    ...(thread.snoozedUntil ? [{ key: 'unsnooze', label: mo('unsnooze'), onSelect: () => onAction('unsnooze') }] : []),
    {
      key: 'chatStyle',
      label: chatStyle === 'whatsapp' ? w('styleUseZerosoft') : w('styleUseWhatsapp'),
      divider: true,
      onSelect: () => void setChatStyle(chatStyle === 'whatsapp' ? 'zerosoft' : 'whatsapp').then((ok) => !ok && onError('generic')),
    },
    { key: 'delete', label: mo('delete'), divider: true, onSelect: () => onAction('delete') },
  ];

  // Mensajes agrupados por día; cola en el primero de cada tanda del mismo remitente.
  const days: Array<{ key: string; at: string; items: ReactNode[] }> = [];
  let prev: MessageDto | null = null;
  for (const m of messages) {
    const key = localDayKey(m.sentAt);
    if (days.at(-1)?.key !== key) {
      days.push({ key, at: m.sentAt, items: [] });
      prev = null;
    }
    const cont = !!prev && senderKey(prev) === senderKey(m);
    prev = m;
    days[days.length - 1].items.push(renderMessage(m, cont));
  }

  function renderMessage(m: MessageDto, cont: boolean) {
    const dir = m.fromMe ? 'out' : 'in';
    const hidden = m.revoked && !revealed.has(m.id);
    const meta = m.meta ?? {};
    const kind = m.mediaType;
    const sticker = kind === 'sticker';
    const bigEmoji = !kind && !m.reply && !m.revoked && !meta.location && !meta.contacts && onlyEmoji(m.body);
    const groupIn = group && !m.fromMe;
    const author = groupIn ? names.get(m.senderHandle) || senderLabel(m.senderName, m.senderHandle) : '';
    const color = groupIn ? `wa-n${colorIndex(m.senderHandle || m.senderName)}` : '';
    const time = new Date(m.sentAt).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
    const reactions = groupReactions(m.reactions ?? []);
    const url = m.hasMedia ? `/api/inbox/media/${m.id}` : '';
    const flush = (kind === 'image' || kind === 'video') && !!url && !hidden;
    const body = m.body ?? '';
    const poll = meta.poll;
    const caption = !!body && !poll && !(kind === 'document' && body === m.mediaName);
    const spacer = Math.ceil(time.length * 6.6 + (m.fromMe ? 26 : 8) + (m.edited ? 52 : 0) + (m.starred ? 14 : 0));
    const gestures = swipeAndHold({
      onSwipe: () => !m.revoked && startReply(m),
      onHold: (el) => el.querySelector<HTMLButtonElement>('.wa-chevron')?.click(),
    });
    return (
      <article
        key={m.id}
        id={`m-${m.id}`}
        className={`gr-msg gr-msg-${dir}${m.revoked ? ' is-deleted' : ''}${cont ? ' is-cont' : ' has-tail'}${bigEmoji || sticker ? ' is-bare' : ''}${reactions.length ? ' has-reactions' : ''}${groupIn ? ' has-avatar' : ''}${flash === m.id ? ' is-target' : ''}${hitId === m.id ? ' ib-msg-hit' : ''}`}
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest('a, input, textarea, video, audio')) return;
          e.preventDefault();
          e.currentTarget.querySelector<HTMLButtonElement>('.wa-chevron')?.click();
        }}
        {...gestures}
      >
        <span className="wa-swipe-reply" aria-hidden="true">
          <ArrowLeft size={18} />
        </span>
        {groupIn && (
          <span className="wa-sender-avatar" aria-hidden="true">
            {!cont && <Avatar name={author} kind="dm" size={26} seed={m.senderHandle || m.senderName} />}
          </span>
        )}
        <div className={`gr-bubble${flush ? ' is-media' : ''}`}>
          {groupIn && !cont && author && (
            <p className={`gr-msg-author ${color}`}>
              <span className="wa-author-name">{author}</span>
              {m.senderHandle && author !== formatPhone(m.senderHandle) && <span className="wa-phone">{formatPhone(m.senderHandle)}</span>}
            </p>
          )}
          {m.forwarded && !hidden && (
            <p className="gr-forwarded">
              <Forwarded size={13} /> {w('forwarded')}
            </p>
          )}
          {m.reply && !hidden && (
            <button
              type="button"
              className={`gr-quote ${m.reply.fromMe ? 'wa-q-me' : group ? `wa-q${colorIndex(m.reply.senderHandle || m.reply.senderName)}` : 'wa-q-them'}`}
              onClick={() => jumpTo(m.reply!.id)}
            >
              <strong>{quoteAuthor(m.reply)}</strong>
              <span>
                <RichText text={quoteText(m.reply)} inline mentions={mentionsFor({ body: quoteText(m.reply), mentionNames: m.reply.mentionNames })} />
              </span>
            </button>
          )}
          {hidden ? (
            <p className="wa-deleted">
              <Ban size={15} /> {m.fromMe ? w('youDeleted') : w('deleted')}
              {(m.body || m.mediaType) && (
                <button type="button" className="gr-link-btn" onClick={() => setRevealed((r) => new Set(r).add(m.id))}>
                  {w('showDeleted')}
                </button>
              )}
              <span className="wa-spacer" aria-hidden="true" style={{ width: `${spacer}px` }} />
            </p>
          ) : null}
          {kind && !hidden && (
            <div className="gr-media">
              {meta.viewOnce ? (
                <span className="wa-viewonce">{w('viewOnce')}</span>
              ) : !url ? (
                <DocCard url="" name={m.mediaName || w(`kind.${['image', 'video', 'audio', 'document', 'sticker'].includes(kind) ? kind : 'document'}`)} type={meta.mime ?? ''} size={meta.size} />
              ) : kind === 'image' || sticker ? (
                <ImageView url={url} alt={m.mediaName || w('kind.image')} sticker={sticker} thumbnail={meta.thumb} width={meta.width} height={meta.height} onLoad={keepAtEnd} onOpen={() => setViewerAt(m.id)} />
              ) : kind === 'video' ? (
                <VideoView url={url} seconds={meta.duration} thumbnail={meta.thumb} width={meta.width} height={meta.height} onOpen={() => setViewerAt(m.id)} />
              ) : kind === 'audio' ? (
                <VoicePlayer id={m.id} src={url} seconds={meta.duration} voice={!!meta.ptt} name={meta.ptt ? undefined : m.mediaName || undefined}
                  waveform={meta.waveform}
                  avatar={m.fromMe ? undefined : group ? { name: author || senderLabel(m.senderName, m.senderHandle), seed: m.senderHandle || m.senderName } : { name, src: thread.avatar || undefined, seed: thread.id }}
                />
              ) : (
                <DocCard url={url} name={m.mediaName || w('kind.document')} type={meta.mime ?? ''} size={meta.size} pages={meta.pages} />
              )}
            </div>
          )}
          {kind === 'audio' && url && !hidden && !meta.viewOnce && (
            <Transcript
              endpoint={`/api/inbox/messages/${m.id}`}
              labels={{ working: w('transcribing'), failed: w('transcribeFailed'), more: w('showMore'), less: w('showLess'), summary: w('audioSummary'), title: w('transcript') }}
            />
          )}
          {meta.location && !hidden && <LocationCard lat={meta.location.lat} lng={meta.location.lng} name={meta.location.name ?? ''} address={meta.location.address} url={meta.location.url} live={meta.location.live} />}
          {!hidden && meta.contacts?.map((c, i) => <ContactCard key={i} name={c.name} phone={(c.phones[0] ?? '').replace(/\D/g, '')} />)}
          {!hidden && !kind && !poll && (meta.link || firstUrl(m.body)) && (
            <LinkPreview
              url={meta.link?.url ?? firstUrl(m.body)}
              given={meta.link ? { url: meta.link.url, title: meta.link.title, description: meta.link.description, image: meta.link.thumb } : null}
            />
          )}
          {poll && !hidden && (
            <div className="ib-wa-poll">
              <p className="ib-wa-poll-q">
                <PollIcon size={16} /> {poll.question}
              </p>
              <ul>
                {poll.options.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ul>
              <p className="ib-wa-poll-note">{poll.multi ? w('pollMulti') : w('pollSingle')}</p>
            </div>
          )}
          {caption && !hidden && !(meta.location && body === [meta.location.name, meta.location.address].filter(Boolean).join(' · ')) && !(meta.contacts && body === meta.contacts.map((c) => c.name).join(', ')) && (
            <p className={`gr-pre wa-text${bigEmoji ? ' is-emoji' : ''}${editing?.id === m.id ? ' is-editing' : ''}`} dir="auto">
              <RichText text={body} mentions={mentionsFor(m)} />
              <span className="wa-spacer" aria-hidden="true" style={{ width: `${spacer}px` }} />
            </p>
          )}
          {m.revoked && !hidden && <p className="wa-tags"><span className="gr-deleted-tag">{w('deletedTag')}</span></p>}
          <p className="gr-msg-foot">
            {m.starred && (
              <span className="wa-star" role="img" aria-label={w('starred')}>
                ★
              </span>
            )}
            {m.edited && !m.revoked && <span className="wa-edited">{w('edited')}</span>}
            <time dateTime={m.sentAt}>{time}</time>
            {m.fromMe && !m.revoked && m.status && <Ticks status={m.status} label={t(`message.status.${['pending', 'sent', 'delivered', 'read', 'failed'].includes(m.status) ? m.status : 'sent'}`)} />}
          </p>
          <span className="wa-hover">
            <MessageMenu label={w('messageMenu')} items={menuFor(m)} trigger={<Chevron size={18} />} className="wa-chevron" align={m.fromMe ? 'right' : 'left'} />
          </span>
        </div>
        {reactions.length > 0 && (
          <button
            type="button"
            className="gr-reactions ib-wa-reactions"
            aria-label={w('reactionsBy', { list: reactions.map((r) => `${r.emoji} ${[...(r.mine ? [w('you')] : []), ...r.names].join(', ')}`).join('; ') })}
            title={reactions.map((r) => `${r.emoji} ${[...(r.mine ? [w('you')] : []), ...r.names].join(', ')}`).join('\n')}
            onClick={() => setPickerFor(pickerFor === m.id ? null : m.id)}
          >
            {reactions.slice(0, 3).map((r) => (
              <span key={r.emoji}>{r.emoji}</span>
            ))}
            {(m.reactions?.length ?? 0) > 1 && <b>{m.reactions!.length}</b>}
          </button>
        )}
        {!m.revoked && connected && !isTempId(m.id) && (
          <div className="gr-msg-actions">
            <button
              type="button"
              className="wa-react-btn"
              onClick={() => setPickerFor(pickerFor === m.id ? null : m.id)}
              aria-expanded={pickerFor === m.id}
              aria-label={w('react')}
              title={w('react')}
            >
              <Smiley size={18} />
            </button>
          </div>
        )}
        {pickerFor === m.id && (
          <span className="gr-emoji-picker" role="group" aria-label={w('react')} onKeyDown={(e) => e.key === 'Escape' && setPickerFor(null)}>
            {QUICK.map((e) => (
              <button key={e} type="button" className={(m.reactions ?? []).some((r) => r.by === 'me' && r.emoji === e) ? 'is-mine' : ''} onClick={() => void react(m, e)} aria-label={e}>
                {e}
              </button>
            ))}
            <button type="button" onClick={() => openFullPicker(m.id)} aria-label={w('moreEmoji')} title={w('moreEmoji')}>
              <Plus size={20} />
            </button>
          </span>
        )}
        {fullPickerFor === m.id && (
          <span className="ib-wa-react-full">
            <EmojiPicker onPick={(e) => void react(m, e)} onClose={() => setFullPickerFor(null)} />
          </span>
        )}
      </article>
    );
  }

  const banner = editing ? (
    <ComposerBanner label={w('cancelEdit')} onClose={() => setEditing(null)}>
      <span className="gr-quote wa-q-me gr-quote-plain wa-editing">
        <strong>{w('editing')}</strong>
        <span>{mentionText(editing)}</span>
      </span>
    </ComposerBanner>
  ) : replyTo ? (
    <ComposerBanner label={w('cancelReply')} onClose={() => setReplyTo(null)}>
      <span className={`gr-quote gr-quote-plain ${replyTo.fromMe ? 'wa-q-me' : group ? `wa-q${colorIndex(replyTo.senderHandle || replyTo.senderName)}` : 'wa-q-them'}`}>
        <strong>{quoteAuthor(replyTo)}</strong>
        <span>
          <RichText text={quoteText(replyTo)} inline mentions={mentionsFor({ body: quoteText(replyTo), mentionNames: replyTo.mentionNames })} />
        </span>
      </span>
    </ComposerBanner>
  ) : null;

  const targets = props.threads.filter((x) => x.channel === 'whatsapp' && x.id !== thread.id).slice(0, 50);

  return (
    <section
      className={`gr-thread wa-thread ib-wa-thread${dragging ? ' is-dragging' : ''}`}
      aria-label={name}
      onDragEnter={(e) => {
        if (!connected || !hasFiles(e.dataTransfer)) return;
        e.preventDefault();
        dragDepth.current++;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (!connected || !hasFiles(e.dataTransfer)) return;
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
        if (connected) tray.add(filesFrom(e.dataTransfer));
      }}
    >
      <header className="gr-thread-head wa-head">
        <button type="button" className="wa-icon-btn ib-back ib-wa-back" onClick={props.onBack} aria-label={t('actions.back')}>
          <ArrowLeft size={22} />
        </button>
        <button type="button" className="wa-head-who" onClick={props.onToggleInfo} aria-expanded={props.infoOpen} aria-label={group ? w('groupInfo') : w('contactInfo')}>
          <Avatar name={name} kind={group ? 'group' : 'dm'} src={thread.avatar || undefined} seed={thread.id} size={36} />
          <span className="gr-thread-title">
            <h2 dir="auto">{name}</h2>
            <span className={`wa-head-sub${live ? ' is-typing' : ''}`}>{subtitle}</span>
          </span>
        </button>
        <div className="gr-thread-actions">
          <button type="button" className={`wa-icon-btn${thread.done ? ' is-on' : ''}`} onClick={() => onAction(thread.done ? 'undone' : 'done')} aria-label={thread.done ? t('actions.undone') : t('actions.done')} title={`${thread.done ? t('actions.undone') : t('actions.done')} (${thread.done ? '⇧E' : 'E'})`}>
            <CheckCircle size={20} />
          </button>
          <button type="button" className="wa-icon-btn" onClick={() => onAction('snooze')} aria-label={t('actions.snooze')} title={`${t('actions.snooze')} (H)`}>
            <ClockIcon size={20} />
          </button>
          <button type="button" className={`wa-icon-btn ib-hide-sm${thread.followUpAt ? ' is-on' : ''}`} onClick={() => onAction('followUp')} aria-label={t('actions.followUp')} title={`${t('actions.followUp')} (F)`}>
            <Bell size={20} />
          </button>
          <button type="button" className="wa-icon-btn ib-hide-sm" onClick={() => onAction('move')} aria-label={t('actions.move')} title={`${t('actions.move')} (V)`}>
            <FolderIcon size={20} />
          </button>
          <button type="button" className={`wa-icon-btn ib-hide-sm${notesOpen ? ' is-on' : ''}`} onClick={() => void openNotes()} aria-expanded={notesOpen} aria-label={t('actions.notes')} title={t('actions.notes')}>
            <Note size={20} />
          </button>
          {thread.pinned && <PinIcon size={16} label={t('list.pinned')} />}
          <MessageMenu label={t('actions.more')} items={headMenu} className="wa-icon-btn" />
        </div>
      </header>
      {(thread.snoozedUntil || thread.followUpAt) && (
        <p className="gr-banner wa-strip">
          {thread.snoozedUntil && t('list.snoozedUntil', { when: longWhen(thread.snoozedUntil, locale) })}
          {thread.snoozedUntil && thread.followUpAt && ' · '}
          {thread.followUpAt && t('list.followUpAt', { when: longWhen(thread.followUpAt, locale) })}
        </p>
      )}
      {notesOpen && (
        <div className="ib-notes">
          <label className="label" htmlFor="ib-notes-text">
            {t('notes.label')}
          </label>
          <p className="ib-help">{t('notes.help')}</p>
          <textarea
            id="ib-notes-text"
            className="textarea"
            rows={5}
            value={notes}
            maxLength={20000}
            onChange={(e) => {
              setNotes(e.target.value);
              setNotesState('');
            }}
          />
          <div className="ib-row">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={notesState === 'saving'}
              onClick={async () => {
                setNotesState('saving');
                const r = await api(`/api/inbox/threads/${thread.id}`, { method: 'PATCH', json: { notes } });
                setNotesState(r.ok ? 'saved' : '');
                if (!r.ok) onError(r.data.error ?? 'generic');
              }}
            >
              {notesState === 'saving' ? t('notes.saving') : t('notes.save')}
            </button>
            {notesState === 'saved' && <span className="ib-dim">{t('notes.saved')}</span>}
          </div>
        </div>
      )}
      <div className="wa-scroll">
        <div className="gr-messages wa-messages" ref={scroller} onScroll={onScroll} tabIndex={-1}>
          {detail.more && (
            <div className="wa-older">
              <button type="button" className="btn btn-sm" onClick={() => void props.loadOlder()}>
                {t('message.older')}
              </button>
            </div>
          )}
          {messages.length === 0 && <p className="wa-empty-thread">{t('message.empty')}</p>}
          {days.map((d) => (
            <section key={d.key} className="wa-dayblock">
              <div className="wa-day" role="separator">
                <span>{dayLabel(d.at, locale)}</span>
              </div>
              {d.items}
            </section>
          ))}
        </div>
        {!atBottom && (
          <button type="button" className="wa-to-end" aria-label={w('toEnd')} onClick={() => anchor.toBottom()}>
            <ArrowDown size={20} />
          </button>
        )}
      </div>
      <ScheduledList thread={thread} scheduled={scheduled} connected={connected} onChange={props.onScheduledChange} onError={onError} />
      {recording ? (
        <div className="wa-composer ib-wa-composer">
          {banner}
          <VoiceBar
            threadId={thread.id}
            replyTo={replyTo?.id}
            onSent={(msgs) => {
              setReplyTo(null);
              sentHere(msgs);
            }}
            onError={onError}
            onDone={() => setRecording(false)}
            onStart={() => presence('recording')}
          />
        </div>
      ) : (
        <WaComposer
          key={thread.id}
          ref={composerRef}
          thread={thread}
          snippets={props.snippets}
          disabled={!connected}
          paused={props.paused}
          banner={banner}
          editing={editing}
          replyToId={replyTo?.id ?? null}
          attach={(extra) => <AttachButton onFiles={tray.add} disabled={!connected} extra={extra} />}
          onMic={connected && typeof MediaRecorder !== 'undefined' ? () => setRecording(true) : undefined}
          onPasteFiles={connected ? tray.add : undefined}
          mentionables={group ? (wa?.participants ?? []).filter((p) => !p.me).map((p) => ({ phone: p.phone, name: p.name })) : undefined}
          onTyping={() => presence('composing')}
          commands={slashCommands}
          onCancelBanner={() => {
            setEditing(null);
            setReplyTo(null);
          }}
          onSent={sentHere}
          onSaveEdit={async (m, body) => act(m, { action: 'edit', body })}
          onSendLater={props.onSendLater}
          onError={onError}
        />
      )}
      {tray.items.length > 0 && (
        <AttachPreview
          items={tray.items}
          sending={tray.sending}
          errText={(code) => (code && t.has(`errors.${code}`) ? t(`errors.${code}`) : code && w.has(`errors.${code}`) ? w(`errors.${code}`) : w('sendFailed'))}
          onCaption={tray.setCaption}
          onRemove={tray.remove}
          onRetry={tray.retry}
          onAdd={() => document.querySelector<HTMLInputElement>('.ib-wa-attach input[type=file]')?.click()}
          onClose={tray.clear}
          onSend={async () => {
            const done = await tray.sendAll(replyTo?.id);
            if (done) setReplyTo(null);
          }}
        />
      )}
      {dragging && (
        <div className="wa-drop" aria-hidden="true">
          <span>
            <strong>{w('dropTitle')}</strong>
            {w('dropBody')}
          </span>
        </div>
      )}
      {viewerIndex >= 0 && <MediaViewer items={viewerItems} index={viewerIndex} onIndex={(i) => setViewerAt(viewerItems[i]?.id ?? null)} onClose={() => setViewerAt(null)} />}
      <Modal open={!!infoFor} title={w('info')} onClose={() => setInfoFor(null)}>
        {infoFor && (
          <>
            <div className="ui-modal-body">
              <p className="ib-wa-info-body">{mentionText(infoFor) || quoteText({ body: '', mediaType: infoFor.mediaType })}</p>
              <dl className="wa-info">
                <div>
                  <dt>
                    <Ticks status="read" label={t('message.status.read')} /> {t('message.status.read')}
                  </dt>
                  <dd>{infoFor.status === 'read' ? w('yes') : w('notYet')}</dd>
                </div>
                <div>
                  <dt>
                    <Ticks status="delivered" label={t('message.status.delivered')} /> {t('message.status.delivered')}
                  </dt>
                  <dd>{infoFor.status === 'read' || infoFor.status === 'delivered' ? w('yes') : w('notYet')}</dd>
                </div>
                <div>
                  <dt>{w('sentAt')}</dt>
                  <dd>{longWhen(infoFor.sentAt, locale)}</dd>
                </div>
              </dl>
              <p className="ib-help">{w('infoNote')}</p>
            </div>
            <div className="ui-modal-foot">
              <button type="button" className="btn btn-secondary btn-sm" autoFocus onClick={() => setInfoFor(null)}>
                {w('close')}
              </button>
            </div>
          </>
        )}
      </Modal>
      <Modal open={renaming !== null} title={t('actions.rename')} onClose={() => setRenaming(null)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const v = (renaming ?? '').trim();
            if (v) props.onRename(v);
            setRenaming(null);
          }}
        >
          <div className="ui-modal-body">
            <label className="sr-only" htmlFor="ib-rename">
              {t('actions.rename')}
            </label>
            <input id="ib-rename" className="input" value={renaming ?? ''} maxLength={200} autoFocus onChange={(e) => setRenaming(e.target.value)} />
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRenaming(null)}>
              {t('more.cancel')}
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={!(renaming ?? '').trim()}>
              {t('actions.save')}
            </button>
          </div>
        </form>
      </Modal>
      <Modal open={!!forwardFor} title={w('forwardTo')} onClose={() => setForwardFor(null)}>
        {forwardFor && (
          <ForwardPicker
            targets={targets}
            groupLabel={w('group')}
            onCancel={() => setForwardFor(null)}
            onSend={async (ids) => {
              const m = forwardFor;
              setForwardFor(null);
              const r = await api<{ sent: string[] }>(`/api/inbox/messages/${m.id}`, { method: 'PATCH', json: { action: 'forward', to: ids } });
              if (!r.ok) onError(r.data.error ?? 'send_failed');
              else props.onToast(w('forwardedTo', { n: r.data.sent.length }));
              onRefresh();
            }}
          />
        )}
      </Modal>
    </section>
  );
});

export default WaConversation;

/** Elegir hasta 5 chats para reenviar (como WhatsApp), con búsqueda. */
function ForwardPicker({ targets, groupLabel, onCancel, onSend }: { targets: ThreadDto[]; groupLabel: string; onCancel: () => void; onSend: (ids: string[]) => void }) {
  const w = useTranslations('inboxWa');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const list = targets.filter((x) => chatName(x, groupLabel).toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <>
      <div className="ui-modal-body">
        <label className="sr-only" htmlFor="ib-wa-fwd-q">
          {w('search')}
        </label>
        <input id="ib-wa-fwd-q" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={w('search')} autoFocus />
        <ul className="ib-pick-list">
          {list.length === 0 && <li className="ib-dim">{w('noChats')}</li>}
          {list.map((x) => {
            const on = picked.includes(x.id);
            return (
              <li key={x.id}>
                <label className={`ib-pick${on ? ' is-on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!on && picked.length >= 5}
                    onChange={() => setPicked((p) => (on ? p.filter((i) => i !== x.id) : [...p, x.id]))}
                  />
                  <Avatar name={chatName(x, groupLabel)} kind={x.kind === 'group' ? 'group' : 'dm'} src={x.avatar || undefined} seed={x.id} size={32} />
                  <span className="ib-pick-name">{chatName(x, groupLabel)}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="ui-modal-foot">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          {w('cancel')}
        </button>
        <button type="button" className="btn btn-primary btn-sm" disabled={!picked.length} onClick={() => onSend(picked)}>
          {w('send', { n: picked.length })}
        </button>
      </div>
    </>
  );
}
