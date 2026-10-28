'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { TalkChannelDto } from '@/lib/talk';
import type { TalkSectionDto } from '@/lib/talk-sections';
import { Avatar } from './MessageBody';
import { HuddleBar } from './Huddle';
import { useTalk, type TalkView } from './talk-context';

const byRecent = (a: TalkChannelDto, b: TalkChannelDto) => (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt);
const byName = (label: (c: TalkChannelDto) => string) => (a: TalkChannelDto, b: TalkChannelDto) => label(a).localeCompare(label(b));

/** Orden del sidebar (también para Alt+↑/↓): destacados, secciones propias, canales y DMs. */
export function sidebarOrder(channels: TalkChannelDto[], sections: TalkSectionDto[] = []): TalkChannelDto[] {
  const inSection = new Map<string, string>();
  for (const s of sections) for (const id of s.channelIds) inSection.set(id, s.id);
  const starred = channels.filter((c) => c.starred);
  const free = channels.filter((c) => !c.starred && !inSection.has(c.id));
  const sectioned = sections.flatMap((s) => {
    const list = channels.filter((c) => !c.starred && inSection.get(c.id) === s.id);
    return s.sort === 'recent' ? list.sort(byRecent) : list.sort(byName((c) => c.name || c.memberIds.join(',')));
  });
  const chans = free.filter((c) => c.kind === 'public' || c.kind === 'private');
  const dms = free.filter((c) => c.kind === 'dm' || c.kind === 'group');
  return [...starred, ...sectioned, ...chans, ...dms.sort(byRecent)];
}

function useDismiss(open: boolean, close: () => void, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close, ref]);
}

