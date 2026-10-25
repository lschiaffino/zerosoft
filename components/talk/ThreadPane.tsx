'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { TalkChannelDto, TalkMessageDto } from '@/lib/talk';
import Composer, { errorText } from './Composer';
import Message from './Message';
import { TypingLine, isGrouped } from './ChannelPane';
import { draftKey, useTalk } from './talk-context';

export default function ThreadPane({ rootId, channel, onClose }: { rootId: string; channel: TalkChannelDto | null; onClose: () => void }) {
  const t = useTranslations('talk');
  const ctx = useTalk();
  const { api, subscribe, toast, drafts, setDraft, channelTitle } = ctx;
  const [root, setRoot] = useState<TalkMessageDto | null>(null);
  const [replies, setReplies] = useState<TalkMessageDto[]>([]);
  const [following, setFollowing] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [editing, setEditing] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const ref = useRef<HTMLElement>(null);

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setState('loading');
      try {
        const res = await api<{ root: TalkMessageDto; replies: TalkMessageDto[]; following: boolean }>(`/api/talk/messages/${rootId}`);
        const el = listRef.current;
        stick.current = !quiet || (!!el && el.scrollHeight - el.scrollTop - el.clientHeight < 120);
        setRoot(res.root);
        setReplies(res.replies);
        setFollowing(res.following);
        setState('ready');
        if (res.following) void api(`/api/talk/messages/${rootId}`, { method: 'PATCH', json: { read: true } }).catch(() => undefined);
      } catch {
        setState('error');
      }
    },
    [api, rootId],
  );

  useEffect(() => {
    setEditing(null);
    void load();
  }, [load]);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [replies, state]);

  useEffect(
    () =>
      subscribe((e) => {
        if (e.type === 'patch') {
          if (e.message.id === rootId) setRoot(e.message);
          else if (e.message.parentId === rootId) setReplies((prev) => prev.map((r) => (r.id === e.message.id ? e.message : r)));
          return;
        }
        if (e.type === 'remove') {
          setReplies((prev) => prev.filter((r) => r.id !== e.id));
          return;
        }
        const touched = e.events.some((ev) => {
          if (ev.kind !== 'message' && ev.kind !== 'reaction') return false;
          const p = ev.payload as { id?: string; parentId?: string | null };
          return p.id === rootId || p.parentId === rootId;
        });
        if (touched) void load(true);
      }),
    [subscribe, rootId, load],
  );

  // Esc cierra el hilo (si no hay un modal o un editor abierto).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('dialog[open]')) return;
      if (!ref.current?.contains(document.activeElement)) return;
      onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function toggleFollow() {
    try {
      await api(`/api/talk/messages/${rootId}`, { method: 'PATCH', json: { follow: !following } });
      setFollowing(!following);
      toast(following ? t('thread.unfollowed') : t('thread.followed'));
    } catch (err) {
      toast(errorText(t, err), 'error');
    }
  }

  const where = channel ? (channel.kind === 'public' || channel.kind === 'private' ? `#${channel.name}` : channelTitle(channel)) : '';

  return (
    <aside className="talk-pane talk-thread" ref={ref} aria-label={t('thread.title')}>
      <header className="talk-head">
        <div className="talk-head-main">
          <h2 className="talk-head-title">{t('thread.title')}</h2>
          {where && <span className="talk-head-topic is-static">{where}</span>}
        </div>
        <div className="talk-head-actions">
          {state === 'ready' && (
            <button type="button" className="btn btn-ghost btn-sm" aria-pressed={following} onClick={() => void toggleFollow()}>
              {following ? t('thread.following') : t('thread.follow')}
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={t('thread.close')} title={t('thread.close')} onClick={onClose}>
            ×
          </button>
        </div>
      </header>
      <div className="talk-scroll" ref={listRef}>
        {state === 'loading' && (
          <div className="ui-loading-stack talk-loading" aria-busy="true" aria-label={t('common.loading')}>
            <div className="ui-skeleton ui-skeleton-row" />
            <div className="ui-skeleton ui-skeleton-row" />
          </div>
        )}
        {state === 'error' && (
          <div className="talk-error" role="alert">
            <p>{t('errors.loadThread')}</p>
            <button type="button" className="btn btn-sm" onClick={() => void load()}>
              {t('common.retry')}
            </button>
          </div>
        )}
        {state === 'ready' && root && channel && (
          <>
            <Message message={root} channel={channel} inThread editing={editing === root.id} onEdit={setEditing} />
            <div className="talk-day" role="separator">
              <span>{t('message.replies', { count: replies.length })}</span>
            </div>
            {replies.map((r, i) => (
              <Message key={r.id} message={r} channel={channel} inThread grouped={isGrouped(replies[i - 1], r)} editing={editing === r.id} onEdit={setEditing} />
            ))}
          </>
        )}
      </div>
      {channel && <TypingLine channelId={channel.id} parentId={rootId} />}
      {state === 'ready' && channel && channel.isMember && !channel.archived && (
        <Composer
          key={rootId}
          channel={channel}
          parentId={rootId}
          compact
          focusKey={rootId}
          initialDraft={drafts.get(draftKey(channel.id, rootId)) ?? ''}
          onDraftChange={(b) => setDraft(channel.id, rootId, b)}
          onSent={(m) => {
            stick.current = true;
            setReplies((prev) => (prev.some((r) => r.id === m.id) ? prev : [...prev, m]));
            setFollowing(true);
          }}
          onEditLast={() => {
            const own = [...replies].reverse().find((r) => r.userId === ctx.boot.me && !r.deleted);
            if (own) setEditing(own.id);
          }}
        />
      )}
    </aside>
  );
}
