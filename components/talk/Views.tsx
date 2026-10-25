'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { TalkChannelDto, TalkChannelKind, TalkMessageDto } from '@/lib/talk';
import type { LaterItem, TalkDraftDto, TalkFileListItem, TalkScheduledDto, TalkSearchResult } from '@/lib/talk-extras';
import { talkPlainText } from '@/lib/talk-markdown';
import MessageBody, { Avatar } from './MessageBody';
import { errorText } from './Composer';
import { fmtFull, fmtSize } from './Message';
import { useTalk, type TalkView } from './talk-context';

type ChannelRef = { id: string; name: string; kind: TalkChannelKind };

function useLoader<T>(url: string | null, deps: unknown[] = []) {
  const { api, subscribe } = useTalk();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    if (!url) return;
    setError(false);
    try {
      setData(await api<T>(url));
    } catch {
      setError(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, api, ...deps]);
  useEffect(() => {
    setData(null);
    void load();
  }, [load]);
  // Se refresca con lo que llega en vivo (mensajes, guardados, lecturas).
  useEffect(
    () =>
      subscribe((e) => {
        if (e.type === 'events' && e.events.some((ev) => ev.kind === 'message' || ev.kind === 'saved' || ev.kind === 'read' || ev.kind === 'reaction')) void load();
      }),
    [subscribe, load],
  );
  return { data, error, reload: load, setData };
}

function ViewShell({ title, desc, onBack, children, actions }: { title: string; desc?: string; onBack: () => void; children: React.ReactNode; actions?: React.ReactNode }) {
  const t = useTranslations('talk');
  return (
    <section className="talk-pane talk-view" aria-label={title}>
      <header className="talk-head">
        <button type="button" className="btn btn-ghost btn-sm talk-back" onClick={onBack} aria-label={t('nav.back')}>
          ←
        </button>
        <div className="talk-head-main">
          <h1 className="talk-head-title">{title}</h1>
          {desc && <span className="talk-head-topic is-static">{desc}</span>}
        </div>
        {actions && <div className="talk-head-actions">{actions}</div>}
      </header>
      <div className="talk-scroll talk-view-body">{children}</div>
    </section>
  );
}

function Loading() {
  const t = useTranslations('talk');
  return (
    <div className="ui-loading-stack talk-loading" aria-busy="true" aria-label={t('common.loading')}>
      <div className="ui-skeleton ui-skeleton-row" />
      <div className="ui-skeleton ui-skeleton-row" />
    </div>
  );
}

function ErrorBox({ retry }: { retry: () => void }) {
  const t = useTranslations('talk');
  return (
    <div className="talk-error" role="alert">
      <p>{t('errors.loadView')}</p>
      <button type="button" className="btn btn-sm" onClick={retry}>
        {t('common.retry')}
      </button>
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="ui-empty ui-empty-compact talk-empty">
      <p className="ui-empty-title">{title}</p>
      <p className="ui-empty-body">{body}</p>
    </div>
  );
}

function where(c: ChannelRef | null, ctx: ReturnType<typeof useTalk>): string {
  if (!c) return '';
  if (c.kind === 'public' || c.kind === 'private') return `#${c.name}`;
  const full = ctx.channelById.get(c.id);
  return full ? ctx.channelTitle(full) : '';
}

/** Un mensaje en una lista (resultados, actividad, guardados): abre el canal en ese mensaje. */
function MessageCard({ m, channel, extra }: { m: TalkMessageDto; channel: ChannelRef | null; extra?: React.ReactNode }) {
  const ctx = useTalk();
  const { locale, open, openThread, personName } = ctx;
  return (
    <article className="talk-card">
      <button
        type="button"
        className="talk-card-open"
        onClick={() => {
          if (!channel) return;
          if (m.parentId) {
            open({ channelId: channel.id, messageId: m.parentId, threadId: m.parentId });
          } else open({ channelId: channel.id, messageId: m.id });
          if (m.parentId) openThread(m.parentId);
        }}
      >
        <span className="talk-card-where">{where(channel, ctx)}</span>
        <span className="talk-muted">{fmtFull(m.createdAt, locale)}</span>
      </button>
      <div className="talk-card-msg">
        <Avatar id={m.userId} size={28} />
        <div className="talk-card-body">
          <span className="talk-msg-author">{m.botName || personName(m.userId)}</span>
          <MessageBody body={m.body} />
        </div>
      </div>
      {extra}
    </article>
  );
}

