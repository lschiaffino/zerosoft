'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import type { TalkChannelDto } from '@/lib/talk';
import type { TalkBookmarkDto } from '@/lib/talk-bookmarks';
import { errorText } from './Composer';
import { Modal } from './Dialogs';
import { useTalk } from './talk-context';

type Popover = { top: number; left: number };

/** Flechas, Home y End entre los elementos enfocables de un menú. */
function moveFocus(e: ReactKeyboardEvent<HTMLElement>, selector: string) {
  const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
  if (!keys.includes(e.key)) return;
  e.preventDefault();
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>(selector)];
  if (!items.length) return;
  const at = items.indexOf(document.activeElement as HTMLElement);
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : e.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
  items[next].focus();
}

/** Ubica un menú fijo debajo del botón y dentro de la pantalla. */
function below(el: HTMLElement, width: number): Popover {
  const r = el.getBoundingClientRect();
  return { top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)) };
}

/** Barra de marcadores del canal: los links que el equipo quiere tener a mano. */
export default function BookmarksBar({ channel }: { channel: TalkChannelDto }) {
  const t = useTranslations('talk');
  const { api, subscribe, toast } = useTalk();
  const [items, setItems] = useState<TalkBookmarkDto[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<{ bookmark: TalkBookmarkDto | null } | null>(null);
  const [removing, setRemoving] = useState<TalkBookmarkDto | null>(null);
  const [menu, setMenu] = useState<(Popover & { id: string }) | null>(null);
  const [more, setMore] = useState<Popover | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const canEdit = channel.isMember && !channel.archived && !channel.deactivated;
  const listRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const overflowRef = useRef<HTMLDivElement>(null);
  // Solo vale la última carga: la de un canal anterior que llega tarde se descarta.
  const loadSeq = useRef(0);

  const load = useCallback(() => {
    const seq = ++loadSeq.current;
    setFailed(false);
    return api<{ bookmarks: TalkBookmarkDto[] }>(`/api/talk/channels/${channel.id}/bookmarks`)
      .then((r) => {
        if (seq === loadSeq.current) setItems(r.bookmarks);
      })
      .catch(() => {
        if (seq === loadSeq.current) setFailed(true);
      });
  }, [api, channel.id]);

  useEffect(() => {
    setItems(null);
    setMenu(null);
    setMore(null);
    void load();
  }, [load]);

  useEffect(
    () =>
      subscribe((ev) => {
        if (ev.type === 'events' && ev.events.some((e) => e.kind === 'bookmark' && e.channelId === channel.id)) void load();
      }),
    [subscribe, channel.id, load],
  );

  // Los que no entran en la fila (la lista corta el renglón) van al menú "Más".
  const measure = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const els = [...list.querySelectorAll<HTMLElement>('[data-bookmark-id]')];
    const top = els[0]?.offsetTop ?? 0;
    const next = new Set(els.filter((el) => el.offsetTop > top).map((el) => el.dataset.bookmarkId!));
    setHidden((prev) => (prev.size === next.size && [...next].every((id) => prev.has(id)) ? prev : next));
  }, []);
  useLayoutEffect(measure, [measure, items]);
  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(list);
    return () => ro.disconnect();
  }, [measure, items === null]); // eslint-disable-line react-hooks/exhaustive-deps

  // Al abrir "Más", el foco va al primer marcador (una sola vez: después no se le roba al menú de opciones).
  const moreOpen = !!more;
  useEffect(() => {
    if (moreOpen) overflowRef.current?.querySelector<HTMLElement>('a')?.focus();
  }, [moreOpen]);
  // Si con el nuevo ancho entran todos, "Más" desaparece: el menú se cierra y el foco no queda en el aire.
  const extrasCount = items ? items.filter((b) => hidden.has(b.id)).length : 0;
  useEffect(() => {
    if (extrasCount > 0 || !more) return;
    const inside = !!(document.activeElement as HTMLElement | null)?.closest?.('.talk-bookmark-overflow');
    setMore(null);
    setMenu(null);
    if (inside) listRef.current?.querySelector<HTMLElement>('a')?.focus();
  }, [extrasCount, more]);

  // Esc o un clic afuera cierran; Esc devuelve el foco al botón que abrió.
  const open = !!menu || !!more;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setMenu((m) => {
        if (!m) setMore(null);
        return null;
      });
      returnFocus.current?.focus();
    };
    // Al cambiar el ancho los menús quedarían donde estaba el botón: se cierran, y si el foco
    // estaba adentro vuelve al botón que los abrió (no se pierde en el body).
    const onResize = () => {
      const inside = (document.activeElement as HTMLElement | null)?.closest?.('.talk-bookmark-menu, .talk-bookmark-overflow');
      setMenu(null);
      setMore(null);
      if (!inside) return;
      // El botón de un marcador dentro de "Más" ya no está: el foco vuelve a "Más".
      const back = returnFocus.current?.closest('.talk-bookmark-overflow') ? moreBtnRef.current : returnFocus.current;
      back?.focus();
    };
    const onDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest?.('.talk-bookmark-menu, .talk-bookmark-more, .talk-bookmark-overflow, .talk-bookmark-more-btn')) return;
      setMenu(null);
      setMore(null);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

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

  const extras = items.filter((b) => hidden.has(b.id));
  const row = (b: TalkBookmarkDto, measured: boolean) => (
    <span key={b.id} className={`talk-bookmark${measured && hidden.has(b.id) ? ' is-overflow' : ''}`} {...(measured ? { 'data-bookmark-id': b.id } : {})}>
      <a href={b.url} target="_blank" rel="noopener noreferrer" className="talk-bookmark-link" title={b.url}>
        {b.title}
      </a>
      {canEdit && (
        <button
          type="button"
          className="talk-bookmark-more"
          aria-label={t('bookmarks.options', { name: b.title })}
          aria-haspopup="menu"
          aria-expanded={menu?.id === b.id}
          onClick={(e) => {
            returnFocus.current = e.currentTarget;
            const at = below(e.currentTarget, 140);
            setMenu((m) => (m?.id === b.id ? null : { id: b.id, ...at }));
          }}
        >
          ⋯
        </button>
      )}
    </span>
  );
  const menuFor = menu && items.find((b) => b.id === menu.id);

  return (
    <div className="talk-bookmarks" role="region" aria-label={t('bookmarks.title')} data-testid="talk-bookmarks">
      <div className="talk-bookmarks-list" ref={listRef}>
        {items.map((b) => row(b, true))}
      </div>
      {extras.length > 0 && (
        <button
          type="button"
          ref={moreBtnRef}
          className="btn btn-ghost btn-sm talk-bookmark-more-btn"
          aria-label={t('bookmarks.moreLabel')}
          aria-haspopup="true"
          aria-expanded={!!more}
          onClick={(e) => {
            returnFocus.current = e.currentTarget;
            const at = below(e.currentTarget, 240);
            setMenu(null);
            setMore((m) => (m ? null : at));
          }}
          data-testid="talk-bookmark-overflow-btn"
        >
          {t('bookmarks.more', { count: extras.length })}
        </button>
      )}
      {canEdit && (
        <button type="button" className="btn btn-ghost btn-sm talk-bookmark-add" onClick={() => setEditing({ bookmark: null })} data-testid="talk-bookmark-add">
          {items.length ? t('bookmarks.addShort') : t('bookmarks.addFirst')}
        </button>
      )}
      {more && extras.length > 0 && (
        <div
          className="talk-bookmark-overflow"
          style={{ top: more.top, left: more.left }}
          data-testid="talk-bookmark-overflow"
          ref={overflowRef}
          role="group"
          aria-label={t('bookmarks.moreLabel')}
          onKeyDown={(e) => moveFocus(e, 'a, button')}
          onBlur={(e) => {
            // Tab fuera del menú lo cierra; pasar al menú de opciones de un marcador no.
            const to = e.relatedTarget as HTMLElement | null;
            if (to && !e.currentTarget.contains(to) && !to.closest('.talk-bookmark-menu, .talk-bookmark-more-btn')) {
              setMore(null);
              setMenu(null);
            }
          }}
        >
          {extras.map((b) => row(b, false))}
        </div>
      )}
      {menu && menuFor && (
        <div
          className="talk-bookmark-menu"
          role="menu"
          style={{ top: menu.top, left: menu.left }}
          onKeyDown={(e) => moveFocus(e, '[role="menuitem"]')}
        >
          <button
            type="button"
            role="menuitem"
            autoFocus
            onClick={() => {
              setMenu(null);
              setMore(null);
              setEditing({ bookmark: menuFor });
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
              setMore(null);
              setRemoving(menuFor);
            }}
          >
            {t('bookmarks.delete')}
          </button>
        </div>
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
