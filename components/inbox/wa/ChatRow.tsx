'use client';

import { useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { ThreadDto } from '@/lib/inbox/types';
import Avatar from '@/components/groups/wa/Avatar';
import { listTime } from '@/components/groups/wa/format';
import { plainWa } from '@/components/groups/wa/rich';
import { CameraIcon, DocIcon, MapPin, Mic, MusicIcon, MuteIcon, Person, PhotoIcon, PinIcon, PollIcon, Smiley, Ticks } from '@/components/groups/wa/icons';
import { chatName, previewKind, previewText, type PreviewKind } from './util';

const KIND_ICON: Record<Exclude<PreviewKind, ''>, (p: { size?: number }) => ReactNode> = {
  image: PhotoIcon,
  video: CameraIcon,
  voice: Mic,
  audio: MusicIcon,
  document: DocIcon,
  sticker: Smiley,
  location: MapPin,
  contact: Person,
  poll: PollIcon,
};

/** Miniatura de la foto o el video del último mensaje (la que mandó WhatsApp; si no hay, no se ve). */
function RowThumb({ id }: { id: string }) {
  const [off, setOff] = useState(false);
  if (off) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="wa-row-thumb" src={`/api/inbox/media/${id}?thumb=1`} alt="" loading="lazy" onError={() => setOff(true)} />
  );
}

/**
 * Lo de adentro de una fila de la lista, como WhatsApp Web: foto, nombre,
 * hora (verde con no leídos), tildes del último propio, "Ana:" en grupos,
 * ícono del tipo de media, "escribiendo…", silenciado, no leídos y fijado.
 * Las marcas de Inbox (volvió, sin respuesta, programados) van al lado.
 */
export default function ChatRow({ th, extra, timeLabel }: { th: ThreadDto; extra?: ReactNode; timeLabel?: string }) {
  const t = useTranslations('inbox');
  const w = useTranslations('inboxWa');
  const locale = useLocale();
  const name = chatName(th, w('group'));
  const kind = previewKind(th.lastKind, th.preview);
  const text = previewText(th.preview);
  const Icon = kind ? KIND_ICON[kind] : null;
  const unread = th.unread > 0;
  const muted = !!th.mutedUntil;
  const typing = th.presence === 'typing' || th.presence === 'recording';
  return (
    <>
      <Avatar name={name} kind={th.kind === 'group' ? 'group' : 'dm'} src={th.avatar || undefined} seed={th.id} />
      <span className="wa-row-main">
        <span className="wa-row-top">
          <span className="wa-row-name" dir="auto">
            {name}
          </span>
          <span className={`wa-row-time${unread && !muted ? ' is-unread' : ''}`}>{timeLabel ?? listTime(th.lastMessageAt, locale)}</span>
        </span>
        <span className="wa-row-bottom">
          <span className="wa-row-preview" dir="auto">
            {extra}
            {typing ? (
              <span className="wa-row-typing">{w(th.presence === 'recording' ? 'recording' : 'typing')}</span>
            ) : th.draft ? (
              <>
                <span className="wa-row-draft">{t('list.draft')}</span>
                <span className="wa-row-text">{th.draft}</span>
              </>
            ) : (
              <>
                {th.channel === 'whatsapp' && th.lastFromMe && th.lastStatus && <Ticks status={th.lastStatus} label={t(`message.status.${['sent', 'delivered', 'read', 'failed'].includes(th.lastStatus) ? th.lastStatus : 'sent'}`)} />}
                {th.channel === 'gmail' && th.lastFromMe && <span className="wa-row-sender">{t('list.you')}</span>}
                {th.kind === 'group' && !th.lastFromMe && th.lastSender && <span className="wa-row-sender">{th.lastSender}:</span>}
                {(kind === 'image' || kind === 'video') && th.lastMediaId && <RowThumb id={th.lastMediaId} />}
                {Icon && (
                  <span className="wa-row-kind">
                    <Icon size={15} />
                  </span>
                )}
                <span className="wa-row-text">{text ? plainWa(text) : kind ? w(`kind.${kind}`) : ''}</span>
              </>
            )}
          </span>
          <span className="wa-row-icons">
            {muted && <MuteIcon size={16} label={w('muted')} />}
            {unread && (
              <span className={`wa-unread${muted ? ' is-muted' : ''}`} aria-label={w('unread', { n: th.unread })}>
                {th.unread > 999 ? '999+' : th.unread}
              </span>
            )}
            {th.pinned && <PinIcon size={16} label={t('list.pinned')} />}
          </span>
        </span>
      </span>
    </>
  );
}