export function ThreadsView({ onBack }: { onBack: () => void }) {
  const t = useTranslations('talk');
  const ctx = useTalk();
  const { data, error, reload } = useLoader<{ threads: Array<{ root: TalkMessageDto; unread: boolean; channel: ChannelRef }> }>('/api/talk/views?view=threads');
  return (
    <ViewShell title={t('nav.threads')} desc={t('views.threadsDesc')} onBack={onBack}>
      {error ? (
        <ErrorBox retry={() => void reload()} />
      ) : !data ? (
        <Loading />
      ) : data.threads.length === 0 ? (
        <Empty title={t('views.threadsEmpty')} body={t('views.threadsEmptyBody')} />
      ) : (
        data.threads.map((th) => (
          <MessageCard
            key={th.root.id}
            m={th.root}
            channel={th.channel}
            extra={
              <button type="button" className={`talk-thread-summary${th.unread ? ' is-unread' : ''}`} onClick={() => {
                ctx.open({ channelId: th.channel.id, messageId: th.root.id });
                ctx.openThread(th.root.id);
              }}>
                <span className="talk-thread-count">{t('message.replies', { count: th.root.replyCount })}</span>
                {th.unread && <span className="badge badge-ink">{t('views.newReplies')}</span>}
              </button>
            }
          />
        ))
      )}
    </ViewShell>
  );
}

export function ActivityView({ onBack }: { onBack: () => void }) {
  const t = useTranslations('talk');
  const { data, error, reload } = useLoader<{ items: Array<{ message: TalkMessageDto; channel: ChannelRef }> }>('/api/talk/views?view=activity');
  return (
    <ViewShell title={t('nav.activity')} desc={t('views.activityDesc')} onBack={onBack}>
      {error ? (
        <ErrorBox retry={() => void reload()} />
      ) : !data ? (
        <Loading />
      ) : data.items.length === 0 ? (
        <Empty title={t('views.activityEmpty')} body={t('views.activityEmptyBody')} />
      ) : (
        data.items.map((it) => <MessageCard key={it.message.id} m={it.message} channel={it.channel} />)
      )}
    </ViewShell>
  );
}

export function LaterView({ onBack }: { onBack: () => void }) {
  const t = useTranslations('talk');
  const ctx = useTalk();
  const [tab, setTab] = useState<'open' | 'done'>('open');
  const { data, error, reload } = useLoader<{ items: LaterItem[] }>(`/api/talk/views?view=${tab === 'open' ? 'later' : 'later-done'}`, [tab]);

  async function act(fn: () => Promise<unknown>) {
    try {
      await fn();
      await reload();
      ctx.refreshBoot();
    } catch (err) {
      ctx.toast(errorText(t, err), 'error');
    }
  }

  return (
    <ViewShell
      title={t('nav.later')}
      desc={t('views.laterDesc')}
      onBack={onBack}
      actions={
        <div className="ui-tabs" role="tablist">
          <button type="button" role="tab" className="ui-tab" aria-selected={tab === 'open'} onClick={() => setTab('open')}>
            {t('views.inProgress')}
          </button>
          <button type="button" role="tab" className="ui-tab" aria-selected={tab === 'done'} onClick={() => setTab('done')}>
            {t('views.completed')}
          </button>
        </div>
      }
    >
      {error ? (
        <ErrorBox retry={() => void reload()} />
      ) : !data ? (
        <Loading />
      ) : data.items.length === 0 ? (
        <Empty title={tab === 'open' ? t('views.laterEmpty') : t('views.laterDoneEmpty')} body={t('views.laterEmptyBody')} />
      ) : (
        data.items.map((it) =>
          it.message ? (
            <MessageCard
              key={it.message.id}
              m={it.message}
              channel={it.channel}
              extra={
                <div className="talk-card-actions">
                  {it.reminder && (
                    <span className={`talk-muted${it.reminder.sentAt ? ' talk-due' : ''}`}>
                      ⏰ {fmtFull(it.reminder.remindAt, ctx.locale)}
                    </span>
                  )}
                  <button type="button" className="btn btn-sm" onClick={() => void act(() => ctx.api(`/api/talk/messages/${it.message!.id}/save`, { method: 'POST', json: { done: !it.done } }))}>
                    {it.done ? t('views.reopen') : t('views.markDone')}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void act(() => ctx.api(`/api/talk/messages/${it.message!.id}/save`, { method: 'DELETE' }))}>
                    {t('views.remove')}
                  </button>
                </div>
              }
            />
          ) : it.reminder ? (
            <article key={it.reminder.id} className="talk-card">
              <p className="talk-card-where">⏰ {fmtFull(it.reminder.remindAt, ctx.locale)}</p>
              <p>{it.reminder.text}</p>
              <div className="talk-card-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void act(() => ctx.api(`/api/talk/reminders?id=${it.reminder!.id}`, { method: 'DELETE' }))}>
                  {t('views.remove')}
                </button>
              </div>
            </article>
          ) : null,
        )
      )}
    </ViewShell>
  );
}

