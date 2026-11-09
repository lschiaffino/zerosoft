'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import EmptyState from '@/components/ui/EmptyState';
import type { ThreadAction } from '@/lib/inbox/core';
import type { FolderDto, InboxAccountDto, InboxView, MessageDto, SnippetDto, ThreadDto } from '@/lib/inbox/types';
import type { MessageHit } from '@/lib/inbox/message-search';
import { api, INBOX_CHANGED, INBOX_DROP_THREADS, longWhen, notifyInboxChanged, shortWhen, THREADS_MIME, typingIn, type DropThreadsDetail } from './api';
import ChatRow from './wa/ChatRow';
import WaConversation, { type WaThreadDetail } from './wa/WaConversation';
import ContactPanel from './wa/ContactPanel';
import { ArchiveIcon, ArrowLeft } from '@/components/groups/wa/icons';
import { useChatStyle } from '@/components/chat-style/ChatStyle';
import { rowSwipe } from './wa/gestures';
import Conversation from './Conversation';
import type { ComposerHandle } from './Composer';
import WhenDialog, { type WhenKind } from './WhenDialog';
import ScheduleDialog, { type ScheduleTarget } from './ScheduleDialog';
import { ComposeDialog, FolderDialog, HelpDialog, MoreDialog, MoveDialog, type MoreAction } from './InboxDialogs';
import { WhatsappQrDialog } from './InboxSettings';

export interface InboxStateDto {
  accounts: InboxAccountDto[];
  folders: FolderDto[];
  counts: Record<string, number>;
  snippets: SnippetDto[];
  available: { whatsapp: boolean; gmail: boolean };
}

const TABS: InboxView[] = ['inbox', 'whatsapp', 'email', 'groups', 'unread'];
const UNDO: Partial<Record<ThreadAction['action'], ThreadAction['action']>> = {
  done: 'undone',
  undone: 'done',
  pin: 'unpin',
  unpin: 'pin',
  read: 'unread',
  unread: 'read',
  snooze: 'unsnooze',
  followUp: 'clearFollowUp',
  archive: 'unarchive',
  unarchive: 'archive',
};
/** Acciones que sacan el chat de la vista actual. */
const LEAVES: Partial<Record<InboxView, ThreadAction['action'][]>> = {
  inbox: ['done', 'snooze', 'archive'],
  whatsapp: ['done', 'snooze', 'archive'],
  email: ['done', 'snooze', 'archive'],
  groups: ['done', 'snooze', 'archive'],
  unread: ['done', 'snooze', 'read', 'archive'],
  reply: ['done', 'snooze', 'archive'],
  waiting: ['done', 'snooze', 'archive'],
  pinned: ['unpin', 'archive'],
  archived: ['unarchive'],
  snoozed: ['unsnooze', 'done'],
  done: ['undone', 'snooze', 'archive'],
};

interface Toast {
  id: number;
  text: string;
  bad?: boolean;
  undo?: () => void;
}

const HIT_MARK_START = '\u0002';

/** Texto de un resultado con lo encontrado resaltado (marcas \u0002…\u0003 del servidor; nunca HTML). */
function Highlighted({ text }: { text: string }) {
  const parts = text.split(/(\u0002[^\u0003]*\u0003)/);
  return (
    <>
      {parts.map((p, i) => (p.startsWith('\u0002') ? <mark key={i}>{p.slice(1, -1)}</mark> : <span key={i}>{p}</span>))}
    </>
  );
}

function viewHref(v: InboxView): string {
  return v === 'inbox' ? '/app/inbox' : `/app/inbox/v/${v}`;
}

/**
 * Inbox: la lista a la izquierda (como WhatsApp Web) y la conversación a la
 * derecha, manejable entera con el teclado (atajos de Superhuman). En
 * pantallas chicas se ve una cosa a la vez.
 */
