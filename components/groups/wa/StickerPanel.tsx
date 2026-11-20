'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { MessageMenu } from './Menu';
import { Chevron, Plus } from './icons';
import { stickerSections, type SectionKey } from '@/lib/wa-sticker-sections';

/** Un sticker de la colección (lo que devuelve /api/<app>/stickers; ver lib/wa-stickers.ts). */
export interface StickerItem {
  id: string;
  url: string;
  animated: boolean;
  favorite: boolean;
  width?: number | null;
  height?: number | null;
  /** Última vez que la persona lo mandó desde esta línea (desde acá o desde el teléfono). null: solo lo recibió. */
  usedAt: string | null;
  /** Lo creó ella desde una imagen. */
  created?: boolean;
  createdAt: string;
}

/** Lo que el panel de emojis necesita para mostrar la pestaña de stickers. */
export interface StickerTab {
  /** /api/groups/stickers (Lines) o /api/inbox/stickers (Inbox). */
  api: string;
  /** La línea del chat abierto (Lines: el número; Inbox: la cuenta de WhatsApp): el panel muestra los stickers de esa. */
  line: string;
  /** Mandar al chat abierto. true si salió (pasa a recientes). */
  onSend: (s: StickerItem) => Promise<boolean>;
}

/**
 * Cuántos de cada sección se dibujan de entrada (y cuántos suma "Ver más"): una colección grande no arma cientos de
 * imágenes al abrir. Los recientes, como en WhatsApp, son pocos a la vista.
 */
const PAGE: Record<SectionKey, number> = { recent: 24, favorites: 60, created: 60, chats: 60 };
/** Cada cuánto, como mucho, el panel pide lo que llegó a los chats de una línea (abrir y cerrar seguido no lo repite). */
const CATCH_UP_MS = 45_000;

/**
 * Lo último que se vio de cada línea, mientras dure la página: volver a abrir el
 * panel (o volver a un chat de esa línea) lo dibuja en el acto y se revalida
 * por detrás. Por línea: nunca se muestra lo de otra.
 */
const seen = new Map<string, { items: StickerItem[]; imported: boolean }>();
/** Cuándo se pidió por última vez lo que llegó a los chats de cada línea. */
const caughtUp = new Map<string, number>();
const lineUrl = (api: string, line: string) => `${api}?line=${encodeURIComponent(line)}`;

async function call<T>(api: string, init?: RequestInit): Promise<{ data: T | null; error: string }> {
  try {
    const res = await fetch(api, init);
    const json = (await res.json().catch(() => ({}))) as T & { error?: string };
    return res.ok ? { data: json, error: '' } : { data: null, error: json.error || 'server_error' };
  } catch {
    return { data: null, error: 'network' };
  }
}

/** Crea un sticker desde una imagen ("Sticker nuevo" del menú + y "Crear" de la pestaña). */
export async function createSticker(api: string, line: string, file: File): Promise<{ sticker: StickerItem | null; error: string }> {
  const form = new FormData();
  form.append('line', line);
  form.append('file', file);
  const r = await call<{ sticker: StickerItem }>(api, { method: 'POST', body: form });
  const sticker = r.data?.sticker ?? null;
  if (sticker) {
    const key = lineUrl(api, line);
    const hit = seen.get(key);
    if (hit) seen.set(key, { ...hit, items: [sticker, ...hit.items.filter((x) => x.id !== sticker.id)] });
  }
  return { sticker, error: sticker ? '' : r.error || 'server_error' };
}