export function DraftsView({ onBack }: { onBack: () => void }) {
  const t = useTranslations('talk');
  const ctx = useTalk();
  const { data, error, reload } = useLoader<{ drafts: TalkDraftDto[]; scheduled: TalkScheduledDto[] }>('/api/talk/views?view=drafts');
  const names = { user: (id: string) => ctx.personName(id), channel: (id: string) => ctx.channelById.get(id)?.name };
  async function cancel(id: string) {
    try {
      await ctx.api(`/api/talk/scheduled/${id}`, { method: 'DELETE' });
      await reload();
      ctx.refreshBoot();
      ctx.toast(t('views.scheduledCancelled'));
    } catch (err) {
      ctx.toast(errorText(t, err), 'error');
    }
  }
  return (
    <ViewShell title={t('nav.drafts')} desc={t('views.draftsDesc')} onBack={onBack}>
      {error ? (
        <ErrorBox retry={() => void reload()} />
      ) : !data ? (
        <Loading />
      ) : data.drafts.length === 0 && data.scheduled.length === 0 ? (
        <Empty title={t('views.draftsEmpty')} body={t('views.draftsEmptyBody')} />
      ) : (
        <>
          {data.scheduled.length > 0 && <h2 className="talk-view-h">{t('views.scheduled')}</h2>}
          {data.scheduled.map((s) => (
            <article key={s.id} className="talk-card">
              <p className="talk-card-where">
                {s.channel.kind === 'public' || s.channel.kind === 'private' ? `#${s.channel.name}` : t('views.dm')} · {t('views.sendsAt', { when: fmtFull(s.sendAt, ctx.locale) })}
                {s.status === 'failed' && <span className="badge badge-bad">{t('views.failed')}</span>}
              </p>
              <p className="talk-card-text">{talkPlainText(s.body, names)}</p>
              <div className="talk-card-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void cancel(s.id)}>
                  {t('views.cancelScheduled')}
                </button>
              </div>
            </article>
          ))}
          {data.drafts.length > 0 && <h2 className="talk-view-h">{t('views.drafts')}</h2>}
          {data.drafts.map((d) => (
            <button
              key={`${d.channelId}|${d.parentId ?? ''}`}
              type="button"
              className="talk-card talk-card-btn"
              onClick={() => {
                ctx.open({ channelId: d.channelId });
                if (d.parentId) ctx.openThread(d.parentId);
              }}
            >
              <span className="talk-card-where">
                {d.channel.kind === 'public' || d.channel.kind === 'private' ? `#${d.channel.name}` : t('views.dm')}
                {d.parentId ? ` · ${t('views.inThread')}` : ''}
              </span>
              <span className="talk-card-text">{talkPlainText(d.body, names)}</span>
            </button>
          ))}
        </>
      )}
    </ViewShell>
  );
}

