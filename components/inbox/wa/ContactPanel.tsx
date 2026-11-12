'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { ThreadDto, WaDetailsDto } from '@/lib/inbox/types';
import Avatar from '@/components/groups/wa/Avatar';
import RichText from '@/components/groups/wa/RichText';
import MediaViewer, { type ViewerItem } from '@/components/groups/wa/MediaViewer';
import { Ban, Close, DocIcon, MuteIcon, Search, Sparkle } from '@/components/groups/wa/icons';
import { fileSize, posterFrame } from '@/components/groups/wa/format';
import { api, longWhen } from '../api';
import { chatName, formatPhone } from './util';

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
  onError,
  onToast,
  onChanged,
}: {
  thread: ThreadDto;
  wa: WaDetailsDto | null;
  onClose: () => void;
  onOpenThread: (id: string) => void;
  onStartChat: (phone: string) => void;
  onMute: (until: string | null) => void;
  onError: (code: string) => void;
  onToast: (text: string) => void;
  onChanged: () => void;
}) {
  const w = useTranslations('inboxWa');
  const locale = useLocale();
  const group = thread.kind === 'group';
  const name = chatName(thread, w('group'));
  const [tab, setTab] = useState<SharedKind>('media');
  const [shared, setShared] = useState<Record<string, SharedItem[] | null>>({});
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [q, setQ] = useState('');
  const [viewerAt, setViewerAt] = useState<string | null>(null);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [muteOpen, setMuteOpen] = useState(false);

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
    setQ('');
    setConfirmBlock(false);
    void load('media');
    void load('starred');
    void api<{ summary: Summary }>(`/api/inbox/threads/${thread.id}/wa?part=summary`).then((r) => r.ok && setSummary(r.data.summary));
  }, [thread.id, load]);

  useEffect(() => {
    if (shared[tab] === undefined) void load(tab);
  }, [tab, shared, load]);

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
  const participants = (wa?.participants ?? []).filter((p) => {
    const s = q.trim().toLowerCase();
    return !s || p.name.toLowerCase().includes(s) || p.phone.includes(s.replace(/\D/g, '') || '§');
  });
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
          <p className="ib-wa-hero-name" dir="auto">
            {name}
          </p>
          <p className="ib-wa-hero-sub">
            {group ? (wa?.size || wa?.participants.length ? w('groupMembers', { n: wa?.size || wa?.participants.length || 0 }) : w('group')) : formatPhone(thread.handle)}
            {!group && wa?.isBusiness && <span className="ib-wa-badge">{w('business')}</span>}
          </p>
        </section>

        {(wa?.about || group) && (
          <section className="ib-wa-card">
            <h3 className="ib-wa-card-title">{group ? w('description') : w('about')}</h3>
            {wa?.about ? (
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
                <li key={m.id} className="ib-wa-starred">
                  <span className="ib-wa-muted">
                    {(m.fromMe ? w('you') : m.senderName || formatPhone(m.senderHandle) || name) + ' · ' + longWhen(m.sentAt, locale)}
                  </span>
                  <span dir="auto">{m.body || w(`kind.${['image', 'video', 'audio', 'document', 'sticker'].includes(m.mediaType) ? m.mediaType : 'document'}`)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {group ? (
          <section className="ib-wa-card">
            <h3 className="ib-wa-card-title">{w('groupMembers', { n: wa?.size || wa?.participants.length || 0 })}</h3>
            {(wa?.participants.length ?? 0) > 8 && (
              <label className="wa-search ib-wa-member-search">
                <Search size={16} />
                <span className="sr-only">{w('searchMembers')}</span>
                <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={w('searchMembers')} />
              </label>
            )}
            {(wa?.participants.length ?? 0) === 0 ? (
              <p className="ib-wa-muted">{w('membersUnknown')}</p>
            ) : (
              <ul className="ib-wa-rows">
                {participants.slice(0, 300).map((p) => (
                  <li key={p.phone}>
                    <button
                      type="button"
                      className="ib-wa-row"
                      disabled={p.me}
                      onClick={() => (p.threadId ? onOpenThread(p.threadId) : onStartChat(p.phone))}
                      title={p.me ? undefined : w('messageMember')}
                    >
                      <Avatar name={p.me ? w('you') : p.name || formatPhone(p.phone)} kind="dm" src={p.avatar || undefined} seed={p.phone} size={40} />
                      <span className="ib-wa-row-main">
                        <span className="ib-wa-row-name" dir="auto">
                          {p.me ? w('you') : p.name || formatPhone(p.phone)}
                        </span>
                        {!p.me && p.name && <span className="ib-wa-muted">{formatPhone(p.phone)}</span>}
                      </span>
                      {p.role !== 'member' && <span className="ib-wa-badge">{w('admin')}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {wa && wa.size > wa.participants.length && <p className="ib-wa-muted">{w('membersHidden', { n: wa.size - wa.participants.length })}</p>}
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
