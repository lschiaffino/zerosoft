'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { ThreadDto, WaDetailsDto } from '@/lib/inbox/types';
import Avatar from '@/components/groups/wa/Avatar';
import RichText from '@/components/groups/wa/RichText';
import MediaViewer, { type ViewerItem } from '@/components/groups/wa/MediaViewer';
import { ArchiveIcon, Ban, Close, DocIcon, MuteIcon, Sparkle } from '@/components/groups/wa/icons';
import { fileSize, posterFrame } from '@/components/groups/wa/format';
import { api, longWhen } from '../api';
import { chatName, formatPhone } from './util';
import PhoneCopy from '@/components/groups/wa/PhoneCopy';
import { useInboxPersonSheet } from './person-sheet';
import InboxHubspotCard from './InboxHubspotCard';
import { GroupDescriptionEdit, GroupNameEdit } from './GroupInfoEdit';
import GroupMembers, { type GroupMember } from '@/components/groups/wa/GroupMembers';
import type { ParticipantDto } from '@/lib/inbox/types';
import type { MemberTargetResult } from '@/lib/wa-group-members';
import type { NewChatEntry } from '@/lib/wa-new-chat';

const toMember = (p: ParticipantDto): GroupMember => ({ phone: p.phone, name: p.name, role: p.role, picture: p.avatar, me: p.me });

type SharedKind = 'media' | 'docs' | 'links' | 'starred';

interface SharedItem {
  id: string;
  mediaType: string;
  mediaName: string;
  body: string;
  sentAt: string;
  fromMe: boolean;
  senderName: string;
  senderHandle: string;
  size?: number;
  urls?: string[];
}

interface Summary {
  text: string;
  at: string | null;
  stale: boolean;
}

/**
 * Info del contacto o del grupo, como el panel de WhatsApp Web: foto
 * grande, nombre, número o integrantes, "info" o descripción, resumen con
 * IA, lo compartido (fotos, documentos, links), destacados, grupos en común
 * o participantes con sus admins, silenciar y bloquear.
 */
