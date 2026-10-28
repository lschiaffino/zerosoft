'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { TalkEvent } from '@/lib/talk';
import { HuddleSession, type HuddleView } from './huddle-client';
import { Avatar } from './MessageBody';
import { useTalk } from './talk-context';

type Api = <T>(url: string, init?: RequestInit & { json?: unknown }) => Promise<T>;

export interface HuddleControls {
  view: HuddleView | null;
  join: (channelId: string) => void;
  leave: () => void;
  toggleMute: () => void;
  toggleShare: () => void;
}

/** Un huddle por pestaña (como Slack: entrar a otro sale del actual). */
export function useHuddleManager(api: Api, onError: (code: string) => void): HuddleControls & { onEvents: (events: TalkEvent[]) => void } {
  const session = useRef<HuddleSession | null>(null);
  const [view, setView] = useState<HuddleView | null>(null);

  const join = useCallback(
    (channelId: string) => {
      if (session.current && session.current.view.channelId === channelId && session.current.view.status !== 'error') return;
      void session.current?.leave();
      const s = new HuddleSession(api, channelId, (v) => {
        if (session.current !== s) return;
        if (v.status === 'error') {
          session.current = null;
          setView(null);
          if (v.error) onError(v.error);
          return;
        }
        setView(v);
      });
      session.current = s;
      setView(s.view);
      void s.join();
    },
    [api, onError],
  );

  const leave = useCallback(() => {
    const s = session.current;
    session.current = null;
    setView(null);
    void s?.leave();
  }, []);

  const onEvents = useCallback((events: TalkEvent[]) => {
    const s = session.current;
    if (!s) return;
    for (const e of events) {
      if (e.kind === 'signal') void s.onSignal(e.payload as Parameters<HuddleSession['onSignal']>[0], e.actorId);
      else if (e.kind === 'huddle') s.onHuddleEvent(e.payload as Parameters<HuddleSession['onHuddleEvent']>[0]);
    }
  }, []);

  useEffect(() => {
    const bye = () => session.current?.leaveBeacon();
    window.addEventListener('pagehide', bye);
    return () => {
      window.removeEventListener('pagehide', bye);
      void session.current?.leave();
    };
  }, []);

  return {
    view,
    join,
    leave,
    toggleMute: () => session.current?.setMuted(!session.current.view.muted),
    toggleShare: () => void session.current?.share(),
    onEvents,
  };
}

function ScreenVideo({ stream, label }: { stream: MediaStream; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <figure className="talk-huddle-screen">
      <video ref={ref} autoPlay playsInline muted aria-label={label} />
      <figcaption>{label}</figcaption>
    </figure>
  );
}

/** Barra del huddle en curso (abajo del sidebar): personas, micrófono, pantalla y salir. */
export function HuddleBar() {
  const t = useTranslations('talk');
  const ctx = useTalk();
  const h = ctx.huddle;
  const v = h.view;
  const [expanded, setExpanded] = useState(false);
  const hasScreens = !!v && (v.screens.length > 0 || !!v.localScreen);
  useEffect(() => {
    if (hasScreens) setExpanded(true);
  }, [hasScreens]);
  if (!v) return null;
  const channel = ctx.channelById.get(v.channelId);
  const where = channel ? (channel.kind === 'public' || channel.kind === 'private' ? `#${channel.name}` : ctx.channelTitle(channel)) : '';
  const peers = v.huddle?.peers ?? [];
  const speaking = new Set(v.speaking);
  const others = peers.filter((p) => p.peerId !== v.peerId);
  const connecting = others.some((p) => (v.links[p.peerId] ?? 'new') !== 'connected');
  return (
    <section className="talk-huddle" aria-label={t('huddle.title')} data-testid="talk-huddle">
      <div className="talk-huddle-head">
        <span className="talk-huddle-dot" aria-hidden="true" />
        <button type="button" className="talk-huddle-where" onClick={() => ctx.open({ channelId: v.channelId })}>
          {t('huddle.inChannel', { channel: where })}
        </button>
        {hasScreens && (
          <button type="button" className="btn btn-ghost btn-sm" aria-expanded={expanded} onClick={() => setExpanded((x) => !x)}>
            {expanded ? t('huddle.collapse') : t('huddle.expand')}
          </button>
        )}
      </div>
      <p className="talk-huddle-state" aria-live="polite">
        {v.status === 'joining'
          ? t('huddle.joining')
          : others.length === 0
            ? t('huddle.alone')
            : connecting
              ? t('huddle.connecting')
              : t('huddle.connected', { count: peers.length })}
      </p>
      {v.micMissing && <p className="ui-help">{t('huddle.noMic')}</p>}
      <ul className="talk-huddle-people" aria-label={t('huddle.people')}>
        {peers.map((p) => (
          <li key={p.peerId} className={`talk-huddle-person${speaking.has(p.peerId) ? ' is-speaking' : ''}`} title={ctx.personName(p.userId)}>
            <Avatar id={p.userId} size={26} />
            <span className="sr-only">
              {ctx.personName(p.userId)}
              {p.muted ? `, ${t('huddle.muted')}` : ''}
              {p.sharing ? `, ${t('huddle.sharing')}` : ''}
            </span>
            {p.muted && (
              <span className="talk-huddle-badge" aria-hidden="true">
                ✕
              </span>
            )}
          </li>
        ))}
      </ul>
      <div className="talk-huddle-actions">
        <button type="button" className="btn btn-sm" aria-pressed={v.muted} disabled={v.micMissing} onClick={h.toggleMute}>
          {v.muted ? t('huddle.unmute') : t('huddle.mute')}
        </button>
        {typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia && (
          <button type="button" className="btn btn-sm" aria-pressed={v.sharing} onClick={h.toggleShare}>
            {v.sharing ? t('huddle.stopShare') : t('huddle.share')}
          </button>
        )}
        <button type="button" className="btn btn-sm btn-danger" onClick={h.leave}>
          {t('huddle.leave')}
        </button>
      </div>
      {expanded && hasScreens && (
        <div className="talk-huddle-stage" role="region" aria-label={t('huddle.screens')}>
          {v.localScreen && <ScreenVideo stream={v.localScreen} label={t('huddle.yourScreen')} />}
          {v.screens.map((s) => (
            <ScreenVideo key={s.peerId} stream={s.stream} label={t('huddle.screenOf', { name: ctx.personName(s.userId) })} />
          ))}
        </div>
      )}
    </section>
  );
}

/** Botón del encabezado del canal: empezar, sumarse o salir del huddle. */
export function HuddleButton({ channelId, disabled }: { channelId: string; disabled?: boolean }) {
  const t = useTranslations('talk');
  const ctx = useTalk();
  const live = ctx.boot.huddles?.find((x) => x.channelId === channelId);
  const inThis = ctx.huddle.view?.channelId === channelId;
  if (inThis) {
    return (
      <button type="button" className="btn btn-sm talk-huddle-btn is-live" onClick={ctx.huddle.leave} data-testid="talk-huddle-button">
        {t('huddle.leaveHuddle')}
      </button>
    );
  }
  return (
    <button
      type="button"
      className={`btn btn-ghost btn-sm talk-huddle-btn${live ? ' is-live' : ''}`}
      disabled={disabled}
      onClick={() => ctx.huddle.join(channelId)}
      data-testid="talk-huddle-button"
      title={live ? t('huddle.joinCount', { count: live.userIds.length }) : t('huddle.start')}
    >
      {live ? t('huddle.joinCount', { count: live.userIds.length }) : t('huddle.start')}
    </button>
  );
}