export default function InboxApp(props: {
  view: InboxView;
  folder: FolderDto | null;
  initialThreads: ThreadDto[];
  initialState: InboxStateDto;
  initialOpenId: string | null;
  /** Mensaje al que ir al abrir (desde Cmd+K). */
  initialFocusId?: string | null;
  composeOnLoad: boolean;
}) {
  const t = useTranslations('inbox');
  const w = useTranslations('inboxWa');
  const { style: chatStyle } = useChatStyle();
  const locale = useLocale();
  const router = useRouter();
  const { view, folder } = props;
  const [threads, setThreads] = useState(props.initialThreads);
  const [state, setState] = useState(props.initialState);
  const [cursor, setCursor] = useState(0);
  const [openId, setOpenId] = useState<string | null>(props.initialOpenId);
  // Mensaje al que ir cuando se abre el chat (resultado de búsqueda).
  const focusRef = useRef<{ threadId: string; messageId: string } | null>(props.initialOpenId && props.initialFocusId ? { threadId: props.initialOpenId, messageId: props.initialFocusId } : null);
  const [msgHits, setMsgHits] = useState<MessageHit[]>([]);
  const [msgMore, setMsgMore] = useState(false);
  const [detail, setDetail] = useState<(WaThreadDetail & { focus?: string }) | null>(null);
  const [detailErr, setDetailErr] = useState('');
  const [listErr, setListErr] = useState(false);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [when, setWhen] = useState<{ kind: WhenKind; ids: string[]; text?: string } | null>(null);
  const [moveIds, setMoveIds] = useState<string[] | null>(null);
  const [plan, setPlan] = useState<ScheduleTarget | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreConfirm, setMoreConfirm] = useState(false);
  const moreActionRef = useRef<(a: MoreAction) => Promise<void>>(async () => {});
  const [infoOpen, setInfoOpen] = useState(false);
  // Otro chat: el panel de info se cierra (como en WhatsApp Web).
  useEffect(() => setInfoOpen(false), [openId]);
  const [compose, setCompose] = useState(props.composeOnLoad);
  const [help, setHelp] = useState(false);
  // Vincular WhatsApp con QR desde la bandeja vacía, sin pasar por Ajustes.
  const [qrOpen, setQrOpen] = useState(false);
  const [folderEdit, setFolderEdit] = useState<FolderDto | 'new' | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const lastUndo = useRef<(() => void) | null>(null);
  const seq = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const composer = useRef<ComposerHandle>(null);
  const gPending = useRef(0);

  const errText = useCallback((code?: string) => (code && t.has(`errors.${code}`) ? t(`errors.${code}`) : code && w.has(`errors.${code}`) ? w(`errors.${code}`) : t('errors.generic')), [t, w]);
  const toast = useCallback((text: string, opts: { bad?: boolean; undo?: () => void } = {}) => {
    const id = ++seq.current;
    setToasts((x) => [...x.slice(-2), { id, text, ...opts }]);
    if (opts.undo) lastUndo.current = opts.undo;
    window.setTimeout(() => setToasts((x) => x.filter((i) => i.id !== id)), opts.undo ? 6000 : 4000);
  }, []);

  const listUrl = useMemo(() => {
    const p = new URLSearchParams();
    if (folder) p.set('folder', folder.id);
    else p.set('view', view);
    if (q.trim()) p.set('q', q.trim());
    return `/api/inbox/threads?${p.toString()}`;
  }, [folder, view, q]);

  const reloadList = useCallback(async () => {
    const r = await api<{ threads: ThreadDto[] }>(listUrl);
    if (!r.ok) {
      setListErr(true);
      return;
    }
    setListErr(false);
    setThreads(r.data.threads);
  }, [listUrl]);

  const reloadState = useCallback(async () => {
    const r = await api<InboxStateDto>('/api/inbox/state');
    if (r.ok) setState(r.data);
  }, []);

  const loadDetail = useCallback(async (id: string, quiet = false) => {
    if (!quiet) setDetailErr('');
    const focus = !quiet && focusRef.current?.threadId === id ? focusRef.current.messageId : '';
    if (focus) focusRef.current = null;
    const r = await api<WaThreadDetail>(`/api/inbox/threads/${id}${focus ? `?around=${encodeURIComponent(focus)}` : ''}`);
    if (!r.ok) {
      if (!quiet) setDetailErr(r.data.error ?? 'generic');
      return;
    }
    if (focus) {
      setDetail({ ...r.data, focus, extended: true });
      return;
    }
    setDetail((d) => {
      // Con mensajes anteriores ya cargados: quedan los de antes de esta página y lo reciente se actualiza
      // (reacciones, tildes, borrados). Si no, la página nueva tal cual.
      if (!(quiet && d && d.thread.id === id && d.extended)) return r.data;
      const first = r.data.messages[0]?.sentAt;
      const older = first ? d.messages.filter((m) => m.sentAt < first) : d.messages;
      return { ...r.data, messages: [...older, ...r.data.messages], more: d.more, extended: true };
    });
  }, []);

  /** Mensajes que coinciden con la búsqueda (texto completo y filtros). */
  const searchMsgs = useCallback(
    async (more = false) => {
      const term = q.trim();
      if (!term) {
        setMsgHits([]);
        setMsgMore(false);
        return;
      }
      const last = more ? msgHits[msgHits.length - 1]?.sentAt : undefined;
      const r = await api<{ messages: MessageHit[]; more: boolean }>(`/api/inbox/search?q=${encodeURIComponent(term)}${last ? `&before=${encodeURIComponent(last)}` : ''}`);
      if (!r.ok) return;
      setMsgHits((h) => (more ? [...h, ...r.data.messages] : r.data.messages));
      setMsgMore(r.data.more);
    },
    [q, msgHits],
  );

  const openHit = (h: MessageHit) => {
    focusRef.current = { threadId: h.threadId, messageId: h.id };
    if (openId === h.threadId) void loadDetail(h.threadId);
    else {
      const idx = threads.findIndex((x) => x.id === h.threadId);
      if (idx >= 0) setCursor(idx);
      setOpenId(h.threadId);
    }
  };

  // Búsqueda: espera a que se deje de escribir.
  const firstSearch = useRef(true);
  useEffect(() => {
    if (firstSearch.current) {
      firstSearch.current = false;
      return;
    }
    setLoading(true);
    const id = window.setTimeout(() => {
      void reloadList().finally(() => setLoading(false));
      void searchMsgs();
    }, 220);
    return () => window.clearTimeout(id);
  }, [reloadList]); // eslint-disable-line react-hooks/exhaustive-deps

  // Abrir un chat: lo trae, lo marca leído (y "volvió" visto) y deja la URL compartible.
  useEffect(() => {
    if (!openId) {
      setDetail(null);
      return;
    }
    void loadDetail(openId);
    const url = new URL(window.location.href);
    url.searchParams.set('t', openId);
    window.history.replaceState(window.history.state, '', url.toString());
    const th = threads.find((x) => x.id === openId);
    if (th && (th.unread > 0 || th.woke)) {
      void api(`/api/inbox/threads/${openId}`, { method: 'PATCH', json: { action: 'seen' } }).then(() => {
        setThreads((xs) => xs.map((x) => (x.id === openId ? { ...x, unread: 0, woke: '' } : x)));
        void reloadState();
      });
    }
  }, [openId]); // eslint-disable-line react-hooks/exhaustive-deps

  // En vivo: cada 8 s con la pestaña visible, y al volver a la pestaña.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      void reloadList();
      void reloadState();
      if (openId) void loadDetail(openId, true);
    };
    const id = window.setInterval(tick, 8000);
    const onVis = () => tick();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener(INBOX_CHANGED, tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener(INBOX_CHANGED, tick);
    };
  }, [reloadList, reloadState, loadDetail, openId]);

  // Chat de WhatsApp abierto: cada 3 s (escribiendo…, tildes, reacciones), como en vivo.
  const openIsWa = detail?.thread.channel === 'whatsapp' && detail.thread.id === openId;
  useEffect(() => {
    if (!openId || !openIsWa) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadDetail(openId, true);
    }, 3000);
    return () => window.clearInterval(id);
  }, [openId, openIsWa, loadDetail]);

  useEffect(() => {
    if (cursor >= threads.length && threads.length) setCursor(threads.length - 1);
  }, [threads.length, cursor]);

  // El cursor siempre a la vista.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const current = threads[cursor] ?? null;
  const targetIds = useCallback((): string[] => {
    if (selected.size) return [...selected];
    if (openId) return [openId];
    return current ? [current.id] : [];
  }, [selected, openId, current]);

  const runAction = useCallback(
    async (ids: string[], action: ThreadAction, opts: { silent?: boolean } = {}): Promise<boolean> => {
      if (!ids.length) return false;
      const r = await api('/api/inbox/threads', { method: 'POST', json: { ids, ...action } });
      if (!r.ok) {
        toast(errText(r.data.error), { bad: true });
        return false;
      }
      const leaves = !q && (folder ? ['done', 'snooze', 'archive'] : (LEAVES[view] ?? [])).includes(action.action);
      if (leaves) {
        const idx = threads.findIndex((x) => ids.includes(x.id));
        const rest = threads.filter((x) => !ids.includes(x.id));
        setThreads(rest);
        setSelected(new Set());
        if (openId && ids.includes(openId)) {
          const next = rest[Math.min(Math.max(idx, 0), rest.length - 1)];
          setOpenId(next ? next.id : null);
          if (!next) {
            const url = new URL(window.location.href);
            url.searchParams.delete('t');
            window.history.replaceState(window.history.state, '', url.toString());
          }
        }
        setCursor(Math.min(Math.max(idx, 0), Math.max(rest.length - 1, 0)));
      } else {
        void reloadList();
      }
      if (openId && ids.includes(openId)) void loadDetail(openId, true);
      void reloadState();
      notifyInboxChanged();
      const inverse = UNDO[action.action];
      if (!opts.silent) {
        const undo = inverse || action.action === 'addFolder' ? () => {
          const back: ThreadAction = action.action === 'addFolder' ? { action: 'removeFolder', folderId: action.folderId } : ({ action: inverse } as ThreadAction);
          void api('/api/inbox/threads', { method: 'POST', json: { ids, ...back } }).then(() => {
            void reloadList();
            void reloadState();
            notifyInboxChanged();
          });
        } : undefined;
        toast(t(`toast.${action.action}`, { n: ids.length }), { undo });
      }
      return true;
    },
    [q, folder, view, threads, openId, toast, errText, t, reloadList, reloadState, loadDetail],
  );

  const act = useCallback(
    (name: string) => {
      const ids = targetIds();
      if (!ids.length) return;
      const th = threads.find((x) => x.id === ids[0]) ?? detail?.thread;
      switch (name) {
        case 'done':
        case 'undone':
          void runAction(ids, { action: name });
          break;
        case 'toggleDone':
          void runAction(ids, { action: th?.done ? 'undone' : 'done' });
          break;
        case 'snooze':
          setWhen({ kind: 'snooze', ids });
          break;
        case 'followUp':
          setWhen({ kind: 'followUp', ids });
          break;
        case 'move':
          setMoveIds(ids);
          break;
        case 'more':
          setMoreConfirm(false);
          setMoreOpen(true);
          break;
        case 'delete':
          setMoreConfirm(true);
          setMoreOpen(true);
          break;
        case 'aiDraft':
        case 'mute8h':
        case 'muteWeek':
        case 'unmute':
        case 'clearFollowUp':
        case 'unsnooze':
          void moreActionRef.current(name);
          break;
        case 'archive':
        case 'unarchive':
          void runAction(ids, { action: name });
          break;
        case 'unread':
          void runAction(ids, { action: th && th.unread > 0 ? 'read' : 'unread' });
          break;
        case 'pin':
          void runAction(ids, { action: th?.pinned ? 'unpin' : 'pin' });
          break;
      }
    },
    [targetIds, threads, detail, runAction],
  );

  /**
   * Chats soltados sobre una carpeta del sidebar. En la bandeja (o una vista)
   * se suman a la carpeta; dentro de otra carpeta se mueven (salen de la
   * actual). Deshacer vuelve exactamente a como estaban.
   */
  const dropOnFolder = useCallback(
    async ({ ids, folderId, folderName }: DropThreadsDetail) => {
      const from = folder && folder.id !== folderId ? folder.id : null;
      const fresh = ids.filter((id) => !(threads.find((x) => x.id === id)?.folderIds ?? []).includes(folderId));
      const post = (list: string[], a: ThreadAction) => (list.length ? api('/api/inbox/threads', { method: 'POST', json: { ids: list, ...a } }) : Promise.resolve({ ok: true, status: 200, data: {} as { error?: string } }));
      const r = await post(fresh, { action: 'addFolder', folderId });
      const r2 = r.ok && from ? await post(ids, { action: 'removeFolder', folderId: from }) : r;
      if (!r.ok || !r2.ok) {
        toast(errText((r.ok ? r2 : r).data.error), { bad: true });
        return;
      }
      setSelected(new Set());
      const refresh = () => {
        void reloadList();
        void reloadState();
        notifyInboxChanged();
      };
      refresh();
      const undo = () =>
        void post(fresh, { action: 'removeFolder', folderId })
          .then(() => (from ? post(ids, { action: 'addFolder', folderId: from }) : null))
          .then(refresh);
      toast(t(from ? 'toast.movedTo' : 'toast.addedTo', { n: ids.length, name: folderName }), { undo });
    },
    [folder, threads, toast, errText, t, reloadList, reloadState],
  );

  useEffect(() => {
    const on = (e: Event) => void dropOnFolder((e as CustomEvent<DropThreadsDetail>).detail);
    window.addEventListener(INBOX_DROP_THREADS, on);
    return () => window.removeEventListener(INBOX_DROP_THREADS, on);
  }, [dropOnFolder]);

  const open = (id: string) => {
    const idx = threads.findIndex((x) => x.id === id);
    if (idx >= 0) setCursor(idx);
    setOpenId(id);
  };

  const closeConvo = useCallback(() => {
    setOpenId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('t');
    window.history.replaceState(window.history.state, '', url.toString());
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-idx="${cursor}"] .ib-row-btn`)?.focus());
  }, [cursor]);

  const moreAction = async (a: MoreAction) => {
    setMoreOpen(false);
    setMoreConfirm(false);
    const th = detail?.thread ?? current;
    if (!th) return;
    if (a === 'delete') {
      const r = await api(`/api/inbox/threads/${th.id}`, { method: 'DELETE' });
      if (!r.ok) {
        toast(errText(r.data.error), { bad: true });
        return;
      }
      setThreads((xs) => xs.filter((x) => x.id !== th.id));
      if (openId === th.id) closeConvo();
      toast(t('toast.deleted'));
      void reloadState();
      notifyInboxChanged();
      return;
    }
    if (a === 'mute8h' || a === 'muteWeek' || a === 'unmute') {
      const until = a === 'unmute' ? null : new Date(Date.now() + (a === 'mute8h' ? 8 : 168) * 3600_000).toISOString();
      await runAction([th.id], { action: 'mute', until });
      return;
    }
    if (a === 'unread') await runAction([th.id], { action: th.unread > 0 ? 'read' : 'unread' });
    if (a === 'pin') await runAction([th.id], { action: th.pinned ? 'unpin' : 'pin' });
    if (a === 'clearFollowUp') await runAction([th.id], { action: 'clearFollowUp' });
    if (a === 'unsnooze') await runAction([th.id], { action: 'unsnooze' });
    if (a === 'aiDraft') composer.current?.draft();
  };
  moreActionRef.current = moreAction;

  const modalOpen = !!when || !!plan || !!moveIds || moreOpen || compose || help || qrOpen || !!folderEdit;

  // Atajos de una letra (fuera de los campos y sin modales abiertos).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (modalOpen || e.defaultPrevented || typingIn(document.activeElement) || document.querySelector('dialog[open]')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if (gPending.current && Date.now() - gPending.current < 1200) {
        gPending.current = 0;
        const go: Record<string, InboxView> = { i: 'inbox', d: 'done', s: 'snoozed', r: 'reply', w: 'waiting', l: 'scheduled', u: 'unread' };
        if (go[k]) {
          e.preventDefault();
          router.push(viewHref(go[k]));
        }
        return;
      }
      const handled = () => e.preventDefault();
      switch (k) {
        case 'j':
        case 'ArrowDown':
          handled();
          setCursor((c) => {
            const n = Math.min(c + 1, threads.length - 1);
            if (openId && threads[n]) setOpenId(threads[n].id);
            return n;
          });
          break;
        case 'k':
        case 'ArrowUp':
          handled();
          setCursor((c) => {
            const n = Math.max(c - 1, 0);
            if (openId && threads[n]) setOpenId(threads[n].id);
            return n;
          });
          break;
        case 'Enter':
        case 'o':
          if (current) {
            handled();
            setOpenId(current.id);
          }
          break;
        case 'Escape':
          if (selected.size) setSelected(new Set());
          else if (infoOpen) setInfoOpen(false);
          else if (openId) closeConvo();
          else if (q) setQ('');
          break;
        case 'e':
          handled();
          act('toggleDone');
          break;
        case 'E':
          handled();
          act('undone');
          break;
        case 'h':
          handled();
          act('snooze');
          break;
        case 'f':
          handled();
          act('followUp');
          break;
        case 'u':
          handled();
          act('unread');
          break;
        case 'p':
          handled();
          act('pin');
          break;
        case 'v':
          handled();
          act('move');
          break;
        case 'x':
          if (current) {
            handled();
            setSelected((s) => {
              const n = new Set(s);
              if (n.has(current.id)) n.delete(current.id);
              else n.add(current.id);
              return n;
            });
          }
          break;
        case 'r':
          if (current || openId) {
            handled();
            if (!openId && current) setOpenId(current.id);
            window.setTimeout(() => composer.current?.focus(), openId ? 0 : 350);
          }
          break;
        case 'c':
          handled();
          setCompose(true);
          break;
        case '/':
          handled();
          searchRef.current?.focus();
          break;
        case 'z':
          if (lastUndo.current) {
            handled();
            const u = lastUndo.current;
            lastUndo.current = null;
            u();
            toast(t('toast.reverted'));
          }
          break;
        case '?':
          handled();
          setHelp(true);
          break;
        case 'g':
          gPending.current = Date.now();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modalOpen, threads, current, openId, selected, q, act, closeConvo, router, toast, t, infoOpen]);

  const accounts = state.accounts;
  const noAccounts = accounts.length === 0;
  const detailAccount = detail ? accounts.find((a) => a.id === detail.thread.accountId) : null;
  const tabView = folder ? null : TABS.includes(view) ? view : null;

  const viewTitle = folder ? folder.name : q ? t('list.searchResults') : t(`views.${view}`);

  const rowFor = (th: ThreadDto, i: number) => {
    const isSel = selected.has(th.id);
    const marker = th.woke === 'snooze' ? t('list.woke') : th.woke === 'followup' ? t('list.noReply') : '';
    return (
      <li
        key={th.id}
        data-idx={i}
        className={`ib-item${i === cursor ? ' is-cursor' : ''}${th.id === openId ? ' is-open' : ''}${th.unread ? ' is-unread' : ''}${isSel ? ' is-selected' : ''}`}
        draggable
        onDragStart={(e) => {
          // Arrastrar a una carpeta del sidebar: la selección entera si este chat está en ella.
          const ids = isSel ? [...selected] : [th.id];
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData(THREADS_MIME, JSON.stringify(ids));
          e.dataTransfer.setData('text/plain', ids.length > 1 ? t('list.dragMany', { n: ids.length }) : th.title);
        }}
        data-left-label={th.done ? t('actions.undone') : t('actions.done')}
        data-right-label={th.pinned ? w('unpin') : w('pin')}
        {...rowSwipe({
          onLeft: () => void runAction([th.id], { action: th.done ? 'undone' : 'done' }),
          onRight: () => void runAction([th.id], { action: th.pinned ? 'unpin' : 'pin' }),
        })}
      >
        <input
          type="checkbox"
          className="ib-check"
          checked={isSel}
          aria-label={t('list.select', { name: th.title })}
          onChange={() =>
            setSelected((s) => {
              const n = new Set(s);
              if (n.has(th.id)) n.delete(th.id);
              else n.add(th.id);
              return n;
            })
          }
        />
        <button
          type="button"
          className="ib-row-btn"
          data-swipe-body
          aria-current={th.id === openId ? 'true' : undefined}
          onClick={(e) => {
            if (e.shiftKey || e.metaKey) {
              setSelected((s) => new Set(s).add(th.id));
              return;
            }
            open(th.id);
          }}
          onFocus={() => setCursor(i)}
        >
          <ChatRow
            th={th}
            timeLabel={view === 'snoozed' && th.snoozedUntil ? longWhen(th.snoozedUntil, locale) : undefined}
            extra={
              <>
                {th.channel === 'gmail' && <span className="ib-chan-dot" data-ch="gmail" role="img" aria-label="Gmail" />}
                {marker && <span className="ib-tag ib-tag-strong">{marker}</span>}
                {th.scheduledCount > 0 && <span className="ib-tag">{t('list.scheduled', { n: th.scheduledCount })}</span>}
              </>
            }
          />
        </button>
      </li>
    );
  };

  const anyConnected = accounts.some((a) => a.status === 'connected');
  const showInfo = infoOpen && !!openId && detail?.thread.channel === 'whatsapp' && detail.thread.id === openId;

  return (
    <div className={`ib-app gr-inbox${openId ? ' has-open' : ''}${showInfo ? ' has-details' : ''}`} data-chat-style={chatStyle}>
      <div className="ib-list-pane">
        <div className="ib-list-head">
          <div className="ib-list-title">
            <h1 className="ib-h1">{viewTitle}</h1>
            {folder && (
              <span className="ib-row">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFolderEdit(folder)}>
                  {t('folders.edit')}
                </button>
              </span>
            )}
            <button type="button" className="btn btn-ghost btn-sm ib-compose-btn" onClick={() => setCompose(true)} title="C">
              {t('actions.compose')}
            </button>
          </div>
          <div className="ib-search">
            <label className="sr-only" htmlFor="ib-search">
              {t('list.search')}
            </label>
            <input
              id="ib-search"
              ref={searchRef}
              className="input"
              type="search"
              placeholder={t('list.searchPlaceholder')}
              value={q}
              maxLength={200}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setQ('');
                  (e.target as HTMLInputElement).blur();
                }
                if (e.key === 'Enter' || e.key === 'ArrowDown') {
                  e.preventDefault();
                  (e.target as HTMLInputElement).blur();
                  setCursor(0);
                  listRef.current?.querySelector<HTMLElement>('.ib-row-btn')?.focus();
                }
              }}
            />
          </div>
          {tabView && !q && (
            <nav className="ui-tabs ib-tabs" aria-label={t('list.filters')}>
              {TABS.map((v) => (
                <Link key={v} href={viewHref(v)} className={`ui-tab${v === view ? ' is-active' : ''}`} aria-current={v === view ? 'page' : undefined}>
                  {t(`tabs.${v}`)}
                </Link>
              ))}
            </nav>
          )}
          <div className="ib-mobile-views">
            <label className="sr-only" htmlFor="ib-view-select">
              {t('list.goTo')}
            </label>
            <select
              id="ib-view-select"
              className="select"
              value={folder ? `f:${folder.id}` : `v:${view}`}
              onChange={(e) => {
                const [kind, id] = e.target.value.split(':');
                router.push(kind === 'f' ? `/app/inbox/f/${id}` : viewHref(id as InboxView));
              }}
            >
              {(['inbox', 'reply', 'waiting', 'unread', 'whatsapp', 'email', 'groups', 'pinned', 'snoozed', 'scheduled', 'done', 'archived'] as InboxView[]).map((v) => (
                <option key={v} value={`v:${v}`}>
                  {t(`views.${v}`)}
                </option>
              ))}
              {state.folders.map((f) => (
                <option key={f.id} value={`f:${f.id}`}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
          {selected.size > 0 && (
            <div className="ib-bulk" role="toolbar" aria-label={t('list.bulk', { n: selected.size })}>
              <span>{t('list.bulk', { n: selected.size })}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => act('toggleDone')}>
                {view === 'done' ? t('actions.undone') : t('actions.done')}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => act('snooze')}>
                {t('actions.snooze')}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => act('move')}>
                {t('actions.move')}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => act(view === 'archived' ? 'unarchive' : 'archive')}>
                {view === 'archived' ? t('actions.unarchive') : t('actions.archive')}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>
                {t('actions.clear')}
              </button>
            </div>
          )}
        </div>
        {!q && !folder && view !== 'archived' && (state.counts.archived ?? 0) > 0 && (
          <Link href={viewHref('archived')} className="ib-archived-entry" data-testid="inbox-archived-entry">
            <ArchiveIcon size={20} />
            <span>{t('list.archivedEntry')}</span>
            <span className="ib-archived-n">{state.counts.archived}</span>
          </Link>
        )}
        {view === 'archived' && !q && !folder && (
          <Link href={viewHref('inbox')} className="ib-archived-entry" data-testid="inbox-archived-back">
            <ArrowLeft size={20} />
            <span>{t('list.archivedBack')}</span>
          </Link>
        )}
        {listErr && threads.length === 0 ? (
          <div className="ib-list-msg" role="alert">
            <p>{t('errors.list')}</p>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void reloadList()}>
              {t('actions.retry')}
            </button>
          </div>
        ) : loading && threads.length === 0 ? (
          <div className="ib-list-msg" aria-busy="true">
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i} className="ui-skeleton ui-skeleton-row" />
            ))}
          </div>
        ) : threads.length === 0 && !(q.trim() && msgHits.length) ? (
          <div className="ib-list-empty">
            {noAccounts && !q ? (
              <EmptyState
                product="inbox"
                title={t('empty.connectTitle')}
                body={t('empty.connectBody')}
                action={
                  state.available.whatsapp ? (
                    <button type="button" className="btn btn-primary" data-testid="inbox-empty-qr" onClick={() => setQrOpen(true)}>
                      {t('empty.qrAction')}
                    </button>
                  ) : (
                    { label: t('empty.connectAction'), href: '/app/inbox/settings' }
                  )
                }
                secondary={
                  <>
                    {state.available.whatsapp && (
                      <>
                        <Link href="/app/inbox/settings">{t('empty.otherAccounts')}</Link>{' '}
                      </>
                    )}
                    <Link href="/app/inbox/settings#import">{t('empty.importLink')}</Link>
                  </>
                }
              />
            ) : (
              <EmptyState
                product="inbox"
                compact
                title={q ? t('empty.searchTitle') : t(`empty.view.${folder ? 'folder' : view}`)}
                body={q ? t('empty.searchBody') : view === 'inbox' && !folder ? t('empty.zeroBody') : undefined}
              />
            )}
          </div>
        ) : (
          <ul className="ib-list" ref={listRef} aria-label={viewTitle} aria-busy={loading || undefined}>
            {threads.map(rowFor)}
            {q.trim() !== '' && msgHits.length > 0 && (
              <li className="ib-hits" role="presentation">
                <h2 className="ib-hits-h" id="ib-hits-h">
                  {t('list.messagesFound')}
                </h2>
                <ul className="ib-hits-list" aria-labelledby="ib-hits-h">
                  {msgHits.map((h) => (
                    <li key={h.id}>
                      <button type="button" className="ib-hit" onClick={() => openHit(h)} data-testid="inbox-search-hit">
                        <span className="ib-hit-top">
                          <span className="ib-hit-chat">{h.threadTitle}</span>
                          <span className="ib-row-when">{shortWhen(h.sentAt, locale)}</span>
                        </span>
                        <span className="ib-hit-text">
                          <span className="ib-dim">{h.fromMe ? t('list.you') : h.kind === 'group' && h.senderName ? `${h.senderName}: ` : ''} </span>
                          {h.mediaName && !h.snippet.includes(HIT_MARK_START) && <span className="ib-tag">{h.mediaName}</span>}
                          <Highlighted text={h.snippet} />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                {msgMore && (
                  <button type="button" className="btn btn-ghost btn-sm ib-hits-more" onClick={() => void searchMsgs(true)}>
                    {t('list.moreMessages')}
                  </button>
                )}
              </li>
            )}
          </ul>
        )}
        <p className="ib-keys-hint">
          <button type="button" className="ib-link-btn" onClick={() => setHelp(true)}>
            {t('help.hint')}
          </button>
        </p>
      </div>
      <div className="ib-convo-pane">
        {openId && detailErr ? (
          <div className="ib-convo-msg" role="alert">
            <p>{errText(detailErr)}</p>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadDetail(openId)}>
              {t('actions.retry')}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={closeConvo}>
              {t('actions.back')}
            </button>
          </div>
        ) : openId && !detail ? (
          <div className="ib-convo-msg" aria-busy="true">
            <span className="ui-skeleton ui-skeleton-title" />
            <span className="ui-skeleton ui-skeleton-row" />
            <span className="ui-skeleton ui-skeleton-row" />
          </div>
        ) : detail && openId && detail.thread.channel === 'whatsapp' ? (
          <WaConversation
            ref={composer}
            detail={detail}
            folders={state.folders}
            snippets={state.snippets}
            connected={detailAccount?.status === 'connected'}
            threads={threads}
            infoOpen={infoOpen}
            onBack={closeConvo}
            onAction={act}
            onSent={(messages: MessageDto[]) => {
              setDetail((d) => (d ? { ...d, messages } : d));
              void reloadList();
            }}
            onSendLater={(text) => setPlan({ threadId: detail.thread.id, channel: detail.thread.channel, text })}
            onScheduledChange={() => {
              void loadDetail(detail.thread.id, true);
              void reloadState();
              void reloadList();
            }}
            onError={(code) => toast(errText(code), { bad: true })}
            onToast={(text) => toast(text)}
            onToggleInfo={() => setInfoOpen((v) => !v)}
            onRename={async (title) => {
              const r = await api(`/api/inbox/threads/${detail.thread.id}`, { method: 'PATCH', json: { title } });
              if (!r.ok) toast(errText(r.data.error), { bad: true });
              void loadDetail(detail.thread.id, true);
              void reloadList();
            }}
            onRefresh={() => {
              void loadDetail(detail.thread.id, true);
              void reloadList();
            }}
            loadOlder={async () => {
              const first = detail.messages[0];
              if (!first) return;
              const r = await api<{ messages: MessageDto[]; more: boolean }>(`/api/inbox/threads/${detail.thread.id}/messages?before=${encodeURIComponent(first.sentAt)}`);
              if (r.ok) setDetail((d) => (d ? { ...d, messages: [...r.data.messages, ...d.messages], more: r.data.more, extended: true } : d));
            }}
          />
        ) : detail && openId ? (
          <Conversation
            ref={composer}
            detail={detail}
            folders={state.folders}
            snippets={state.snippets}
            connected={detailAccount?.status === 'connected'}
            onBack={closeConvo}
            onAction={act}
            onSent={(messages: MessageDto[]) => {
              setDetail((d) => (d ? { ...d, messages } : d));
              void reloadList();
            }}
            onSendLater={(text) => setPlan({ threadId: detail.thread.id, channel: detail.thread.channel, text })}
            onScheduledChange={() => {
              void loadDetail(detail.thread.id, true);
              void reloadState();
              void reloadList();
            }}
            onRename={async (title) => {
              const r = await api(`/api/inbox/threads/${detail.thread.id}`, { method: 'PATCH', json: { title } });
              if (!r.ok) toast(errText(r.data.error), { bad: true });
              void loadDetail(detail.thread.id, true);
              void reloadList();
            }}
            onError={(code) => toast(errText(code), { bad: true })}
            loadOlder={async () => {
              const first = detail.messages[0];
              if (!first) return;
              const r = await api<{ messages: MessageDto[]; more: boolean }>(`/api/inbox/threads/${detail.thread.id}/messages?before=${encodeURIComponent(first.sentAt)}`);
              if (r.ok) setDetail((d) => (d ? { ...d, messages: [...r.data.messages, ...d.messages], more: r.data.more, extended: true } : d));
            }}
          />
        ) : (
          <div className="ib-convo-blank">
            <p className="ib-dim">{anyConnected ? t('convo.pick') : t('convo.pickNoAccount')}</p>
            <p className="ib-dim ib-keys-inline">
              <span className="kbd">J</span> <span className="kbd">K</span> {t('convo.keysMove')} · <span className="kbd">E</span> {t('convo.keysDone')} · <span className="kbd">H</span> {t('convo.keysSnooze')} · <span className="kbd">?</span>
            </p>
          </div>
        )}
      </div>
      {showInfo && detail && (
        <ContactPanel
          thread={detail.thread}
          wa={detail.wa ?? null}
          onClose={() => setInfoOpen(false)}
          onOpenThread={(id) => {
            setInfoOpen(false);
            open(id);
          }}
          onStartChat={async (phone) => {
            const r = await api<{ thread: ThreadDto }>('/api/inbox/compose', { method: 'POST', json: { channel: 'whatsapp', to: phone } });
            if (!r.ok) {
              toast(errText(r.data.error), { bad: true });
              return;
            }
            setInfoOpen(false);
            setThreads((xs) => [r.data.thread, ...xs.filter((x) => x.id !== r.data.thread.id)]);
            setOpenId(r.data.thread.id);
          }}
          onMute={(until) => void runAction([detail.thread.id], { action: 'mute', until })}
          onError={(code) => toast(errText(code), { bad: true })}
          onToast={(text) => toast(text)}
          onChanged={() => void loadDetail(detail.thread.id, true)}
        />
      )}

      <WhenDialog
        kind={when?.kind ?? null}
        onClose={() => setWhen(null)}
        onPick={async (iso) => {
          const w = when;
          setWhen(null);
          if (!w) return;
          if (w.kind === 'sendLater') {
            const r = await api(`/api/inbox/threads/${w.ids[0]}/messages`, { method: 'POST', json: { body: w.text, sendAt: iso } });
            if (!r.ok) {
              toast(errText(r.data.error), { bad: true });
              return;
            }
            composer.current?.clear();
            toast(t('toast.scheduled', { when: longWhen(iso, locale) }));
            void loadDetail(w.ids[0], true);
            void reloadState();
            void reloadList();
            return;
          }
          await runAction(w.ids, w.kind === 'snooze' ? { action: 'snooze', until: iso } : { action: 'followUp', at: iso });
        }}
      />
      <ScheduleDialog
        target={plan}
        onClose={() => setPlan(null)}
        onDone={(_scheduled, sendAt) => {
          const p = plan;
          setPlan(null);
          if (!p) return;
          composer.current?.clear();
          toast(t('toast.scheduled', { when: longWhen(sendAt, locale) }));
          void loadDetail(p.threadId, true);
          void reloadState();
          void reloadList();
        }}
      />
      <MoveDialog
        open={!!moveIds}
        folders={state.folders}
        current={moveIds && moveIds.length === 1 ? (threads.find((x) => x.id === moveIds[0])?.folderIds ?? detail?.thread.folderIds ?? []) : []}
        onClose={() => setMoveIds(null)}
        onPick={async (folderId, add) => {
          const ids = moveIds ?? [];
          setMoveIds(null);
          await runAction(ids, add ? { action: 'addFolder', folderId } : { action: 'removeFolder', folderId });
        }}
        onNewFolder={() => {
          setMoveIds(null);
          setFolderEdit('new');
        }}
      />
      <MoreDialog
        open={moreOpen}
        thread={detail?.thread ?? current}
        onClose={() => {
          setMoreOpen(false);
          setMoreConfirm(false);
        }}
        startConfirm={moreConfirm}
        onAction={(a) => void moreAction(a)}
      />
      <ComposeDialog
        open={compose}
        accounts={accounts}
        onClose={() => setCompose(false)}
        onCreated={(th) => {
          setCompose(false);
          setThreads((xs) => [th, ...xs.filter((x) => x.id !== th.id)]);
          setCursor(0);
          setOpenId(th.id);
          void reloadState();
        }}
      />
      <HelpDialog open={help} onClose={() => setHelp(false)} />
      <WhatsappQrDialog open={qrOpen} onClose={() => setQrOpen(false)} onLinked={() => void reloadState()} />
      <FolderDialog
        folder={folderEdit === 'new' ? null : folderEdit}
        folders={state.folders}
        open={!!folderEdit}
        onClose={() => setFolderEdit(null)}
        onSaved={(f, deleted) => {
          setFolderEdit(null);
          notifyInboxChanged();
          void reloadState();
          if (deleted) router.push('/app/inbox');
          else if (f && folder && f.id === folder.id) router.refresh();
          else if (f && folderEdit === 'new' && moveIds === null) toast(t('toast.folderCreated', { name: f.name }));
        }}
      />
      <div className="ui-toasts" role="status" aria-live="polite">
        {toasts.map((x) => (
          <div key={x.id} className={`ui-toast${x.bad ? ' ui-toast-bad' : ''} ib-toast`}>
            <span>{x.text}</span>
            {x.undo && (
              <button
                type="button"
                className="ib-link-btn"
                onClick={() => {
                  x.undo?.();
                  lastUndo.current = null;
                  setToasts((xs) => xs.filter((i) => i.id !== x.id));
                }}
              >
                {t('toast.undo')}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
