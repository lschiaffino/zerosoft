'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { TalkChannelDto } from '@/lib/talk';
import { Avatar } from './MessageBody';
import { useTalk, type TalkView } from './talk-context';

export function sidebarOrder(channels: TalkChannelDto[]): TalkChannelDto[] {
  const starred = channels.filter((c) => c.starred);
  const chans = channels.filter((c) => !c.starred && (c.kind === 'public' || c.kind === 'private'));
  const dms = channels.filter((c) => !c.starred && (c.kind === 'dm' || c.kind === 'group'));
  return [...starred, ...chans, ...dms.sort((a, b) => (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt))];
}

export default function Sidebar({ activeId, view, onNavigate }: { activeId: string | null; view: TalkView; onNavigate?: () => void }) {
  const t = useTranslations('talk');
  const ctx = useTalk();
  const { channels, open, dialog, boot, channelTitle, presence } = ctx;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState('');
  const ordered = sidebarOrder(channels);
  const starred = ordered.filter((c) => c.starred);
  const chans = ordered.filter((c) => !c.starred && (c.kind === 'public' || c.kind === 'private'));
  const dms = ordered.filter((c) => !c.starred && (c.kind === 'dm' || c.kind === 'group'));
  const me = presence.get(boot.me);

  function go(target: Parameters<typeof open>[0]) {
    open(target);
    onNavigate?.();
  }

  function item(c: TalkChannelDto) {
    const isDm = c.kind === 'dm' || c.kind === 'group';
    const other = c.kind === 'dm' ? (c.memberIds[0] ?? boot.me) : null;
    const label = isDm ? channelTitle(c) : c.name;
    const current = view === 'channel' && activeId === c.id;
    return (
      <li key={c.id}>
        <a
          href={`/${ctx.locale}/app/talk/${c.id}`}
          className={`talk-side-item${c.unread ? ' is-unread' : ''}`}
          aria-current={current ? 'page' : undefined}
          data-channel-id={c.id}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey) return;
            e.preventDefault();
            go({ channelId: c.id });
          }}
        >
          {isDm ? (
            c.kind === 'dm' ? (
              <Avatar id={other} size={18} presence />
            ) : (
              <span className="talk-side-glyph talk-side-count" aria-hidden="true">
                {c.memberIds.length + 1}
              </span>
            )
          ) : (
            <span className="talk-side-glyph" aria-hidden="true">
              {c.kind === 'private' ? '🔒' : '#'}
            </span>
          )}
          <span className="talk-side-name">{label}</span>
          {c.kind === 'dm' && other && presence.get(other)?.statusEmoji && <span aria-hidden="true">{presence.get(other)?.statusEmoji}</span>}
          {c.notify === 'none' && <span className="talk-side-muted" aria-label={t('channel.muted')}>🔕</span>}
          {c.mentions > 0 && (
            <span className="talk-badge" aria-label={t('nav.mentionsCount', { count: c.mentions })}>
              {c.mentions}
            </span>
          )}
        </a>
      </li>
    );
  }

  function section(key: string, title: string, list: TalkChannelDto[], add?: { label: string; onClick: () => void }) {
    const isCollapsed = collapsed[key];
    // Colapsado se siguen viendo los que tienen algo nuevo o el abierto (como Slack).
    const shown = isCollapsed ? list.filter((c) => c.unread || c.id === activeId) : list;
    return (
      <div className="talk-side-section">
        <div className="talk-side-section-head">
          <button type="button" className="talk-side-toggle" aria-expanded={!isCollapsed} onClick={() => setCollapsed((s) => ({ ...s, [key]: !s[key] }))}>
            <span aria-hidden="true">{isCollapsed ? '▸' : '▾'}</span> {title}
          </button>
          {add && (
            <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={add.label} title={add.label} onClick={add.onClick}>
              +
            </button>
          )}
        </div>
        <ul className="talk-side-list">{shown.map(item)}</ul>
        {!isCollapsed && add && list.length === 0 && (
          <button type="button" className="talk-side-empty" onClick={add.onClick}>
            {add.label}
          </button>
        )}
      </div>
    );
  }

  function navBtn(v: TalkView, label: string, badge?: number) {
    return (
      <button type="button" className="talk-side-item talk-side-view" aria-current={view === v ? 'page' : undefined} onClick={() => go({ view: v })}>
        <span className="talk-side-name">{label}</span>
        {badge ? <span className="talk-badge talk-badge-quiet">{badge}</span> : null}
      </button>
    );
  }

  return (
    <nav className="talk-side" aria-label={t('nav.label')}>
      <form
        className="talk-side-search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim()) go({ view: 'search', query: query.trim() });
        }}
      >
        <input
          className="input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('search.placeholder')}
          aria-label={t('search.label')}
          data-testid="talk-search-input"
        />
      </form>
      <div className="talk-side-scroll">
        <div className="talk-side-views">
          {navBtn('threads', t('nav.threads'), boot.unreadThreads)}
          {navBtn('activity', t('nav.activity'))}
          {navBtn('later', t('nav.later'), boot.counts.later)}
          {navBtn('drafts', t('nav.drafts'), boot.counts.drafts + boot.counts.scheduled)}
          {navBtn('files', t('nav.files'))}
          {navBtn('browse', t('nav.browse'))}
        </div>
        {starred.length > 0 && section('starred', t('nav.starred'), starred)}
        {section('channels', t('nav.channels'), chans, { label: t('nav.addChannel'), onClick: () => dialog({ kind: 'create-channel' }) })}
        {/* Los archivados no ocupan el sidebar: se ven desde el directorio. */}
        <button type="button" className="talk-side-archived" onClick={() => go({ view: 'browse', query: 'archived' })}>
          {t('nav.archived')}
        </button>
        {section('dms', t('nav.dms'), dms, { label: t('nav.newMessage'), onClick: () => dialog({ kind: 'new-dm' }) })}
      </div>
      <div className="talk-side-foot">
        <button type="button" className="talk-me" onClick={() => dialog({ kind: 'status' })} aria-label={t('status.open')}>
          <Avatar id={boot.me} size={24} presence />
          <span className="talk-me-text">
            <span className="talk-me-name">{ctx.personName(boot.me)}</span>
            <span className="talk-me-status">
              {me?.statusEmoji ? `${me.statusEmoji} ${me.statusText}` : me?.away ? t('status.away') : me?.dndUntil ? t('status.dnd') : t('status.active')}
            </span>
          </span>
        </button>
        <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={t('prefs.title')} title={t('prefs.title')} onClick={() => dialog({ kind: 'prefs' })}>
          ⚙
        </button>
      </div>
    </nav>
  );
}
