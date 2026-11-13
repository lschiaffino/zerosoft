'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { MessageMenu } from './Menu';
import { Chevron, Plus } from './icons';

/** Un sticker de la colección (lo que devuelve /api/<app>/stickers; ver lib/wa-stickers.ts). */
export interface StickerItem {
  id: string;
  url: string;
  animated: boolean;
  favorite: boolean;
  usedAt: string | null;
  createdAt: string;
}

/** Lo que el panel de emojis necesita para mostrar la pestaña de stickers. */
export interface StickerTab {
  /** /api/groups/stickers (Lines) o /api/inbox/stickers (Inbox). */
  api: string;
  /** Mandar al chat abierto. true si salió (pasa a recientes). */
  onSend: (s: StickerItem) => Promise<boolean>;
}

const RECENT_MAX = 16;

async function call<T>(api: string, init?: RequestInit): Promise<{ data: T | null; error: string }> {
  try {
    const res = await fetch(api, init);
    const json = (await res.json().catch(() => ({}))) as T & { error?: string };
    return res.ok ? { data: json, error: '' } : { data: null, error: json.error || 'server_error' };
  } catch {
    return { data: null, error: 'network' };
  }
}

const post = <T,>(api: string, body: Record<string, unknown>) =>
  call<T>(api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/**
 * Pestaña Stickers del panel de emojis, como en WhatsApp Web: recientes,
 * favoritos y la colección de la persona; un clic lo manda. WhatsApp no deja
 * leer los stickers guardados de la cuenta, así que la colección se arma con
 * los stickers de sus chats ("Importar stickers de mis chats", y después se
 * mantiene sola) y con los que crea desde una imagen.
 */
export default function StickerPanel({ api, onSend }: StickerTab) {
  const t = useTranslations('groups.wa.stickers');
  const [items, setItems] = useState<StickerItem[] | null>(null);
  const [imported, setImported] = useState(false);
  const [busy, setBusy] = useState<'' | 'import' | 'create'>('');
  const [found, setFound] = useState(0);
  const [error, setError] = useState('');
  const [sending, setSending] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const alive = useRef(true);

  const load = useCallback(async () => {
    const r = await call<{ stickers: StickerItem[]; imported: boolean }>(api);
    if (!alive.current) return;
    if (!r.data) {
      setError(t('loadFailed'));
      setItems((prev) => prev ?? []);
      return;
    }
    setItems(r.data.stickers);
    setImported(r.data.imported);
  }, [api, t]);

  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  async function importFromChats() {
    setBusy('import');
    setError('');
    setFound(0);
    let total = 0;
    // Por tandas: el servidor trae unas decenas por pedido.
    for (let i = 0; i < 30 && alive.current; i++) {
      const r = await post<{ added: number; more: boolean; stickers: StickerItem[] }>(api, { action: 'import' });
      if (!r.data) {
        setError(t('importFailed'));
        break;
      }
      total += r.data.added;
      setFound(total);
      setItems(r.data.stickers);
      setImported(true);
      if (!r.data.more) break;
    }
    if (alive.current) setBusy('');
  }

  async function create(file: File) {
    setBusy('create');
    setError('');
    const form = new FormData();
    form.append('file', file);
    const r = await call<{ sticker: StickerItem }>(api, { method: 'POST', body: form });
    if (!alive.current) return;
    setBusy('');
    if (!r.data) {
      setError(r.error === 'sticker_too_large' ? t('tooLarge') : r.error === 'sticker_convert_unavailable' ? t('convertUnavailable') : t('createFailed'));
      return;
    }
    const s = r.data.sticker;
    setItems((prev) => [s, ...(prev ?? []).filter((x) => x.id !== s.id)]);
  }

  async function send(s: StickerItem) {
    if (sending) return;
    setSending(s.id);
    setError('');
    const ok = await onSend(s);
    if (!alive.current) return;
    setSending('');
    if (ok) setItems((prev) => (prev ?? []).map((x) => (x.id === s.id ? { ...x, usedAt: new Date().toISOString() } : x)));
  }

  async function favorite(s: StickerItem, on: boolean) {
    setItems((prev) => (prev ?? []).map((x) => (x.id === s.id ? { ...x, favorite: on } : x)));
    const r = await post(api, { action: 'favorite', id: s.id, favorite: on });
    if (!r.data && alive.current) {
      setItems((prev) => (prev ?? []).map((x) => (x.id === s.id ? { ...x, favorite: !on } : x)));
      setError(t('saveFailed'));
    }
  }

  async function remove(s: StickerItem) {
    const before = items;
    setItems((prev) => (prev ?? []).filter((x) => x.id !== s.id));
    const r = await post(api, { action: 'remove', id: s.id });
    if (!r.data && alive.current) {
      setItems(before);
      setError(t('saveFailed'));
    }
  }

  const sections = useMemo(() => {
    const list = items ?? [];
    const recent = list
      .filter((s) => s.usedAt)
      .sort((a, b) => String(b.usedAt).localeCompare(String(a.usedAt)))
      .slice(0, RECENT_MAX);
    return [
      { key: 'recent', title: t('recent'), list: recent },
      { key: 'favorites', title: t('favorites'), list: list.filter((s) => s.favorite) },
      { key: 'all', title: t('all'), list },
    ].filter((s) => s.list.length > 0);
  }, [items, t]);

  const tile = (s: StickerItem, section: string) => (
    <div key={`${section}-${s.id}`} className="wa-stk" data-sticker={s.id}>
      <button type="button" className="wa-stk-send" onClick={() => void send(s)} aria-label={t('send')} title={t('send')} aria-busy={sending === s.id || undefined} disabled={!!sending && sending !== s.id}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={s.url} alt="" loading="lazy" draggable={false} />
        {s.favorite && <span className="wa-stk-star" aria-hidden="true">★</span>}
      </button>
      <MessageMenu
        label={t('options')}
        className="wa-stk-more"
        trigger={<Chevron size={14} />}
        items={[
          { key: 'fav', label: s.favorite ? t('removeFavorite') : t('addFavorite'), onSelect: () => void favorite(s, !s.favorite) },
          { key: 'remove', label: t('remove'), onSelect: () => void remove(s), danger: true },
        ]}
      />
    </div>
  );

  return (
    <div className="wa-stk-panel">
      <div className="wa-stk-actions">
        <button type="button" className="wa-stk-action" onClick={() => fileRef.current?.click()} disabled={!!busy} aria-busy={busy === 'create' || undefined}>
          <Plus size={16} /> {busy === 'create' ? t('creating') : t('create')}
        </button>
        {!imported && (items?.length ?? 0) > 0 && (
          <button type="button" className="wa-stk-action" onClick={() => void importFromChats()} disabled={!!busy} aria-busy={busy === 'import' || undefined}>
            {busy === 'import' ? t('importing', { n: found }) : t('import')}
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void create(f);
          }}
        />
      </div>
      {error && (
        <p className="wa-stk-error" role="alert">
          {error}
        </p>
      )}
      <div className="wa-stk-scroll">
        {items === null ? (
          <div className="wa-stk-grid" aria-busy="true" aria-label={t('loading')}>
            {Array.from({ length: 8 }, (_, i) => (
              <span key={i} className="wa-stk-skel" />
            ))}
          </div>
        ) : sections.length === 0 ? (
          <div className="wa-stk-empty">
            <p className="wa-stk-empty-title">{t('emptyTitle')}</p>
            <p>{t('emptyBody')}</p>
            <button type="button" className="wa-stk-primary" onClick={() => void importFromChats()} disabled={!!busy} aria-busy={busy === 'import' || undefined}>
              {busy === 'import' ? t('importing', { n: found }) : t('import')}
            </button>
            {imported && busy !== 'import' && <p className="wa-stk-note">{t('noneFound')}</p>}
          </div>
        ) : (
          sections.map((sec) => (
            <section key={sec.key} aria-label={sec.title}>
              <p className="wa-emoji-title">{sec.title}</p>
              <div className="wa-stk-grid">{sec.list.map((s) => tile(s, sec.key))}</div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