export default function ContactPanel({
  thread,
  wa,
  onClose,
  onOpenThread,
  onStartChat,
  onMute,
  onKeepArchived,
  onError,
  onToast,
  onChanged,
  onJumpToMessage,
  starredKey = '',
}: {
  /** Un destacado lleva a su mensaje en la conversación. */
  onJumpToMessage?: (id: string) => void;
  /** Cambia cuando cambian los destacados de la conversación: la lista se vuelve a leer. */
  starredKey?: string;
  thread: ThreadDto;
  wa: WaDetailsDto | null;
  onClose: () => void;
  onOpenThread: (id: string) => void;
  onStartChat: (phone: string) => void | Promise<void>;
  onMute: (until: string | null) => void;
  /** "Mantener archivado" (prenderlo archiva el chat). */
  onKeepArchived?: (on: boolean) => void;
  onError: (code: string) => void;
  onToast: (text: string) => void;
  onChanged: () => void;
}) {
  const w = useTranslations('inboxWa');
  const locale = useLocale();
  const group = thread.kind === 'group';
  const name = chatName(thread, w('group'));
  // Nombre y descripción del grupo con su lápiz (se cambian en WhatsApp).
  const editable = group && thread.channel === 'whatsapp';
  const [tab, setTab] = useState<SharedKind>('media');
  const [shared, setShared] = useState<Record<string, SharedItem[] | null>>({});
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [viewerAt, setViewerAt] = useState<string | null>(null);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [muteOpen, setMuteOpen] = useState(false);
  // Un participante abre su ficha (como en WhatsApp), con Mensaje para ir a su chat 1:1.
  const personSheet = useInboxPersonSheet(thread.id, { onOpenThread, onStartChat: async (phone) => onStartChat(phone), onError, onToast });

  const load = useCallback(
    async (kind: SharedKind) => {
      setShared((s) => ({ ...s, [kind]: s[kind] ?? null }));
      const r = await api<{ items: SharedItem[] }>(`/api/inbox/threads/${thread.id}/wa?kind=${kind}`);
      setShared((s) => ({ ...s, [kind]: r.ok ? r.data.items : [] }));
    },
    [thread.id],
  );

  useEffect(() => {
    setShared({});
    setSummary(null);
    setConfirmBlock(false);
    void load('media');
    void load('starred');
    void api<{ summary: Summary }>(`/api/inbox/threads/${thread.id}/wa?part=summary`).then((r) => r.ok && setSummary(r.data.summary));
  }, [thread.id, load]);

  useEffect(() => {
    if (shared[tab] === undefined) void load(tab);
  }, [tab, shared, load]);

  // Se destacó o se sacó un destacado en la conversación: la lista se vuelve a leer (la primera vez la lee la de arriba).
  const starredSeen = useRef(starredKey);
  useEffect(() => {
    if (starredSeen.current === starredKey) return;
    starredSeen.current = starredKey;
    void load('starred');
  }, [starredKey, load]);

  const summarize = async () => {
    setSummaryBusy(true);
    const r = await api<{ summary: Summary }>(`/api/inbox/threads/${thread.id}/wa`, { method: 'POST', json: { action: 'summary' } });
    setSummaryBusy(false);
    if (!r.ok) onError(r.data.error ?? 'ai_failed');
    else setSummary(r.data.summary);
  };

  const block = async (on: boolean) => {
    setConfirmBlock(false);
    const r = await api(`/api/inbox/threads/${thread.id}/wa`, { method: 'POST', json: { action: on ? 'block' : 'unblock' } });
    if (!r.ok) onError(r.data.error ?? 'generic');
    else {
      onToast(on ? w('blocked', { name }) : w('unblocked', { name }));
      onChanged();
    }
  };

  const media = shared.media ?? null;
  const viewerItems: ViewerItem[] = useMemo(
    () =>
      (media ?? [])
        .filter((m) => m.mediaType === 'image' || m.mediaType === 'video')
        .map((m) => ({
          id: m.id,
          url: `/api/inbox/media/${m.id}`,
          type: m.mediaType === 'video' ? 'video/mp4' : 'image/jpeg',
          name: m.mediaName,
          caption: m.body,
          author: m.fromMe ? w('you') : m.senderName || formatPhone(m.senderHandle) || name,
          createdAt: m.sentAt,
        })),
    [media, name, w],
  );
  const viewerIndex = viewerAt ? viewerItems.findIndex((v) => v.id === viewerAt) : -1;
  // Los participantes del panel de miembros (se corrigen con lo que devuelve WhatsApp al agregar o quitar).
  const [members, setMembers] = useState<GroupMember[]>([]);
  const participantsKey = (wa?.participants ?? []).map((p) => `${p.phone}:${p.role}:${p.name}`).join(',');
  useEffect(() => {
    setMembers((wa?.participants ?? []).map(toMember));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participantsKey]);
  const muted = !!thread.mutedUntil;
  const starred = shared.starred ?? null;
  const list = shared[tab] ?? null;

  return (
    <aside className="ib-wa-details" aria-label={group ? w('groupInfo') : w('contactInfo')}>
      <header className="ib-wa-details-bar">
        <button type="button" className="wa-icon-btn" onClick={onClose} aria-label={w('close')} title={w('close')}>
          <Close size={22} />
        </button>
        <h2>{group ? w('groupInfo') : w('contactInfo')}</h2>
      </header>
      <div className="ib-wa-details-body">
        <section className="ib-wa-card ib-wa-hero">
          <button type="button" className="ib-wa-hero-photo" onClick={() => thread.avatar && setPhotoOpen(true)} aria-label={w('viewPhoto')} disabled={!thread.avatar}>
            <Avatar name={name} kind={group ? 'group' : 'dm'} src={thread.avatar || undefined} seed={thread.id} size={176} />
          </button>
          {editable ? (
            <GroupNameEdit threadId={thread.id} value={name} onSaved={onChanged} onToast={onToast} onError={onError} />
          ) : (
            <p className="ib-wa-hero-name" dir="auto">
              {name}
            </p>
          )}
          <p className="ib-wa-hero-sub">
            {group ? (
              wa?.size || wa?.participants.length ? w('groupMembers', { n: wa?.size || wa?.participants.length || 0 }) : w('group')
            ) : (
              // El teléfono, aunque el chat esté guardado por lid (lo resuelve el servidor); un toque lo copia.
              <PhoneCopy phone={wa?.phone || thread.handle} copyLabel={w('copyPhone')} onCopied={() => onToast(w('phoneCopied'))} />
            )}
            {!group && wa?.isBusiness && <span className="ib-wa-badge">{w('business')}</span>}
          </p>
        </section>

        {(wa?.about || group) && (
          <section className="ib-wa-card">
            <h3 className="ib-wa-card-title">{group ? w('description') : w('about')}</h3>
            {editable ? (
              <GroupDescriptionEdit threadId={thread.id} value={wa?.about ?? ''} onSaved={onChanged} onToast={onToast} onError={onError} />
            ) : wa?.about ? (
              <p className="ib-wa-about" dir="auto">
                <RichText text={wa.about} />
              </p>
            ) : (
              <p className="ib-wa-muted">{w('noDescription')}</p>
            )}
            {group && wa?.createdAt && <p className="ib-wa-muted">{w('createdOn', { date: new Date(wa.createdAt).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' }) })}</p>}
          </section>
        )}

        {!group && thread.channel === 'whatsapp' && <InboxHubspotCard threadId={thread.id} />}

        <section className="ib-wa-card ib-wa-summary" aria-busy={summaryBusy || undefined}>
          <h3 className="ib-wa-card-title">
            <Sparkle size={16} /> {group ? w('summaryGroup') : w('summaryContact')}
          </h3>
          {summary?.text ? (
            <>
              <p className="ib-wa-summary-text" dir="auto">
                {summary.text}
              </p>
              <p className="ib-wa-muted">
                {summary.at && w('summaryAt', { when: longWhen(summary.at, locale) })}
                {summary.stale && ` · ${w('summaryStale')}`}
              </p>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void summarize()} disabled={summaryBusy}>
                {summaryBusy ? w('summarizing') : w('summaryRefresh')}
              </button>
            </>
          ) : (
            <>
              <p className="ib-wa-muted">{w('summaryHint')}</p>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void summarize()} disabled={summaryBusy}>
                {summaryBusy ? w('summarizing') : w('summarize')}
              </button>
            </>
          )}
        </section>

        <section className="ib-wa-card">
          <div className="ib-wa-tabs" role="tablist" aria-label={w('shared')}>
            {(['media', 'docs', 'links'] as const).map((k) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'is-on' : ''} onClick={() => setTab(k)}>
                {w(`sharedTabs.${k}`)}
              </button>
            ))}
          </div>
          {list === null ? (
            <div className="ib-wa-grid" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <span key={i} className="ui-skeleton ib-wa-thumb" />
              ))}
            </div>
          ) : list.length === 0 ? (
            <p className="ib-wa-muted">{w(`sharedEmpty.${tab === 'starred' ? 'media' : tab}`)}</p>
          ) : tab === 'media' ? (
            <ul className="ib-wa-grid">
              {list.slice(0, 60).map((m) => (
                <li key={m.id}>
                  <button type="button" className="ib-wa-thumb" onClick={() => setViewerAt(m.id)} aria-label={m.body || m.mediaName || w(`kind.${m.mediaType === 'video' ? 'video' : 'image'}`)}>
                    {m.mediaType === 'video' ? (
                      <video src={posterFrame(`/api/inbox/media/${m.id}`)} muted preload="metadata" tabIndex={-1} aria-hidden="true" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/inbox/media/${m.id}`} alt="" loading="lazy" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          ) : tab === 'docs' ? (
            <ul className="ib-wa-rows">
              {list.map((m) => (
                <li key={m.id}>
                  <a className="ib-wa-row" href={`/api/inbox/media/${m.id}`} download>
                    <DocIcon size={22} />
                    <span className="ib-wa-row-main">
                      <span className="ib-wa-row-name">{m.mediaName || w('kind.document')}</span>
                      <span className="ib-wa-muted">
                        {[m.size ? fileSize(m.size, locale) : '', longWhen(m.sentAt, locale)].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="ib-wa-rows">
              {list.flatMap((m) =>
                (m.urls ?? []).map((u, i) => (
                  <li key={`${m.id}-${i}`}>
                    <a className="ib-wa-row" href={u} target="_blank" rel="noopener noreferrer nofollow">
                      <span className="ib-wa-row-main">
                        <span className="ib-wa-row-name ib-wa-link">{u.replace(/^https?:\/\//, '')}</span>
                        <span className="ib-wa-muted">{longWhen(m.sentAt, locale)}</span>
                      </span>
                    </a>
                  </li>
                )),
              )}
            </ul>
          )}
        </section>

        <section className="ib-wa-card">
          <h3 className="ib-wa-card-title">{w('starredMessages')}</h3>
          {starred === null ? (
            <span className="ui-skeleton ui-skeleton-row" />
          ) : starred.length === 0 ? (
            <p className="ib-wa-muted">{w('noStarred')}</p>
          ) : (
            <ul className="ib-wa-rows">
              {starred.slice(0, 20).map((m) => (
                <li key={m.id}>
                  <button type="button" className="ib-wa-starred" data-testid="chat-starred-item" onClick={() => onJumpToMessage?.(m.id)} disabled={!onJumpToMessage}>
                    <span className="ib-wa-muted">
                      {(m.fromMe ? w('you') : m.senderName || formatPhone(m.senderHandle) || name) + ' · ' + longWhen(m.sentAt, locale)}
                    </span>
                    <span dir="auto" className="ib-wa-starred-text">
                      {m.body || w(`kind.${['image', 'video', 'audio', 'document', 'sticker'].includes(m.mediaType) ? m.mediaType : 'document'}`)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {group ? (
          <section className="ib-wa-card ib-wa-members" data-testid="inbox-members-section">
            <GroupMembers
              members={members}
              size={wa?.size}
              groupName={name}
              canManage={thread.channel === 'whatsapp'}
              showPhone={formatPhone}
              toast={(text) => onToast(text)}
              onMembers={(list) => setMembers(list)}
              run={async (action, targets) => {
                const r = await api<{ results: MemberTargetResult[]; participants: ParticipantDto[] }>(`/api/inbox/threads/${thread.id}/wa`, {
                  method: 'POST',
                  json: { action: 'members', op: action, phones: targets.phones },
                });
                if (!r.ok) return { ok: false, error: r.data.error ?? 'generic' };
                onChanged();
                return { ok: true, results: r.data.results, members: r.data.participants.map(toMember) };
              }}
              searchContacts={async (query) => {
                const r = await api<{ frequent: NewChatEntry[]; contacts: NewChatEntry[] }>(`/api/inbox/contacts?q=${encodeURIComponent(query)}&limit=50`);
                if (!r.ok) return [];
                const seen = new Set<string>();
                return [...(r.data.frequent ?? []), ...(r.data.contacts ?? [])]
                  .filter((e) => e.phone && !seen.has(e.phone) && seen.add(e.phone))
                  .map((e) => ({ key: e.key, name: e.name, phoneLabel: e.phoneLabel, phone: e.phone, pictureUrl: e.pictureUrl }));
              }}
              getInviteLink={async (revoke) => {
                const r = await api<{ link: string }>(`/api/inbox/threads/${thread.id}/wa`, { method: 'POST', json: { action: 'invite', revoke } });
                return r.ok ? { link: r.data.link } : { error: r.data.error ?? 'generic' };
              }}
              sendInvite={async (targets, text) => {
                const r = await api<{ results: MemberTargetResult[] }>(`/api/inbox/threads/${thread.id}/wa`, { method: 'POST', json: { action: 'inviteSend', phones: targets.phones, text } });
                return r.ok ? { results: r.data.results } : { error: r.data.error ?? 'generic' };
              }}
              onOpen={(m) => personSheet.open(m.phone, m.name || formatPhone(m.phone), m.picture || undefined)}
              onMessage={(m) => {
                const known = (wa?.participants ?? []).find((p) => p.phone === m.phone)?.threadId;
                if (known) onOpenThread(known);
                else void onStartChat(m.phone);
              }}
            >
              {(wa?.participants.length ?? 0) === 0 && <p className="ib-wa-muted">{w('membersUnknown')}</p>}
              {wa && wa.size > members.length && members.length > 0 && <p className="ib-wa-muted">{w('membersHidden', { n: wa.size - members.length })}</p>}
            </GroupMembers>
          </section>
        ) : (
          (wa?.commonGroups?.length ?? 0) > 0 && (
            <section className="ib-wa-card">
              <h3 className="ib-wa-card-title">{w('commonGroups', { n: wa!.commonGroups!.length })}</h3>
              <ul className="ib-wa-rows">
                {wa!.commonGroups!.map((g) => (
                  <li key={g.id}>
                    <button type="button" className="ib-wa-row" onClick={() => onOpenThread(g.id)}>
                      <Avatar name={g.title || w('group')} kind="group" src={g.avatar || undefined} seed={g.id} size={40} />
                      <span className="ib-wa-row-main">
                        <span className="ib-wa-row-name">{g.title || w('group')}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )
        )}

        <section className="ib-wa-card ib-wa-actions">
          <button
            type="button"
            className="ib-wa-row ib-wa-action"
            aria-expanded={muted ? undefined : muteOpen}
            onClick={() => (muted ? onMute(null) : setMuteOpen((v) => !v))}
          >
            <MuteIcon size={20} />
            <span className="ib-wa-row-main">
              <span className="ib-wa-row-name">{muted ? w('unmuteNotifications') : w('muteNotifications')}</span>
              {muted && thread.mutedUntil && <span className="ib-wa-muted">{w('mutedUntil', { when: longWhen(thread.mutedUntil, locale) })}</span>}
            </span>
          </button>
          {onKeepArchived && (
            <label className="ib-wa-row ib-wa-action ib-wa-keep">
              <ArchiveIcon size={20} />
              <span className="ib-wa-row-main">
                <span className="ib-wa-row-name">{w('keepArchived')}</span>
                <span className="ib-wa-muted">{w('keepArchivedHint')}</span>
              </span>
              <span className="ui-switch">
                <input type="checkbox" role="switch" data-testid="keep-archived" checked={!!thread.keepArchived} onChange={(e) => onKeepArchived(e.target.checked)} />
              </span>
            </label>
          )}
          {!muted && muteOpen && (
            <div className="ib-wa-mute-options" role="group" aria-label={w('muteNotifications')}>
              {(
                [
                  ['mute8h', 8 * 3600_000],
                  ['muteWeek', 7 * 86_400_000],
                  ['muteAlways', 1000 * 86_400_000],
                ] as const
              ).map(([key, ms], i) => (
                <button
                  key={key}
                  type="button"
                  className="btn btn-ghost btn-sm"
                  autoFocus={i === 0}
                  onClick={() => {
                    setMuteOpen(false);
                    onMute(new Date(Date.now() + ms).toISOString());
                  }}
                >
                  {w(key)}
                </button>
              ))}
            </div>
          )}
          {!group &&
            (confirmBlock ? (
              <div className="ib-confirm" role="alertdialog" aria-label={w('blockTitle', { name })}>
                <p>{w('blockBody', { name })}</p>
                <div className="ib-row">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmBlock(false)}>
                    {w('cancel')}
                  </button>
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => void block(true)} autoFocus>
                    {w('block')}
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="ib-wa-row ib-wa-action is-danger" onClick={() => (wa?.blocked ? void block(false) : setConfirmBlock(true))}>
                <Ban size={20} />
                <span className="ib-wa-row-main">
                  <span className="ib-wa-row-name">{wa?.blocked ? w('unblockName', { name }) : w('blockName', { name })}</span>
                </span>
              </button>
            ))}
        </section>
      </div>
      {personSheet.sheet}
      {viewerIndex >= 0 && <MediaViewer items={viewerItems} index={viewerIndex} onIndex={(i) => setViewerAt(viewerItems[i]?.id ?? null)} onClose={() => setViewerAt(null)} />}
      {photoOpen && thread.avatar && (
        <MediaViewer
          items={[{ id: 'photo', url: thread.avatar, type: 'image/jpeg', name, caption: '', author: name, createdAt: new Date().toISOString() }]}
          index={0}
          onIndex={() => undefined}
          onClose={() => setPhotoOpen(false)}
        />
      )}
    </aside>
  );
}

