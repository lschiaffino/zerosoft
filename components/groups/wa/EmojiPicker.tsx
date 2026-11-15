'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import type { EmojiCategory } from './emoji-data';
import StickerPanel, { type StickerTab } from './StickerPanel';
import GifPanel, { type GifTab } from './GifPanel';
import { recentWithDefaults } from './emoji-recent';

/** Íconos de las pestañas Emoji | GIF | Stickers (como las de WhatsApp: ícono arriba del nombre). */
const SmileyTab = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M8.5 14.5c.9 1.2 2.1 1.8 3.5 1.8s2.6-.6 3.5-1.8M9 9.5h.01M15 9.5h.01" />
  </svg>
);
const GifTabIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2.5" y="5" width="19" height="14" rx="3" />
    <path d="M10 10.2a2 2 0 0 0-1.6-.7c-1.3 0-2.1 1-2.1 2.5s.8 2.5 2.1 2.5c1 0 1.6-.6 1.6-1.6V12H8.6M12.6 9.6v4.8M15.4 14.4V9.6h2.6M15.4 12h2.1" />
  </svg>
);
const StickerTabIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15.5 21H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8.5Z" />
    <path d="M21 15h-3a3 3 0 0 0-3 3v3" />
    <path d="M8.5 13.5c1 1.2 2.2 1.8 3.5 1.8M9 9h.01M15 9h.01" />
  </svg>
);

export const RECENT_KEY = 'zs-groups-emoji-recent';
/** Última pestaña del panel (Emoji, GIFs o Stickers), como WhatsApp Web la recuerda. */
const PANEL_KEY = 'zs-wa-expression-tab';
const CATS: Array<{ key: 'recent' | EmojiCategory; icon: string }> = [
  { key: 'recent', icon: '🕘' },
  { key: 'smileys', icon: '😀' },
  { key: 'nature', icon: '🐻' },
  { key: 'food', icon: '🍔' },
  { key: 'activities', icon: '⚽' },
  { key: 'travel', icon: '🚗' },
  { key: 'objects', icon: '💡' },
  { key: 'symbols', icon: '❤️' },
  { key: 'flags', icon: '🏳️' },
];

/** Palabras en español y portugués para buscar los más usados (los nombres de Unicode están en inglés). */
export const ALIASES: Record<string, string> = {
  corazon: 'heart', coração: 'heart', risa: 'joy laughing', riso: 'joy laughing', llorar: 'crying', chorar: 'crying', ok: 'ok thumbs up',
  gracias: 'folded hands', obrigado: 'folded hands', fuego: 'fire', fogo: 'fire', fiesta: 'party', festa: 'party', beso: 'kiss', beijo: 'kiss',
  feliz: 'smiling grinning', triste: 'sad frowning', enojo: 'angry pouting', raiva: 'angry pouting', perro: 'dog', cachorro: 'dog', gato: 'cat',
  sol: 'sun', lluvia: 'rain', chuva: 'rain', cafe: 'coffee', café: 'coffee', pizza: 'pizza', cerveza: 'beer', cerveja: 'beer', auto: 'car', carro: 'car',
  casa: 'house', dinero: 'money', dinheiro: 'money', reloj: 'clock watch', relogio: 'clock watch', telefono: 'telephone phone', telefone: 'telephone phone',
  mano: 'hand', mão: 'hand', aplauso: 'clapping', aplausos: 'clapping', check: 'check mark', estrella: 'star', estrela: 'star', regalo: 'gift', presente: 'gift',
  bandera: 'flag', bandeira: 'flag', argentina: 'flag ar', brasil: 'flag br', mexico: 'flag mx', españa: 'flag es', espanha: 'flag es',
};

export function readRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(v) ? (v as string[]).filter((x) => typeof x === 'string').slice(0, 32) : [];
  } catch {
    return [];
  }
}

export function saveRecent(list: string[]) {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 32)));
  } catch {
    // Sin storage: sin recientes.
  }
}

type Panel = 'emoji' | 'gifs' | 'stickers';

function readPanel(has: { gifs: boolean; stickers: boolean }): Panel {
  try {
    const v = window.localStorage.getItem(PANEL_KEY);
    return v === 'stickers' && has.stickers ? 'stickers' : v === 'gifs' && has.gifs ? 'gifs' : 'emoji';
  } catch {
    return 'emoji';
  }
}

/**
 * Panel de emojis del composer, como el de WhatsApp Web: búsqueda,
 * pestañas por categoría (con los recientes) y la grilla. Los datos se cargan
 * aparte la primera vez que se abre. Esc cierra; flechas recorren la grilla.
 * Con `gifs` o `stickers`, arriba van las pestañas Emoji | GIFs | Stickers
 * (GifPanel, StickerPanel).
 */
