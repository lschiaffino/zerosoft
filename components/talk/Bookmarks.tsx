'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { TalkChannelDto } from '@/lib/talk';
import type { TalkBookmarkDto } from '@/lib/talk-bookmarks';
import { errorText } from './Composer';
import { Modal } from './Dialogs';
import { useTalk } from './talk-context';

/** Barra de marcadores del canal: los links que el equipo quiere tener a mano. */
export default function BookmarksBar({ channel }: { channel: TalkChannelDto }) {
  const t = useTranslations('talk');
  const { api, subscribe, toast } = useTalk();
  const [items, setItems] = useState<TalkBookmarkDto[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<{ bookmark: TalkBookmarkDto | null } | null>(null);
  const [removing, setRemoving] = useState<TalkBookmarkDto | null>(null);
  const [menu, setMenu] = useState<{ id: string; top: number; left: number } | null>(null);
  const canEdit = channel.isMember && !channel.archived && !channel.deactivated;

  const load = useCallback(() => {
    setFailed(false);
    return api<{ bookmarks: TalkBookmarkDto[] }>(`/api/talk/channels/${channel.id}/bookmarks`)
      .then((r) => setItems(r.bookmarks))
      .catch(() => setFailed(true));
  }, [api, channel.id]);

  useEffect(() => {
    setItems(null);
    setMenu(null);
    void load();
  }, [load]);

  useEffect(
    () =>
      subscribe((ev) => {
        if (ev.type === 'events' && ev.events.some((e) => e.kind === 'bookmark' && e.channelId === channel.id)) void load();
      }),
    [subscribe, channel.id, load],
  );

  // Esc o un clic afuera cierran el menú abierto.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setMenu(null);
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest?.('.talk-bookmark-menu, .talk-bookmark-more')) setMenu(null);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onDown);
    };
  }, [menu]);

  async function remove(b: TalkBookmarkDto) {
    try {
      await api(`/api/talk/channels/${channel.id}/bookmarks?bookmarkId=${encodeURIComponent(b.id)}`, { method: 'DELETE' });
      setItems((prev) => prev?.filter((x) => x.id !== b.id) ?? prev);
      setRemoving(null);
      toast(t('bookmarks.deleted'));
    } catch (err) {
      toast(errorText(t, err), 'error');
    }
  }

  if (failed) {
    return (
      <div className="talk-bookmarks" role="alert">
        <span className="talk-muted">{t('bookmarks.loadError')}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load()}>
          {t('common.retry')}
        </button>
      </div>
    );
  }
  if (items === null) return <div className="talk-bookmarks" aria-busy="true" aria-label={t('common.loading')} />;
  if (!items.length && !canEdit) return null;

  return (
    <div className="talk-bookmarks" role="region" aria-label={t('bookmarks.title')} data-testid="talk-bookmarks">
      {items.map((b) => (
        <span key={b.id} className="talk-bookmark">
          <a href={b.url} target="_blank" rel="noopener noreferrer" className="talk-bookmark-link" title={b.url}>
            {b.title}
          </a>
          {canEdit && (
            <button
              type="button"
              className="talk-bookmark-more"
              aria-label={t('bookmarks.options', { name: b.title })}
              aria-expanded={menu?.id === b.id}
              onClick={(e) => {
                // La barra corre de costado: el menú se ubica fijo, debajo del botón y dentro de la pantalla.
                const r = e.currentTarget.getBoundingClientRect();
                setMenu((m) => (m?.id === b.id ? null : { id: b.id, top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 148)) }));
              }}
            >
              ⋯
            </button>
          )}
          {menu?.id === b.id && (
            <span className="talk-bookmark-menu" role="menu" style={{ top: menu.top, left: menu.left }}>
              <button
                type="button"
                role="menuitem"
                autoFocus
                onClick={() => {
                  setMenu(null);
                  setEditing({ bookmark: b });
                }}
              >
                {t('bookmarks.edit')}
              </button>
              <button
                type="button"
                role="menuitem"
                className="is-danger"
                onClick={() => {
                  setMenu(null);
                  setRemoving(b);
                }}
              >
                {t('bookmarks.delete')}
              </button>
            </span>
          )}
        </span>
      ))}
      {canEdit && (
        <button type="button" className="btn btn-ghost btn-sm talk-bookmark-add" onClick={() => setEditing({ bookmark: null })} data-testid="talk-bookmark-add">
          {items.length ? t('bookmarks.addShort') : t('bookmarks.addFirst')}
        </button>
      )}
      {editing && (
        <BookmarkDialog
          channelId={channel.id}
          bookmark={editing.bookmark}
          onClose={() => setEditing(null)}
          onSaved={(b) => {
            setItems((prev) => (prev?.some((x) => x.id === b.id) ? prev.map((x) => (x.id === b.id ? b : x)) : [...(prev ?? []), b]));
            setEditing(null);
          }}
        />
      )}
      {removing && (
        <Modal
          title={t('bookmarks.deleteTitle')}
          onClose={() => setRemoving(null)}
          foot={
            <>
              <button type="button" className="btn btn-sm" onClick={() => setRemoving(null)}>
                {t('common.cancel')}
              </button>
              <button type="button" className="btn btn-danger btn-sm" autoFocus onClick={() => void remove(removing)} data-testid="talk-bookmark-confirm-delete">
                {t('bookmarks.delete')}
              </button>
            </>
          }
        >
          <p>{t('bookmarks.deleteBody', { name: removing.title })}</p>
        </Modal>
      )}
    </div>
  );
}

function BookmarkDialog({ channelId, bookmark, onClose, onSaved }: { channelId: string; bookmark: TalkBookmarkDto | null; onClose: () => void; onSaved: (b: TalkBookmarkDto) => void }) {
  const t = useTranslations('talk');
  const { api } = useTalk();
  const [url, setUrl] = useState(bookmark?.url ?? '');
  const [title, setTitle] = useState(bookmark?.title ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy || !url.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const saved = bookmark
        ? await api<TalkBookmarkDto>(`/api/talk/channels/${channelId}/bookmarks`, { method: 'PATCH', json: { bookmarkId: bookmark.id, url, title } })
        : await api<TalkBookmarkDto>(`/api/talk/channels/${channelId}/bookmarks`, { method: 'POST', json: { url, title } });
      onSaved(saved);
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={bookmark ? t('bookmarks.editTitle') : t('bookmarks.addTitle')}
      onClose={onClose}
      foot={
        <>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="talk-bookmark-form" className="btn btn-primary btn-sm" disabled={busy || !url.trim()} data-testid="talk-bookmark-save">
            {t('common.save')}
          </button>
        </>
      }
    >
      <form
        id="talk-bookmark-form"
        className="ui-fields"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="ui-field">
          <span className="label">{t('bookmarks.url')}</span>
          <input className="input" value={url} autoFocus maxLength={2000} placeholder="https://" inputMode="url" onChange={(e) => setUrl(e.target.value)} data-testid="talk-bookmark-url" />
        </label>
        <label className="ui-field">
          <span className="label">{t('bookmarks.name')}</span>
          <input className="input" value={title} maxLength={120} placeholder={t('bookmarks.namePlaceholder')} onChange={(e) => setTitle(e.target.value)} data-testid="talk-bookmark-name" />
        </label>
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
