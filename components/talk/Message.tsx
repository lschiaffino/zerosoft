'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { TalkChannelDto, TalkMessageDto } from '@/lib/talk';
import { decodeMentions, encodeMentions } from '@/lib/talk-markdown';
import { QUICK_REACTIONS, emojiName } from '@/lib/talk-emoji';
import MessageBody, { Avatar } from './MessageBody';
import { useTalk } from './talk-context';
import { errorText } from './Composer';

interface Props {
  message: TalkMessageDto;
  channel: TalkChannelDto;
  /** Sigue a otro mensaje de la misma persona: sin avatar ni nombre. */
  grouped?: boolean;
  inThread?: boolean;
  highlighted?: boolean;
  editing: boolean;
  onEdit: (id: string | null) => void;
  onMarkUnread?: (m: TalkMessageDto) => void;
}

export function fmtTime(iso: string, locale: string): string {
  return new Date(iso).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

export function fmtFull(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function messageLink(m: Pick<TalkMessageDto, 'channelId' | 'id' | 'parentId'>, locale: string): string {
  const root = m.parentId ?? m.id;
  return `${window.location.origin}/${locale}/app/talk/${m.channelId}?m=${m.parentId ? m.id : root}${m.parentId ? `&thread=${m.parentId}` : ''}`;
}

export default function Message({ message: m, channel, grouped, inThread, highlighted, editing, onEdit, onMarkUnread }: Props) {
  const t = useTranslations('talk');
  const ctx = useTalk();
  const { boot, locale, api, toast, dialog, openThread, patchMessage, personName } = ctx;
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const mine = m.userId === boot.me;
  const canWrite = channel.isMember && !channel.archived;
  const author = m.botName ? m.botName : personName(m.userId);
  const status = m.userId ? ctx.presence.get(m.userId) : undefined;

  useEffect(() => {
    if (highlighted) rowRef.current?.scrollIntoView({ block: 'center' });
  }, [highlighted]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setMenu(false);
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc, true);
    };
  }, [menu]);

  async function act<T>(fn: () => Promise<T>, ok?: string) {
    try {
      const res = await fn();
      if (ok) toast(ok);
      return res;
    } catch (err) {
      toast(errorText(t, err), 'error');
      return null;
    }
  }

  async function react(emoji: string) {
    const updated = await act(() => api<TalkMessageDto>(`/api/talk/messages/${m.id}/reactions`, { method: 'POST', json: { emoji } }));
    if (updated) patchMessage(updated);
  }

  async function toggleSave() {
    await act(() => api(`/api/talk/messages/${m.id}/save`, { method: m.saved ? 'DELETE' : 'POST' }), m.saved ? t('message.unsaved') : t('message.saved'));
    patchMessage({ ...m, saved: !m.saved });
    ctx.refreshBoot();
  }

  async function togglePin() {
    const updated = await act(() => api<TalkMessageDto>(`/api/talk/messages/${m.id}/pin`, { method: m.pinned ? 'DELETE' : 'POST' }), m.pinned ? t('message.unpinned') : t('message.pinnedToast'));
    if (updated) patchMessage(updated);
  }

  if (m.deleted) {
    return (
      <div className={`talk-msg is-deleted${grouped ? ' is-grouped' : ''}`} id={`m-${m.id}`}>
        <div className="talk-msg-gutter">{!grouped && <span className="talk-avatar talk-avatar-ghost" aria-hidden="true" />}</div>
        <div className="talk-msg-main">
          <p className="talk-msg-deleted">{t('message.deleted')}</p>
          {!inThread && m.replyCount > 0 && <ThreadSummary m={m} onOpen={() => openThread(m.id)} />}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={rowRef}
      className={`talk-msg${grouped ? ' is-grouped' : ''}${highlighted ? ' is-highlight' : ''}${m.pinned ? ' is-pinned' : ''}${menu ? ' has-menu' : ''}`}
      id={`m-${m.id}`}
      data-testid="talk-message"
      tabIndex={-1}
    >
      <div className="talk-msg-gutter">
        {grouped ? (
          <time className="talk-msg-time-side" dateTime={m.createdAt} title={fmtFull(m.createdAt, locale)}>
            {fmtTime(m.createdAt, locale)}
          </time>
        ) : m.botName ? (
          <span className="talk-avatar talk-avatar-bot" aria-hidden="true">
            <span className="talk-avatar-initial">{m.botName.slice(0, 1).toUpperCase()}</span>
          </span>
        ) : (
          <Avatar id={m.userId} size={36} />
        )}
      </div>
      <div className="talk-msg-main">
        {m.pinned && <p className="talk-msg-flag">{t('message.pinned')}</p>}
        {!grouped && (
          <div className="talk-msg-head">
            <span className="talk-msg-author">{author}</span>
            {m.botName && <span className="badge badge-outline">{t('message.app')}</span>}
            {status?.statusEmoji && (
              <span className="talk-msg-status" title={status.statusText}>
                {status.statusEmoji}
              </span>
            )}
            <time className="talk-msg-time" dateTime={m.createdAt} title={fmtFull(m.createdAt, locale)}>
              {fmtTime(m.createdAt, locale)}
            </time>
          </div>
        )}
        {m.parentId && m.alsoInChannel && !inThread && (
          <button type="button" className="talk-msg-replied" onClick={() => openThread(m.parentId)}>
            {t('message.repliedToThread')}
          </button>
        )}
        {editing ? (
          <EditBox m={m} onDone={() => onEdit(null)} />
        ) : (
          <>
            {m.body && <MessageBody body={m.body} />}
            {m.editedAt && <span className="talk-msg-edited">{t('message.edited')}</span>}
          </>
        )}
        {m.files.length > 0 && <Files m={m} />}
        {m.refs.length > 0 && <Refs m={m} />}
        {m.unfurls.length > 0 && (
          <div className="talk-unfurls">
            {m.unfurls.map((u) => (
              <a key={u.url} className="talk-unfurl" href={u.url} target="_blank" rel="noopener noreferrer nofollow">
                {u.site && <span className="talk-unfurl-site">{u.site}</span>}
                {u.title && <span className="talk-unfurl-title">{u.title}</span>}
                {u.description && <span className="talk-unfurl-desc">{u.description}</span>}
              </a>
            ))}
          </div>
        )}
        {m.reactions.length > 0 && (
          <div className="talk-reactions">
            {m.reactions.map((r) => (
              <button
                key={r.emoji}
                type="button"
                className={`talk-reaction${r.mine ? ' is-mine' : ''}`}
                aria-pressed={r.mine}
                disabled={!canWrite}
                title={`${r.users.map((u) => personName(u)).join(', ')} · :${emojiName(r.emoji)}:`}
                onClick={() => void react(r.emoji)}
              >
                <span aria-hidden="true">{r.emoji}</span>
                <span className="talk-reaction-count">{r.count}</span>
                <span className="sr-only">{t('message.reactionLabel', { emoji: emojiName(r.emoji), count: r.count })}</span>
              </button>
            ))}
            {canWrite && (
              <button type="button" className="talk-reaction talk-reaction-add" aria-label={t('message.addReaction')} onClick={() => dialog({ kind: 'emoji', onPick: (e) => void react(e) })}>
                +
              </button>
            )}
          </div>
        )}
        {!inThread && m.replyCount > 0 && <ThreadSummary m={m} onOpen={() => openThread(m.id)} />}
      </div>
      {!editing && (
        <div className="talk-msg-actions" role="toolbar" aria-label={t('message.actions')} ref={menuRef}>
          {canWrite &&
            QUICK_REACTIONS.slice(0, 3).map((e) => (
              <button key={e} type="button" className="talk-act" aria-label={t('message.reactWith', { emoji: emojiName(e) })} title={`:${emojiName(e)}:`} onClick={() => void react(e)}>
                {e}
              </button>
            ))}
          {canWrite && (
            <button type="button" className="talk-act" aria-label={t('message.addReaction')} title={t('message.addReaction')} onClick={() => dialog({ kind: 'emoji', onPick: (e) => void react(e) })}>
              ☺
            </button>
          )}
          {!inThread && !m.parentId && (
            <button type="button" className="talk-act" aria-label={t('message.reply')} title={t('message.reply')} onClick={() => openThread(m.id)}>
              ↩
            </button>
          )}
          <button type="button" className="talk-act" aria-label={m.saved ? t('message.unsave') : t('message.save')} title={m.saved ? t('message.unsave') : t('message.save')} aria-pressed={m.saved} onClick={() => void toggleSave()}>
            {m.saved ? '★' : '☆'}
          </button>
          <button type="button" className="talk-act" aria-label={t('message.more')} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
            ⋯
          </button>
          {menu && (
            <div className="talk-menu" role="menu">
              {mine && canWrite && (
                <MenuItem
                  label={t('message.edit')}
                  onClick={() => {
                    setMenu(false);
                    onEdit(m.id);
                  }}
                />
              )}
              <MenuItem
                label={t('message.copyLink')}
                onClick={() => {
                  setMenu(false);
                  void navigator.clipboard?.writeText(messageLink(m, locale)).then(() => toast(t('message.linkCopied')));
                }}
              />
              {!inThread && onMarkUnread && (
                <MenuItem
                  label={t('message.markUnread')}
                  onClick={() => {
                    setMenu(false);
                    onMarkUnread(m);
                  }}
                />
              )}
              <MenuItem
                label={t('message.remind')}
                onClick={() => {
                  setMenu(false);
                  dialog({ kind: 'remind', messageId: m.id });
                }}
              />
              {channel.isMember && (
                <MenuItem
                  label={m.pinned ? t('message.unpin') : t('message.pin')}
                  onClick={() => {
                    setMenu(false);
                    void togglePin();
                  }}
                />
              )}
              <MenuItem
                label={t('message.createIssue')}
                onClick={() => {
                  setMenu(false);
                  dialog({ kind: 'issue', message: m });
                }}
              />
              {(mine || boot.isAdmin) && (
                <MenuItem
                  danger
                  label={t('message.delete')}
                  onClick={() => {
                    setMenu(false);
                    dialog({ kind: 'confirm-delete-message', messageId: m.id });
                  }}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" role="menuitem" className={`talk-menu-item${danger ? ' is-danger' : ''}`} onClick={onClick}>
      {label}
    </button>
  );
}

function ThreadSummary({ m, onOpen }: { m: TalkMessageDto; onOpen: () => void }) {
  const t = useTranslations('talk');
  const { locale } = useTalk();
  return (
    <button type="button" className="talk-thread-summary" onClick={onOpen}>
      <span className="talk-thread-avatars">
        {m.replyUsers.slice(0, 4).map((u) => (
          <Avatar key={u} id={u} size={20} />
        ))}
      </span>
      <span className="talk-thread-count">{t('message.replies', { count: m.replyCount })}</span>
      {m.lastReplyAt && <span className="talk-thread-last">{t('message.lastReply', { when: fmtFull(m.lastReplyAt, locale) })}</span>}
    </button>
  );
}

function Files({ m }: { m: TalkMessageDto }) {
  const t = useTranslations('talk');
  return (
    <div className="talk-files">
      {m.files.map((f) =>
        f.mime.startsWith('image/') && !/svg/.test(f.mime) ? (
          <a key={f.id} className="talk-image" href={f.url} target="_blank" rel="noopener noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={f.url} alt={f.name} loading="lazy" />
          </a>
        ) : (
          <div key={f.id} className="talk-file">
            <span className="talk-file-icon" aria-hidden="true">
              {(f.name.split('.').pop() ?? '').slice(0, 4).toUpperCase() || 'FILE'}
            </span>
            <span className="talk-file-meta">
              <a href={f.url} target="_blank" rel="noopener noreferrer" className="talk-file-name">
                {f.name}
              </a>
              <span className="talk-file-size">{fmtSize(f.size)}</span>
            </span>
            <a className="btn btn-ghost btn-sm" href={`${f.url}?download=1`} aria-label={t('message.download', { name: f.name })}>
              {t('message.downloadShort')}
            </a>
          </div>
        ),
      )}
    </div>
  );
}

function Refs({ m }: { m: TalkMessageDto }) {
  const t = useTranslations('talk');
  const { locale } = useTalk();
  return (
    <div className="talk-refs">
      {m.refs.map((r) => {
        const href = new URL(r.url).pathname;
        if (r.kind === 'issue')
          return (
            <a key={`i-${r.id}`} className="talk-ref" href={href}>
              <span className="talk-ref-kind">{t('refs.issue')}</span>
              <span className="talk-ref-title">
                <span className="data">{r.identifier}</span> {r.title}
              </span>
              <span className="talk-ref-meta">
                {r.status && (
                  <span className="talk-ref-status">
                    <span className="talk-ref-swatch" style={{ background: r.statusColor ?? 'var(--brand-gray-3)' }} />
                    {r.status}
                  </span>
                )}
                <span>{t(`refs.priority.${r.priority}`)}</span>
                {r.assignee && <span>{r.assignee}</span>}
              </span>
            </a>
          );
        if (r.kind === 'deal')
          return (
            <a key={`d-${r.id}`} className="talk-ref" href={href}>
              <span className="talk-ref-kind">{t('refs.deal')}</span>
              <span className="talk-ref-title">{r.name}</span>
              <span className="talk-ref-meta">
                <span className="num">{new Intl.NumberFormat(locale, { style: 'currency', currency: r.currency || 'USD', maximumFractionDigits: 0 }).format(r.amount)}</span>
                {r.stage && <span>{r.stage}</span>}
                {r.closeDate && <span>{t('refs.closes', { date: r.closeDate.slice(0, 10) })}</span>}
              </span>
            </a>
          );
        return (
          <a key={`p-${r.id}`} className="talk-ref" href={href}>
            <span className="talk-ref-kind">{t('refs.doc')}</span>
            <span className="talk-ref-title">
              {r.icon && !r.icon.startsWith('/') && !r.icon.startsWith('http') ? `${r.icon} ` : ''}
              {r.title}
            </span>
          </a>
        );
      })}
    </div>
  );
}

function EditBox({ m, onDone }: { m: TalkMessageDto; onDone: () => void }) {
  const t = useTranslations('talk');
  const ctx = useTalk();
  const names = { user: (id: string) => ctx.personName(id), channel: (id: string) => ctx.channelById.get(id)?.name, group: (id: string) => ctx.boot.groups.find((g) => g.id === id)?.handle };
  const [initial] = useState(() => decodeMentions(m.body, names));
  const [text, setText] = useState(initial.text);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    el.style.height = `${Math.min(el.scrollHeight, 280)}px`;
  }, []);
  async function save() {
    if (busy) return;
    const body = encodeMentions(text, { users: initial.users, groups: initial.groups, channels: initial.channels });
    if (body === m.body) return onDone();
    if (!body.trim() && m.files.length === 0) {
      ctx.dialog({ kind: 'confirm-delete-message', messageId: m.id });
      return onDone();
    }
    setBusy(true);
    try {
      const updated = await ctx.api<TalkMessageDto>(`/api/talk/messages/${m.id}`, { method: 'PATCH', json: { body } });
      ctx.patchMessage(updated);
      onDone();
    } catch (err) {
      ctx.toast(errorText(t, err), 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="talk-edit">
      <textarea
        ref={ref}
        className="talk-input"
        value={text}
        aria-label={t('message.editLabel')}
        onChange={(e) => {
          setText(e.target.value);
          e.target.style.height = 'auto';
          e.target.style.height = `${Math.min(e.target.scrollHeight, 280)}px`;
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onDone();
          }
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void save();
          }
        }}
      />
      <div className="talk-edit-foot">
        <span className="talk-hint">{t('message.editHint')}</span>
        <button type="button" className="btn btn-sm" onClick={onDone}>
          {t('common.cancel')}
        </button>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void save()}>
          {t('common.save')}
        </button>
      </div>
    </div>
  );
}