export default function EmojiPicker({ onPick, onClose, stickers, gifs }: { onPick: (emoji: string) => void; onClose: () => void; stickers?: StickerTab; gifs?: GifTab }) {
  const t = useTranslations('groups.wa');
  const ref = useRef<HTMLDivElement>(null);
  const [panel, setPanel] = useState<Panel>(() => readPanel({ gifs: Boolean(gifs), stickers: Boolean(stickers) }));
  const choosePanel = (p: Panel) => {
    setPanel(p);
    try {
      window.localStorage.setItem(PANEL_KEY, p);
    } catch {
      // Sin storage: abre en Emoji.
    }
  };
  const searchRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<Record<EmojiCategory, Array<[string, string]>> | null>(null);
  const [q, setQ] = useState('');
  const [recent, setRecent] = useState<string[]>([]);
  const [active, setActive] = useState<'recent' | EmojiCategory>('smileys');

  useEffect(() => {
    let alive = true;
    void import('./emoji-data').then((m) => alive && setData(m.EMOJI_DATA));
    setRecent(readRecent());
    setActive('recent');
    searchRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('[data-emoji-toggle]')) onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => {
      alive = false;
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!data || !needle) return null;
    const words = (ALIASES[needle] ?? needle).split(/\s+/);
    const all = Object.values(data).flat();
    return all.filter(([, name]) => words.some((w) => name.includes(w))).slice(0, 120);
  }, [q, data]);

  function pick(e: string) {
    const next = [e, ...recent.filter((x) => x !== e)].slice(0, 32);
    setRecent(next);
    saveRecent(next);
    onPick(e);
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    const all = [...(gridRef.current?.querySelectorAll<HTMLButtonElement>('button[data-emoji]') ?? [])];
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 9, ArrowUp: -9 }[e.key];
    if (step && (i >= 0 || e.key === 'ArrowDown')) {
      e.preventDefault();
      all[i < 0 ? 0 : Math.min(all.length - 1, Math.max(0, i + step))]?.focus();
    }
  }

  const list: Array<[string, string]> = results ?? (active === 'recent' ? recentWithDefaults(recent).map((e) => [e, e] as [string, string]) : (data?.[active] ?? []));

  const panels: Panel[] = ['emoji', ...(gifs ? (['gifs'] as const) : []), ...(stickers ? (['stickers'] as const) : [])];
  const panelTabs =
    panels.length > 1 ? (
      <div className="wa-xp-tabs" role="tablist" aria-label={t('stickers.panels')}>
        {panels.map((p) => (
          <button key={p} type="button" role="tab" aria-selected={panel === p} data-panel={p} onClick={() => choosePanel(p)}>
            <span className="wa-xp-ico" aria-hidden="true">
              {p === 'emoji' ? <SmileyTab /> : p === 'gifs' ? <GifTabIcon /> : <StickerTabIcon />}
            </span>
            <span>{p === 'emoji' ? t('emoji') : p === 'gifs' ? t('gifs.tab') : t('stickers.tab')}</span>
          </button>
        ))}
      </div>
    ) : null;

  if (gifs && panel === 'gifs') {
    return (
      <div className="wa-emoji is-gifs" data-voice-off role="dialog" aria-label={t('gifs.tab')} ref={ref} onKeyDown={onKey}>
        {panelTabs}
        <GifPanel api={gifs.api} onSend={gifs.onSend} onSent={onClose} />
      </div>
    );
  }

  if (stickers && panel === 'stickers') {
    return (
      <div className="wa-emoji is-stickers" data-voice-off role="dialog" aria-label={t('stickers.tab')} ref={ref} onKeyDown={onKey}>
        {panelTabs}
        <StickerPanel api={stickers.api} onSend={stickers.onSend} />
      </div>
    );
  }

  return (
    <div className="wa-emoji" data-voice-off role="dialog" aria-label={t('emoji')} ref={ref} onKeyDown={onKey}>
      {panelTabs}
      <div className="wa-emoji-tabs" role="tablist" aria-label={t('emojiCategories')}>
        {CATS.map((c) => (
          <button
            key={c.key}
            type="button"
            role="tab"
            aria-selected={!results && active === c.key}
            aria-label={t(`emojiSets.${c.key}`)}
            title={t(`emojiSets.${c.key}`)}
            onClick={() => {
              setQ('');
              setActive(c.key);
              gridRef.current?.scrollTo({ top: 0 });
            }}
          >
            {c.icon}
          </button>
        ))}
      </div>
      <input
        ref={searchRef}
        className="wa-emoji-search"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('emojiSearch')}
        aria-label={t('emojiSearch')}
      />
      <p className="wa-emoji-title">{results ? t('emojiResults') : t(`emojiSets.${active}`)}</p>
      <div className="wa-emoji-grid" ref={gridRef}>
        {!data && <p className="wa-emoji-empty">…</p>}
        {data && list.length === 0 && <p className="wa-emoji-empty">{results ? t('emojiNone') : ''}</p>}
        {list.map(([e, name]) => (
          <button key={e} type="button" data-emoji onClick={() => pick(e)} aria-label={name} title={name}>
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
