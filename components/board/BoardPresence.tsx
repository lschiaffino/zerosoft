'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { peerName, type Peer } from '@/lib/board-collab';
import type { RealtimeStatus } from '@/lib/realtime-client';
import NotesIcon from '@/components/notes/NotesIcon';
import { usePopover } from '@/components/notes/usePopover';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}

/** Color estable por persona (tonos de los tokens de la marca, sin pills). */
function hue(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 360;
  return h;
}

/**
 * Quién está en la pizarra ahora: avatares en la barra y, al abrirlos, la
 * lista con "seguir" por persona y "traer a todos a mi vista". También dice
 * si el tiempo real está conectado.
 */
export default function BoardPresence({
  people,
  status,
  canSummon,
  following,
  onFollow,
  onStopFollowing,
  onSummon,
}: {
  people: Peer[];
  status: RealtimeStatus;
  canSummon: boolean;
  following: { socketId: string; name: string } | null;
  onFollow: (p: Peer) => void;
  onStopFollowing: () => void;
  onSummon: () => Promise<boolean>;
}) {
  const t = useTranslations('board.live');
  const pop = usePopover();
  const [summoned, setSummoned] = useState<'ok' | 'error' | null>(null);
  const guest = t('guest');
  const offline = status === 'offline';
  const shown = people.slice(0, 3);
  const label = people.length ? t('here', { count: people.length }) : t('alone');
  return (
    <div className={`board-share-wrap board-presence${people.length === 0 ? ' is-alone' : ''}`} ref={pop.wrapRef}>
      <button
        ref={pop.buttonRef}
        type="button"
        className={`btn btn-sm board-presence-btn${offline ? ' is-offline' : ''}`}
        onClick={() => {
          setSummoned(null);
          pop.toggle();
        }}
        aria-expanded={pop.open}
        aria-haspopup="dialog"
        aria-label={`${label}${offline ? ` · ${t('offline')}` : ''}`}
        title={offline ? t('offline') : label}
        data-testid="board-presence"
      >
        {shown.length === 0 ? (
          <NotesIcon name="users" size={14} />
        ) : (
          <span className="board-avatars" aria-hidden="true">
            {shown.map((p) => {
              const name = peerName(p, guest);
              return (
                <span key={p.socketId} className={`board-avatar${p.idle ? ' is-idle' : ''}`} style={{ ['--avatar-h' as string]: hue(p.user?.id ?? p.socketId) }}>
                  {initials(name)}
                </span>
              );
            })}
            {people.length > shown.length && <span className="board-avatar is-more">+{people.length - shown.length}</span>}
          </span>
        )}
        <span className={`board-live-dot${status === 'live' || status === 'polling' ? ' is-on' : ''}`} aria-hidden="true" />
      </button>
      {pop.open && (
        <div className="board-pop board-presence-pop" role="dialog" aria-label={t('title')}>
          <p className="board-pop-title">{t('title')}</p>
          <p className="board-pop-hint" role="status">
            {offline ? t('offline') : status === 'connecting' ? t('connecting') : people.length ? label : t('aloneHint')}
          </p>
          {people.length > 0 && (
            <ul className="board-presence-list">
              {people.map((p) => {
                const name = peerName(p, guest);
                const isFollowed = following?.socketId === p.socketId;
                return (
                  <li key={p.socketId} className="board-presence-item">
                    <span className={`board-avatar${p.idle ? ' is-idle' : ''}`} style={{ ['--avatar-h' as string]: hue(p.user?.id ?? p.socketId) }} aria-hidden="true">
                      {initials(name)}
                    </span>
                    <span className="board-presence-name">
                      {name}
                      {p.idle && <span className="board-presence-meta"> · {t('away')}</span>}
                    </span>
                    <button
                      type="button"
                      className={`btn btn-sm${isFollowed ? ' is-on' : ''}`}
                      aria-pressed={isFollowed}
                      onClick={() => {
                        if (isFollowed) onStopFollowing();
                        else onFollow(p);
                        pop.close();
                      }}
                    >
                      {isFollowed ? t('unfollow') : t('follow')}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {canSummon && people.length > 0 && (
            <button
              type="button"
              className="btn btn-sm btn-primary board-summon"
              onClick={async () => setSummoned((await onSummon()) ? 'ok' : 'error')}
            >
              {t('summon')}
            </button>
          )}
          {summoned === 'ok' && (
            <p className="board-pop-hint" role="status">
              {t('summoned')}
            </p>
          )}
          {summoned === 'error' && (
            <p className="ui-error" role="alert">
              {t('summonError')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