const post = <T,>(api: string, body: Record<string, unknown>) =>
  call<T>(api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/**
 * Pestaña Stickers del panel de emojis, como en WhatsApp Web: lo suyo en la
 * línea del chat abierto (recientes, favoritos, creados) y, plegado, lo que
 * recibió en sus chats (stickerSections); un clic lo manda. WhatsApp no deja leer los stickers guardados de la cuenta, así que
 * la colección se arma con los stickers de los chats de esa línea y con los
 * que crea desde una imagen.
 *
 * Rápido: la lista sale de la base y se dibuja en el acto (o antes, de lo ya
 * visto en esta página). Traer lo que llegó a los chats va después, en otro
 * pedido y por tandas, y la grilla se va llenando; nunca se espera eso para ver
 * lo que ya hay. Quien lo usa lo monta con `key` por línea (EmojiPicker).
 */
export default function StickerPanel({ api, line, onSend }: StickerTab) {
  const t = useTranslations('groups.wa.stickers');
  const key = lineUrl(api, line);
  const [items, setItems] = useState<StickerItem[] | null>(() => seen.get(key)?.items ?? null);
  const [imported, setImported] = useState(() => seen.get(key)?.imported ?? false);
  const [busy, setBusy] = useState<'' | 'import' | 'create'>('');
  const [found, setFound] = useState(0);
  const [error, setError] = useState('');
  const [sending, setSending] = useState('');
  const [more, setMore] = useState<Partial<Record<SectionKey, number>>>({});
  // "De tus chats" empieza plegado: lo que solo recibió no tapa lo suyo.
  const [chatsOpen, setChatsOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const foldId = useId();
  const alive = useRef(true);
  const syncing = useRef(false);

  // Lo que se ve queda recordado para la próxima vez que se abra esta línea.
  useEffect(() => {
    if (items) seen.set(key, { items, imported });
  }, [key, items, imported]);

  /**
   * Trae lo que llegó a los chats de la línea desde la última vez, por tandas (el servidor trae unas decenas por
   * pedido) y la grilla se va llenando. `quiet`: por detrás al abrir, sin tapar nada; un error ahí no se muestra
   * (lo que hay ya está a la vista y se vuelve a pedir la próxima vez).
   */
  async function importFromChats(quiet = false) {
    if (syncing.current) return;
    syncing.current = true;
    if (!quiet) {
      setBusy('import');
      setError('');
      setFound(0);
    }
    let total = 0;
    for (let i = 0; i < 40 && alive.current; i++) {
      const r = await post<{ added: number; more: boolean; stickers: StickerItem[] }>(api, { action: 'import', line });
      if (!alive.current) break;
      if (!r.data) {
        if (!quiet) setError(t('importFailed'));
        break;
      }
      total += r.data.added;
      if (!quiet) setFound(total);
      // Sin novedades no se toca la grilla (un favorito recién marcado no se pisa con la lista del servidor).
      const list = r.data.stickers;
      if (r.data.added > 0 || !quiet) setItems(list);
      setImported(true);
      caughtUp.set(key, Date.now());
      if (!r.data.more) break;
    }
    syncing.current = false;
    if (alive.current && !quiet) setBusy('');
  }

  useEffect(() => {
    alive.current = true;
    void (async () => {
      // Solo la base: responde enseguida, sin esperar a WhatsApp.
      const r = await call<{ stickers: StickerItem[]; imported: boolean }>(key);
      if (!alive.current) return;
      if (!r.data) {
        setError(t('loadFailed'));
        setItems((prev) => prev ?? []);
        return;
      }
      setItems(r.data.stickers);
      setImported(r.data.imported);
      // Con la grilla ya dibujada, en otro pedido: lo que llegó a los chats de esta línea. Si la línea nunca importó,
      // se ve el avance ("Importando… n") mientras se va llenando.
      if (Date.now() - (caughtUp.get(key) ?? 0) < CATCH_UP_MS) return;
      void importFromChats(r.data.imported);
    })();
    return () => {
      alive.current = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  async function create(file: File) {
    setBusy('create');
    setError('');
    const r = await createSticker(api, line, file);
    if (!alive.current) return;
    setBusy('');
    if (!r.sticker) {
      setError(r.error === 'sticker_too_large' ? t('tooLarge') : r.error === 'sticker_convert_unavailable' ? t('convertUnavailable') : t('createFailed'));
      return;
    }
    const s = r.sticker;
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

  const sections = useMemo(() => stickerSections(items ?? []), [items]);
  const mine = sections.filter((sec) => sec.key !== 'chats');
  const chats = sections.find((sec) => sec.key === 'chats');

  const tile = (s: StickerItem, section: string) => (
    <div key={`${section}-${s.id}`} className="wa-stk" data-sticker={s.id}>
      <button type="button" className="wa-stk-send" onClick={() => void send(s)} aria-label={t('send')} title={t('send')} aria-busy={sending === s.id || undefined} disabled={!!sending && sending !== s.id}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={s.url}
          alt=""
          width={s.width || 512}
          height={s.height || 512}
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={(e) => e.currentTarget.setAttribute('data-loaded', '')}
          onError={(e) => e.currentTarget.setAttribute('data-loaded', '')}
        />
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
          <>
            {mine.length === 0 && <p className="wa-stk-hint">{t('mineEmpty')}</p>}
            {mine.map((sec) => {
              const limit = PAGE[sec.key] + (more[sec.key] ?? 0);
              const title = t(`section.${sec.key}`);
              return (
                <section key={sec.key} aria-label={title} data-section={sec.key}>
                  <p className="wa-emoji-title">{title}</p>
                  <div className="wa-stk-grid">{sec.list.slice(0, limit).map((s) => tile(s, sec.key))}</div>
                  {sec.list.length > limit && (
                    <button type="button" className="wa-stk-action wa-stk-more-btn" onClick={() => setMore((m) => ({ ...m, [sec.key]: (m[sec.key] ?? 0) + PAGE[sec.key] }))}>
                      {t('showMore', { n: sec.list.length - limit })}
                    </button>
                  )}
                </section>
              );
            })}
            {chats && (
              <section aria-label={t('section.chats')} data-section="chats" data-open={chatsOpen || undefined}>
                <button type="button" className="wa-stk-fold" aria-expanded={chatsOpen} aria-controls={`${foldId}-chats`} onClick={() => setChatsOpen((v) => !v)}>
                  <Chevron size={14} />
                  {t('fromChats', { n: chats.list.length })}
                </button>
                {chatsOpen && (
                  <div id={`${foldId}-chats`}>
                    <p className="wa-stk-hint">{t('fromChatsHint')}</p>
                    <div className="wa-stk-grid">{chats.list.slice(0, PAGE.chats + (more.chats ?? 0)).map((s) => tile(s, 'chats'))}</div>
                    {chats.list.length > PAGE.chats + (more.chats ?? 0) && (
                      <button type="button" className="wa-stk-action wa-stk-more-btn" onClick={() => setMore((m) => ({ ...m, chats: (m.chats ?? 0) + PAGE.chats }))}>
                        {t('showMore', { n: chats.list.length - PAGE.chats - (more.chats ?? 0) })}
                      </button>
                    )}
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