/** "⋯" de un canal del sidebar: moverlo a una sección. */
function ItemMenu({ channel, sections }: { channel: TalkChannelDto; sections: TalkSectionDto[] }) {
  const t = useTranslations('talk');
  const ctx = useTalk();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), ref);
  const current = sections.find((s) => s.channelIds.includes(channel.id));
  async function move(sectionId: string | null) {
    setOpen(false);
    try {
      await ctx.api('/api/talk/sections', { method: 'POST', json: { action: 'move', channelId: channel.id, sectionId } });
      ctx.refreshBoot();
    } catch {
      ctx.toast(t('errors.generic'), 'error');
    }
  }
  return (
    <div className="talk-side-more" ref={ref}>
      <button
        type="button"
        className="talk-side-more-btn"
        aria-label={t('sections.itemMenu', { name: channel.name || ctx.channelTitle(channel) })}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          setOpen((v) => !v);
        }}
      >
        ⋯
      </button>
      {open && (
        <div className="talk-menu talk-side-menu" role="menu">
          <p className="talk-menu-label">{t('sections.moveTo')}</p>
          {sections
            .filter((s) => s.id !== current?.id)
            .map((s) => (
              <button key={s.id} type="button" role="menuitem" className="talk-menu-item" onClick={() => void move(s.id)}>
                {s.name}
              </button>
            ))}
          <button
            type="button"
            role="menuitem"
            className="talk-menu-item"
            onClick={() => {
              setOpen(false);
              ctx.dialog({ kind: 'section', channelId: channel.id });
            }}
          >
            {t('sections.newWithChannel')}
          </button>
          {current && (
            <button type="button" role="menuitem" className="talk-menu-item" onClick={() => void move(null)}>
              {t('sections.removeFrom', { name: current.name })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** "⋯" de una sección propia: renombrar, orden, mover y borrar. */
function SectionMenu({ section, first, last }: { section: TalkSectionDto; first: boolean; last: boolean }) {
  const t = useTranslations('talk');
  const ctx = useTalk();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), ref);
  async function run(json: Record<string, unknown>) {
    setOpen(false);
    try {
      await ctx.api('/api/talk/sections', { method: 'POST', json });
      ctx.refreshBoot();
    } catch {
      ctx.toast(t('errors.generic'), 'error');
    }
  }
  return (
    <div className="talk-side-more is-section" ref={ref}>
      <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={t('sections.menu', { name: section.name })} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        ⋯
      </button>
      {open && (
        <div className="talk-menu talk-side-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            className="talk-menu-item"
            onClick={() => {
              setOpen(false);
              ctx.dialog({ kind: 'section', sectionId: section.id, name: section.name });
            }}
          >
            {t('sections.rename')}
          </button>
          <button type="button" role="menuitem" className="talk-menu-item" onClick={() => void run({ action: 'update', id: section.id, sort: section.sort === 'alpha' ? 'recent' : 'alpha' })}>
            {section.sort === 'alpha' ? t('sections.sortRecent') : t('sections.sortAlpha')}
          </button>
          {!first && (
            <button type="button" role="menuitem" className="talk-menu-item" onClick={() => void run({ action: 'update', id: section.id, move: -1 })}>
              {t('sections.moveUp')}
            </button>
          )}
          {!last && (
            <button type="button" role="menuitem" className="talk-menu-item" onClick={() => void run({ action: 'update', id: section.id, move: 1 })}>
              {t('sections.moveDown')}
            </button>
          )}
          <button type="button" role="menuitem" className="talk-menu-item is-danger" onClick={() => void run({ action: 'delete', id: section.id })}>
            {t('sections.delete')}
          </button>
        </div>
      )}
    </div>
  );
}

function WorkspaceSwitch() {
  const t = useTranslations('talk');
  const ctx = useTalk();
  const list = ctx.boot.workspaces ?? [];
  if (list.length < 2) return null;
  async function pick(id: string) {
    if (id === ctx.boot.workspaceId) return;
    try {
      await ctx.api('/api/talk/workspace', { method: 'POST', json: { workspaceId: id } });
      window.location.href = `/${ctx.locale}/app/talk`;
    } catch {
      ctx.toast(t('errors.generic'), 'error');
    }
  }
  return (
    <label className="talk-side-ws">
      <span className="sr-only">{t('guests.workspace')}</span>
      <select className="select" value={ctx.boot.workspaceId} onChange={(e) => void pick(e.target.value)} data-testid="talk-workspace-switch">
        {list.map((w) => (
          <option key={w.id} value={w.id}>
            {w.guest ? t('guests.asGuest', { name: w.name }) : w.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function Sidebar({ activeId, view, onNavigate }: { activeId: string | null; view: TalkView; onNavigate?: () => void }) {
  const t = useTranslations('talk');
  const ctx = useTalk();
  const { channels, open, dialog, boot, channelTitle, presence } = ctx;
  const sections = boot.sections ?? [];
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState('');
  const ordered = sidebarOrder(channels, sections);
  const inSection = new Map<string, string>();
  for (const s of sections) for (const id of s.channelIds) inSection.set(id, s.id);
  const starred = ordered.filter((c) => c.starred);
  const chans = ordered.filter((c) => !c.starred && !inSection.has(c.id) && (c.kind === 'public' || c.kind === 'private'));
  const dms = ordered.filter((c) => !c.starred && !inSection.has(c.id) && (c.kind === 'dm' || c.kind === 'group'));
  const me = presence.get(boot.me);
  const huddleIn = new Map((boot.huddles ?? []).map((h) => [h.channelId, h.userIds.length]));

  function go(target: Parameters<typeof open>[0]) {
    open(target);
    onNavigate?.();
  }

  function item(c: TalkChannelDto) {
    const isDm = c.kind === 'dm' || c.kind === 'group';
    const other = c.kind === 'dm' ? (c.memberIds[0] ?? boot.me) : null;
    const label = isDm ? channelTitle(c) : c.name;
    const current = view === 'channel' && activeId === c.id;
    const live = huddleIn.get(c.id);
    return (
      <li key={c.id} className="talk-side-row">
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
          {live ? (
            <span className="talk-side-huddle" title={t('huddle.liveCount', { count: live })}>
              <span aria-hidden="true">🎧</span>
              <span className="sr-only">{t('huddle.liveCount', { count: live })}</span>
            </span>
          ) : null}
          {c.notify === 'none' && <span className="talk-side-muted" aria-label={t('channel.muted')}>🔕</span>}
          {c.mentions > 0 && (
            <span className="talk-badge" aria-label={t('nav.mentionsCount', { count: c.mentions })}>
              {c.mentions}
            </span>
          )}
        </a>
        <ItemMenu channel={c} sections={sections} />
      </li>
    );
  }

  function section(key: string, title: string, list: TalkChannelDto[], opts: { add?: { label: string; onClick: () => void }; custom?: { s: TalkSectionDto; first: boolean; last: boolean } } = {}) {
    const isCollapsed = collapsed[key];
    const { add, custom } = opts;
    // Colapsado se siguen viendo los que tienen algo nuevo o el abierto (como Slack).
    const shown = isCollapsed ? list.filter((c) => c.unread || c.id === activeId) : list;
    return (
      <div className="talk-side-section" key={key} data-section={custom ? custom.s.id : key}>
        <div className="talk-side-section-head">
          <button type="button" className="talk-side-toggle" aria-expanded={!isCollapsed} onClick={() => setCollapsed((s) => ({ ...s, [key]: !s[key] }))}>
            <span aria-hidden="true">{isCollapsed ? '▸' : '▾'}</span> {title}
          </button>
          {custom && <SectionMenu section={custom.s} first={custom.first} last={custom.last} />}
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
        {!isCollapsed && custom && list.length === 0 && <p className="talk-side-empty is-static">{t('sections.empty')}</p>}
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
      <WorkspaceSwitch />
      {boot.guest && (
        <p className="talk-side-guest" role="note">
          {t('guests.youAreGuest')}
        </p>
      )}
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
          {navBtn('recap', t('nav.recap'))}
          {navBtn('files', t('nav.files'))}
          {!boot.guest && navBtn('browse', t('nav.browse'))}
        </div>
        {starred.length > 0 && section('starred', t('nav.starred'), starred)}
        {sections.map((s, i) =>
          section(
            `s:${s.id}`,
            s.name,
            ordered.filter((c) => !c.starred && inSection.get(c.id) === s.id),
            { custom: { s, first: i === 0, last: i === sections.length - 1 } },
          ),
        )}
        {section('channels', t('nav.channels'), chans, boot.guest ? {} : { add: { label: t('nav.addChannel'), onClick: () => dialog({ kind: 'create-channel' }) } })}
        {/* Los archivados no ocupan el sidebar: se ven desde el directorio. */}
        {!boot.guest && (
          <button type="button" className="talk-side-archived" onClick={() => go({ view: 'browse', query: 'archived' })}>
            {t('nav.archived')}
          </button>
        )}
        {section('dms', t('nav.dms'), dms, { add: { label: t('nav.newMessage'), onClick: () => dialog({ kind: 'new-dm' }) } })}
        <button type="button" className="talk-side-archived" onClick={() => dialog({ kind: 'section' })} data-testid="talk-new-section">
          {t('sections.new')}
        </button>
      </div>
      <HuddleBar />
      <div className="talk-side-foot">
        <button type="button" className="talk-me" onClick={() => dialog({ kind: 'status' })} aria-label={t('status.open')}>
          <Avatar id={boot.me} size={24} presence />
          <span className="talk-me-text">
            <span className="talk-me-name">{ctx.personName(boot.me)}</span>
            <span className="talk-me-status">
              {me?.statusEmoji
                ? `${me.statusEmoji} ${me.statusText}`
                : me?.away
                  ? t('status.away')
                  : me?.dndUntil || me?.snoozed
                    ? t('status.dnd')
                    : t('status.active')}
            </span>
          </span>
        </button>
        {boot.isAdmin && (
          <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={t('admin.title')} title={t('admin.title')} onClick={() => dialog({ kind: 'admin' })}>
            ⚑
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={t('prefs.title')} title={t('prefs.title')} onClick={() => dialog({ kind: 'prefs' })}>
          ⚙
        </button>
      </div>
    </nav>
  );
}
