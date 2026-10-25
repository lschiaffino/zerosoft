'use client';

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { TalkChannelDto, TalkMessageDto } from '@/lib/talk';
import { dayKey } from '@/lib/talk-time';
import { talkPlainText } from '@/lib/talk-markdown';
import Composer, { errorText } from './Composer';
import Message, { fmtFull } from './Message';
import { draftKey, useTalk, type TalkBusEvent } from './talk-context';

const GROUP_MS = 5 * 60_000;

export function dayLabel(iso: string, locale: string, t: (k: string) => string): string {
  const key = dayKey(iso);
  const now = new Date();
  if (key === dayKey(now.toISOString())) return t('time.today');
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (key === dayKey(y.toISOString())) return t('time.yesterday');
  return new Date(iso).toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric', year: new Date(iso).getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

export function isGrouped(prev: TalkMessageDto | undefined, m: TalkMessageDto): boolean {
  if (!prev || prev.deleted || m.deleted) return false;
  if (prev.userId !== m.userId || prev.botName !== m.botName) return false;
  if (dayKey(prev.createdAt) !== dayKey(m.createdAt)) return false;
  if (!!m.parentId !== !!prev.parentId) return false;
  return new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_MS;
}

/** Inserta o reemplaza por id, en orden cronológico. */
export function upsertSorted(list: TalkMessageDto[], items: TalkMessageDto[]): TalkMessageDto[] {
  const map = new Map(list.map((m) => [m.id, m]));
  for (const it of items) map.set(it.id, it);
  return [...map.values()].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}

export function TypingLine({ channelId, parentId }: { channelId: string; parentId: string | null }) {
  const t = useTranslations('talk');
  const { typing, personName, boot } = useTalk();
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const now = Date.now();
  const who = [...(typing.get(`${channelId}|${parentId ?? ''}`)?.entries() ?? [])].filter(([u, until]) => until > now && u !== boot.me).map(([u]) => personName(u));
  return (
    <p className="talk-typing" aria-live="polite">
      {who.length === 1 ? t('typing.one', { name: who[0] }) : who.length === 2 ? t('typing.two', { a: who[0], b: who[1] }) : who.length > 2 ? t('typing.many') : ''}
    </p>
  );
}

interface Props {
  channel: TalkChannelDto;
  highlightId: string | null;
  onBack: () => void;
}

export default function ChannelPane({ channel, highlightId, onBack }: Props) {
  const t = useTranslations('talk');
  const ctx = useTalk();
  const { api, locale, toast, dialog, channelTitle, openThread, subscribe, drafts, setDraft, refreshBoot } = ctx;
  const [messages, setMessages] = useState<TalkMessageDto[]>([]);
  const [hasMoreBefore, setHasMoreBefore] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [editing, setEditing] = useState<string | null>(null);
  const [newSince, setNewSince] = useState<string | null>(channel.unread ? channel.lastReadAt : null);
  const [pinsOpen, setPinsOpen] = useState(false);
  const [pins, setPins] = useState<TalkMessageDto[] | null>(null);
  const manualUnread = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const loadingOlder = useRef(false);
  const readTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMember = channel.isMember;
  const title = channel.kind === 'public' || channel.kind === 'private' ? channel.name : channelTitle(channel);

  const markRead = useCallback(
    (at?: string) => {
      if (!isMember) return;
      if (readTimer.current) clearTimeout(readTimer.current);
      readTimer.current = setTimeout(() => {
        // El sidebar se actualiza con el evento "read" del tiempo real (sin pedir todo).
        void api(`/api/talk/channels/${channel.id}/read`, { method: 'POST', json: at ? { at } : {} }).catch(() => undefined);
      }, 400);
    },
    [api, channel.id, isMember],
  );

  const load = useCallback(async () => {
    setState('loading');
    try {
      const q = highlightId ? `?around=${encodeURIComponent(highlightId)}` : '';
      const res = await api<{ messages: TalkMessageDto[]; hasMoreBefore: boolean }>(`/api/talk/channels/${channel.id}/messages${q}`);
      setMessages(res.messages);
      setHasMoreBefore(res.hasMoreBefore);
      setState('ready');
      stick.current = !highlightId;
      if (!manualUnread.current) markRead();
    } catch {
      setState('error');
    }
  }, [api, channel.id, highlightId, markRead]);

  useEffect(() => {
    manualUnread.current = false;
    setNewSince(channel.unread ? channel.lastReadAt : null);
    setEditing(null);
    setPinsOpen(false);
    void load();
    // Solo al cambiar de canal o de mensaje destacado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id, highlightId]);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, state]);

  async function loadOlder() {
    if (loadingOlder.current || !hasMoreBefore || !messages.length) return;
    loadingOlder.current = true;
    const el = listRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    try {
      const res = await api<{ messages: TalkMessageDto[]; hasMoreBefore: boolean }>(
        `/api/talk/channels/${channel.id}/messages?before=${encodeURIComponent(messages[0].createdAt)}`,
      );
      stick.current = false;
      setMessages((prev) => upsertSorted(prev, res.messages));
      setHasMoreBefore(res.hasMoreBefore);
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - prevHeight + el.scrollTop;
      });
    } finally {
      loadingOlder.current = false;
    }
  }

  // Tiempo real: pistas del feed → se piden los mensajes que cambiaron.
  useEffect(() => {
    return subscribe((e: TalkBusEvent) => {
      if (e.type === 'patch') {
        const m = e.message;
        if (m.channelId !== channel.id) return;
        if (!m.parentId || m.alsoInChannel) setMessages((prev) => (prev.some((x) => x.id === m.id) ? upsertSorted(prev, [m]) : prev));
        return;
      }
      if (e.type === 'remove') {
        setMessages((prev) => prev.filter((x) => x.id !== e.id));
        return;
      }
      const ids = new Set<string>();
      const removed = new Set<string>();
      const quick: TalkMessageDto[] = [];
      let fromOthers = false;
      for (const ev of e.events) {
        if (ev.channelId !== channel.id) continue;
        if (ev.kind === 'message' || ev.kind === 'reaction') {
          const p = ev.payload as { id: string; parentId?: string | null; change?: string; alsoInChannel?: boolean; message?: LiteMessage };
          // Mensaje nuevo de otra persona: se pinta ya con lo que trae el evento (sin archivos ni tarjetas, que llegan en el refresco).
          if (p.change === 'new' && p.message && ev.actorId !== ctx.boot.me && (!p.parentId || p.alsoInChannel) && !p.message.hasFiles) quick.push(liteToDto(p.message));
          if (p.change === 'deleted') removed.add(p.id);
          if (!p.parentId || p.alsoInChannel) ids.add(p.id);
          if (p.parentId) ids.add(p.parentId);
          if (p.change === 'new' && ev.actorId !== ctx.boot.me && (!p.parentId || p.alsoInChannel)) fromOthers = true;
        }
      }
      if (!ids.size && !removed.size) return;
      if (quick.length) {
        const el = listRef.current;
        stick.current = !!el && el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        setMessages((prev) => upsertSorted(prev, quick.filter((q) => !prev.some((m) => m.id === q.id))));
      }
      void api<{ messages: TalkMessageDto[] }>(`/api/talk/messages?ids=${[...ids].join(',')}`)
        .then((res) => {
          const el = listRef.current;
          stick.current = !!el && el.scrollHeight - el.scrollTop - el.clientHeight < 120;
          setMessages((prev) => {
            const got = new Set(res.messages.map((m) => m.id));
            const kept = prev.filter((m) => !(removed.has(m.id) && !got.has(m.id)));
            const visible = res.messages.filter((m) => (!m.parentId || m.alsoInChannel) && (m.deleted ? m.replyCount > 0 : true));
            // Solo se agregan los nuevos (los de arriba de la página cargada ya están).
            return upsertSorted(
              kept,
              visible.filter((m) => kept.some((k) => k.id === m.id) || !kept.length || m.createdAt >= kept[0].createdAt),
            ).filter((m) => !(m.deleted && m.replyCount === 0));
          });
          if (fromOthers && document.visibilityState === 'visible' && document.hasFocus() && !manualUnread.current) markRead();
        })
        .catch(() => undefined);
    });
  }, [subscribe, channel.id, api, ctx.boot.me, markRead]);

  function onSent(m: TalkMessageDto) {
    stick.current = true;
    setNewSince(null);
    manualUnread.current = false;
    setMessages((prev) => upsertSorted(prev, [m]));
  }

  function editLast() {
    const own = [...messages].reverse().find((m) => m.userId === ctx.boot.me && !m.deleted && !m.parentId);
    if (own) setEditing(own.id);
  }

  function markUnread(m: TalkMessageDto) {
    manualUnread.current = true;
    const at = new Date(new Date(m.createdAt).getTime() - 1).toISOString();
    setNewSince(at);
    void api(`/api/talk/channels/${channel.id}/read`, { method: 'POST', json: { at } })
      .then(() => {
        refreshBoot();
        toast(t('message.markedUnread'));
      })
      .catch((err) => toast(errorText(t, err), 'error'));
  }

  // Esc marca leído (como en Slack) y saca la línea de "Nuevos".
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('dialog[open]')) return;
      manualUnread.current = false;
      setNewSince(null);
      markRead();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [markRead]);

  async function join() {
    try {
      await api(`/api/talk/channels/${channel.id}/members`, { method: 'POST', json: { join: true } });
      refreshBoot();
    } catch (err) {
      toast(errorText(t, err), 'error');
    }
  }

  async function toggleStar() {
    try {
      await api(`/api/talk/channels/${channel.id}`, { method: 'PATCH', json: { starred: !channel.starred } });
      refreshBoot();
    } catch (err) {
      toast(errorText(t, err), 'error');
    }
  }

  async function openPins() {
    setPinsOpen((v) => !v);
    try {
      const res = await api<{ messages: TalkMessageDto[] }>(`/api/talk/channels/${channel.id}/pins`);
      setPins(res.messages);
    } catch {
      setPins([]);
    }
  }

  const firstNewIndex = newSince ? messages.findIndex((m) => m.createdAt > newSince && m.userId !== ctx.boot.me) : -1;
  const isChannel = channel.kind === 'public' || channel.kind === 'private';

  return (
    <section className="talk-pane talk-channel" aria-label={title}>
      <header className="talk-head">
        <button type="button" className="btn btn-ghost btn-sm talk-back" onClick={onBack} aria-label={t('nav.back')}>
          ←
        </button>
        <div className="talk-head-main">
          <h1 className="talk-head-title">
            {isChannel ? (
              <>
                <span className="talk-hash" aria-hidden="true">
                  {channel.kind === 'private' ? '🔒' : '#'}
                </span>
                {channel.name}
              </>
            ) : (
              title
            )}
            {channel.archived && <span className="badge badge-outline">{t('channel.archived')}</span>}
          </h1>
          {channel.kind === 'dm' ? (
            <DmStatus channel={channel} />
          ) : channel.topic ? (
            <button type="button" className="talk-head-topic" onClick={() => dialog({ kind: 'details', channelId: channel.id, tab: 'about' })} title={channel.topic}>
              {channel.topic}
            </button>
          ) : (
            isChannel &&
            isMember &&
            !channel.archived && (
              <button type="button" className="talk-head-topic is-empty" onClick={() => dialog({ kind: 'details', channelId: channel.id, tab: 'about' })}>
                {t('channel.addTopic')}
              </button>
            )
          )}
        </div>
        <div className="talk-head-actions">
          {isMember && (
            <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-pressed={channel.starred} aria-label={channel.starred ? t('channel.unstar') : t('channel.star')} title={channel.starred ? t('channel.unstar') : t('channel.star')} onClick={() => void toggleStar()}>
              {channel.starred ? '★' : '☆'}
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" aria-expanded={pinsOpen} onClick={() => void openPins()}>
            {t('channel.pins')}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => dialog({ kind: 'details', channelId: channel.id, tab: 'members' })} aria-label={t('channel.membersCount', { count: channel.memberCount })}>
            {t('channel.membersShort', { count: channel.memberCount })}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => dialog({ kind: 'details', channelId: channel.id })}>
            {t('channel.details')}
          </button>
        </div>
      </header>
      {pinsOpen && (
        <div className="talk-pins" role="region" aria-label={t('channel.pins')}>
          {pins === null ? (
            <p className="talk-muted">{t('common.loading')}</p>
          ) : pins.length === 0 ? (
            <p className="talk-muted">{t('channel.noPins')}</p>
          ) : (
            <ul>
              {pins.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="talk-pin-item"
                    onClick={() => {
                      setPinsOpen(false);
                      if (p.parentId) openThread(p.parentId);
                      else ctx.open({ channelId: channel.id, messageId: p.id });
                    }}
                  >
                    <span className="talk-pin-author">{ctx.personName(p.userId) || p.botName}</span>
                    <span className="talk-pin-text">{talkPlainText(p.body, { user: (u) => ctx.personName(u), channel: (c) => ctx.channelById.get(c)?.name }).slice(0, 140)}</span>
                    <span className="talk-muted">{fmtFull(p.createdAt, locale)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div
        className="talk-scroll"
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          if (el.scrollTop < 120) void loadOlder();
        }}
      >
        {state === 'loading' && (
          <div className="ui-loading-stack talk-loading" aria-busy="true" aria-label={t('common.loading')}>
            <div className="ui-skeleton ui-skeleton-row" />
            <div className="ui-skeleton ui-skeleton-row" />
            <div className="ui-skeleton ui-skeleton-row" />
          </div>
        )}
        {state === 'error' && (
          <div className="talk-error" role="alert">
            <p>{t('errors.loadMessages')}</p>
            <button type="button" className="btn btn-sm" onClick={() => void load()}>
              {t('common.retry')}
            </button>
          </div>
        )}
        {state === 'ready' && !hasMoreBefore && (
          <div className="talk-intro">
            <h2 className="talk-intro-title">
              {isChannel ? t('channel.introTitle', { name: channel.name }) : t('channel.introDm', { name: title })}
            </h2>
            <p className="talk-muted">{isChannel ? channel.description || t('channel.introBody') : t('channel.introDmBody')}</p>
            {isChannel && isMember && !channel.archived && (
              <button type="button" className="btn btn-sm" onClick={() => dialog({ kind: 'details', channelId: channel.id, tab: 'members' })}>
                {t('channel.addPeople')}
              </button>
            )}
          </div>
        )}
        {state === 'ready' &&
          messages.map((m, i) => {
            const prev = messages[i - 1];
            const newDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
            return (
              <Fragment key={m.id}>
                {newDay && (
                  <div className="talk-day" role="separator">
                    <span>{dayLabel(m.createdAt, locale, t)}</span>
                  </div>
                )}
                {i === firstNewIndex && (
                  <div className="talk-new-line" role="separator">
                    <span>{t('channel.new')}</span>
                  </div>
                )}
                <Message
                  message={m}
                  channel={channel}
                  grouped={!newDay && i !== firstNewIndex && isGrouped(prev, m)}
                  highlighted={m.id === highlightId}
                  editing={editing === m.id}
                  onEdit={setEditing}
                  onMarkUnread={markUnread}
                />
              </Fragment>
            );
          })}
      </div>
      <TypingLine channelId={channel.id} parentId={null} />
      {channel.archived ? (
        <div className="talk-banner">{t('channel.archivedBanner')}</div>
      ) : channel.deactivated ? (
        <div className="talk-banner">{t('channel.deactivated', { name: title })}</div>
      ) : isMember ? (
        <Composer
          key={channel.id}
          channel={channel}
          parentId={null}
          focusKey={channel.id}
          initialDraft={drafts.get(draftKey(channel.id, null)) ?? ''}
          onDraftChange={(b) => setDraft(channel.id, null, b)}
          onSent={onSent}
          onEditLast={editLast}
        />
      ) : (
        <div className="talk-banner talk-join">
          <p>{t('channel.previewing', { name: channel.name })}</p>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void join()}>
            {t('channel.join')}
          </button>
        </div>
      )}
    </section>
  );
}

/** Encabezado de un DM: estado y presencia de la otra persona (no hay tema que agregar). */
function DmStatus({ channel }: { channel: TalkChannelDto }) {
  const t = useTranslations('talk');
  const { presence, boot } = useTalk();
  const other = channel.memberIds[0] ?? boot.me;
  if (channel.deactivated) return <span className="talk-head-topic is-static">{t('channel.deactivatedShort')}</span>;
  const p = presence.get(other);
  const state = p?.away ? t('status.away') : p?.active ? t('status.active') : t('status.away');
  return (
    <span className="talk-head-topic is-static">
      <span className={`talk-dot-inline${p?.active ? ' is-active' : ''}`} aria-hidden="true" />
      {state}
      {p?.statusEmoji || p?.statusText ? ` · ${p.statusEmoji ?? ''} ${p.statusText ?? ''}`.trimEnd() : ''}
    </span>
  );
}

interface LiteMessage {
  id: string;
  channelId: string;
  parentId: string | null;
  userId: string | null;
  botName: string | null;
  body: string;
  alsoInChannel: boolean;
  createdAt: string;
  hasFiles: boolean;
}

/** El mensaje del evento como DTO provisorio (el refresco trae reacciones, tarjetas y guardado). */
function liteToDto(m: LiteMessage): TalkMessageDto {
  return {
    id: m.id,
    channelId: m.channelId,
    parentId: m.parentId,
    userId: m.userId,
    botName: m.botName,
    body: m.body,
    files: [],
    unfurls: [],
    reactions: [],
    replyCount: 0,
    replyUsers: [],
    lastReplyAt: null,
    alsoInChannel: m.alsoInChannel,
    editedAt: null,
    deleted: false,
    pinned: false,
    saved: false,
    createdAt: m.createdAt,
    refs: [],
  };
}