export function FilesView({ onBack }: { onBack: () => void }) {
  const t = useTranslations('talk');
  const ctx = useTalk();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'all' | 'image' | 'document'>('all');
  const [applied, setApplied] = useState('');
  const { data, error, reload } = useLoader<{ files: TalkFileListItem[] }>(`/api/talk/files?q=${encodeURIComponent(applied)}&kind=${kind}`, [applied, kind]);
  return (
    <ViewShell title={t('nav.files')} desc={t('views.filesDesc')} onBack={onBack}>
      <form
        className="talk-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(q);
        }}
      >
        <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('views.filesSearch')} aria-label={t('views.filesSearch')} />
        <select className="select" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label={t('views.fileType')}>
          <option value="all">{t('views.allFiles')}</option>
          <option value="image">{t('views.images')}</option>
          <option value="document">{t('views.documents')}</option>
        </select>
      </form>
      {error ? (
        <ErrorBox retry={() => void reload()} />
      ) : !data ? (
        <Loading />
      ) : data.files.length === 0 ? (
        <Empty title={t('views.filesEmpty')} body={t('views.filesEmptyBody')} />
      ) : (
        <ul className="talk-file-list">
          {data.files.map((f) => (
            <li key={f.id} className="talk-file">
              <span className="talk-file-icon" aria-hidden="true">
                {(f.name.split('.').pop() ?? '').slice(0, 4).toUpperCase()}
              </span>
              <span className="talk-file-meta">
                <a className="talk-file-name" href={f.url} target="_blank" rel="noopener noreferrer">
                  {f.name}
                </a>
                <span className="talk-file-size">
                  {fmtSize(f.size)} · {ctx.personName(f.userId)} · {f.channelKind === 'public' || f.channelKind === 'private' ? `#${f.channelName}` : t('views.dm')} · {fmtFull(f.createdAt, ctx.locale)}
                </span>
              </span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => ctx.open({ channelId: f.channelId, messageId: f.messageId })}>
                {t('views.showMessage')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </ViewShell>
  );
}

export function SearchView({ query, onBack }: { query: string; onBack: () => void }) {
  const t = useTranslations('talk');
  const ctx = useTalk();
  const [q, setQ] = useState(query);
  useEffect(() => setQ(query), [query]);
  const { data, error, reload } = useLoader<{ results: TalkSearchResult[]; channels: ChannelRef[] }>(query ? `/api/talk/search?q=${encodeURIComponent(query)}` : null, [query]);
  return (
    <ViewShell title={t('search.title')} desc={query ? t('search.for', { q: query }) : undefined} onBack={onBack}>
      <form
        className="talk-filters"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          ctx.open({ view: 'search', query: q.trim() });
        }}
      >
        <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('search.label')} placeholder={t('search.placeholder')} />
        <button type="submit" className="btn btn-sm">
          {t('search.go')}
        </button>
      </form>
      <p className="talk-hint">{t('search.help')}</p>
      {!query ? null : error ? (
        <ErrorBox retry={() => void reload()} />
      ) : !data ? (
        <Loading />
      ) : data.results.length === 0 && data.channels.length === 0 ? (
        <Empty title={t('search.empty')} body={t('search.emptyBody')} />
      ) : (
        <>
          {data.channels.length > 0 && (
            <>
              <h2 className="talk-view-h">{t('search.channels')}</h2>
              <ul className="talk-browse-list">
                {data.channels.map((c) => (
                  <li key={c.id}>
                    <button type="button" className="talk-browse-item" onClick={() => ctx.open({ channelId: c.id })}>
                      <span className="talk-browse-name">
                        {c.kind === 'private' ? '🔒' : '#'} {c.name}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {data.results.length > 0 && <h2 className="talk-view-h">{t('search.messages', { count: data.results.length })}</h2>}
          {data.results.map((r) => (
            <MessageCard key={r.message.id} m={r.message} channel={r.channel} />
          ))}
        </>
      )}
    </ViewShell>
  );
}

export function BrowseView({ onBack }: { onBack: (v?: TalkView) => void }) {
  const t = useTranslations('talk');
  const ctx = useTalk();
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState(false);
  const { data, error, reload } = useLoader<{ channels: TalkChannelDto[] }>(`/api/talk/channels?q=${encodeURIComponent(q)}${archived ? '&archived=1' : ''}`, [q, archived]);
  async function join(c: TalkChannelDto) {
    try {
      await ctx.api(`/api/talk/channels/${c.id}/members`, { method: 'POST', json: { join: true } });
      ctx.refreshBoot();
      ctx.open({ channelId: c.id });
    } catch (err) {
      ctx.toast(errorText(t, err), 'error');
    }
  }
  return (
    <ViewShell
      title={t('browse.title')}
      desc={t('browse.desc')}
      onBack={() => onBack()}
      actions={
        <button type="button" className="btn btn-primary btn-sm" onClick={() => ctx.dialog({ kind: 'create-channel' })}>
          {t('browse.create')}
        </button>
      }
    >
      <div className="talk-filters">
        <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('browse.search')} aria-label={t('browse.search')} />
        <label className="ui-check">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
          <span>{t('browse.archived')}</span>
        </label>
      </div>
      {error ? (
        <ErrorBox retry={() => void reload()} />
      ) : !data ? (
        <Loading />
      ) : data.channels.length === 0 ? (
        <Empty title={t('browse.empty')} body={t('browse.emptyBody')} />
      ) : (
        <ul className="talk-browse-list">
          {data.channels.map((c) => (
            <li key={c.id} className="talk-browse-row">
              <button type="button" className="talk-browse-item" onClick={() => ctx.open({ channelId: c.id })}>
                <span className="talk-browse-name">
                  {c.kind === 'private' ? '🔒' : '#'} {c.name}
                </span>
                <span className="talk-muted">
                  {c.isMember ? `${t('browse.joined')} · ` : ''}
                  {t('channel.membersCount', { count: c.memberCount })}
                  {c.topic || c.description ? ` · ${c.topic || c.description}` : ''}
                </span>
              </button>
              {!c.isMember && !c.archived && c.kind === 'public' && (
                <button type="button" className="btn btn-sm" onClick={() => void join(c)}>
                  {t('channel.join')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </ViewShell>
  );
}
