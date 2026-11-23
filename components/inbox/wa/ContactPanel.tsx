'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { ThreadDto, WaDetailsDto } from '@/lib/inbox/types';
import Avatar from '@/components/groups/wa/Avatar';
import RichText from '@/components/groups/wa/RichText';
import MediaViewer from '@/components/groups/wa/MediaViewer';
import DetailsTabs from '@/components/groups/wa/DetailsTabs';
import SharedMedia from '@/components/groups/wa/SharedMedia';
import type { SheetSharedItem } from '@/components/groups/wa/ContactSheet';
import ThreadNotes from './ThreadNotes';
import { ArchiveIcon, Ban, BriefcaseIcon, Close, ExitIcon, GroupIcon, InfoIcon, MuteIcon, Note, PhotoIcon, Sparkle } from '@/components/groups/wa/icons';
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
  me = '',
}: {
  /** La persona (la pestaña elegida queda guardada por persona). */
  me?: string;
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
  const tdet = useTranslations('groups.wa.details');
  const locale = useLocale();
  const group = thread.kind === 'group';
  const name = chatName(thread, w('group'));
  // Nombre y descripción del grupo con su lápiz (se cambian en WhatsApp).
  const editable = group && thread.channel === 'whatsapp';
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [muteOpen, setMuteOpen] = useState(false);
  // Un participante abre su ficha (como en WhatsApp), con Mensaje para ir a su chat 1:1.
  const personSheet = useInboxPersonSheet(thread.id, { onOpenThread, onStartChat: async (phone) => onStartChat(phone), onError, onToast });

  // Lo compartido y los destacados, para la pestaña Archivos (components/groups/wa/SharedMedia.tsx).
  const loadShared = useCallback(
    async (kind: SharedKind): Promise<SheetSharedItem[] | null> => {
      const r = await api<{ items: SharedItem[] }>(`/api/inbox/threads/${thread.id}/wa?kind=${kind}`);
      if (!r.ok) return null;
      return r.data.items.map((m) => ({
        id: m.id,
        url: ['image', 'video', 'document'].includes(m.mediaType) ? `/api/inbox/media/${m.id}` : '',
        video: m.mediaType === 'video',
        name: m.mediaName,
        body: m.body,
        sentAt: m.sentAt,
        fromMe: m.fromMe,
        senderName: m.senderName || formatPhone(m.senderHandle),
        ...(m.urls ? { urls: m.urls } : {}),
      }));
    },
    [thread.id],
  );

  useEffect(() => {
    setSummary(null);
    setConfirmBlock(false);
    setConfirmExit(false);
    void api<{ summary: Summary }>(`/api/inbox/threads/${thread.id}/wa?part=summary`).then((r) => r.ok && setSummary(r.data.summary));
  }, [thread.id]);

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

  // Salir del grupo, como en WhatsApp: el chat queda como historial de solo lectura.
  const exitGroup = async () => {
    setConfirmExit(false);
    setExiting(true);
    const r = await api(`/api/inbox/threads/${thread.id}/wa`, { method: 'POST', json: { action: 'leave' } });
    setExiting(false);
    if (!r.ok) onError(r.data.error ?? 'generic');
    else {
      onToast(w('exitGroupDone'));
      onChanged();
    }
  };

  // Los participantes del panel de miembros (se corrigen con lo que devuelve WhatsApp al agregar o quitar).
  const [members, setMembers] = useState<GroupMember[]>([]);
  const participantsKey = (wa?.participants ?? []).map((p) => `${p.phone}:${p.role}:${p.name}`).join(',');
  useEffect(() => {
    setMembers((wa?.participants ?? []).map(toMember));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participantsKey]);
  const muted = !!thread.mutedUntil;

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
            <Avatar name={name} kind={group ? 'group' : 'dm'} src={thread.avatar || undefined} seed={thread.id} size={112} />
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

        <DetailsTabs
          storageKey={`zs-inbox-details-tab:${me}`}
          label={tdet('tabsLabel')}
          tabs={[
            {
              id: 'info',
              label: tdet('tabs.info'),
              icon: <InfoIcon size={18} />,
              content: (
                <>
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

                  {!group && (
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
          {group &&
            thread.channel === 'whatsapp' &&
            (thread.leftAt ? (
              <p className="ib-wa-row ib-wa-left-note" data-testid="group-left-note">
                {w('leftNote')}
              </p>
            ) : confirmExit ? (
              <div className="ib-confirm" role="alertdialog" aria-label={w('exitGroupTitle', { name })}>
                <p>{w('exitGroupBody')}</p>
                <div className="ib-row">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmExit(false)}>
                    {w('cancel')}
                  </button>
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => void exitGroup()} autoFocus data-testid="group-exit-confirm">
                    {w('exitGroup')}
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="ib-wa-row ib-wa-action is-danger" onClick={() => setConfirmExit(true)} disabled={exiting} aria-busy={exiting || undefined} data-testid="group-exit">
                <ExitIcon size={20} />
                <span className="ib-wa-row-main">
                  <span className="ib-wa-row-name">{w('exitGroup')}</span>
                </span>
              </button>
            ))}
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
                </>
              ),
            },
            ...(group
              ? [
                  {
                    id: 'members',
                    label: tdet('tabs.members'),
                    icon: <GroupIcon size={18} />,
                    count: wa?.size || members.length,
                    content: (
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
                    ),
                  },
                ]
              : []),
            {
              id: 'media',
              label: tdet('tabs.media'),
              icon: <PhotoIcon size={18} />,
              content: <SharedMedia key={thread.id} load={loadShared} chatName={name} starredKey={starredKey} onJumpToMessage={onJumpToMessage} />,
            },
            { id: 'notes', label: tdet('tabs.notes'), icon: <Note size={18} />, content: <ThreadNotes key={thread.id} threadId={thread.id} /> },
            ...(!group && thread.channel === 'whatsapp'
              ? [{ id: 'crm', label: tdet('tabs.crm'), icon: <BriefcaseIcon size={18} />, content: <InboxHubspotCard threadId={thread.id} /> }]
              : []),
          ]}
        />
      </div>
      {personSheet.sheet}
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

