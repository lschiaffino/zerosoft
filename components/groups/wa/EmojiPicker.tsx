'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import type { EmojiCategory } from './emoji-data';
import StickerPanel, { type StickerTab } from './StickerPanel';

export const RECENT_KEY = 'zs-groups-emoji-recent';
/** Última pestaña del panel (Emoji o Stickers), como WhatsApp Web la recuerda. */
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

function readPanel(): 'emoji' | 'stickers' {
  try {
    return window.localStorage.getItem(PANEL_KEY) === 'stickers' ? 'stickers' : 'emoji';
  } catch {
    return 'emoji';
  }
}

/**
 * Panel de emojis del composer, como el de WhatsApp Web: búsqueda,
 * pestañas por categoría (con los recientes) y la grilla. Los datos se cargan
 * aparte la primera vez que se abre. Esc cierra; flechas recorren la grilla.
 * Con `stickers`, arriba van las pestañas Emoji | Stickers (StickerPanel).
 */
export default function EmojiPicker({ onPick, onClose, stickers }: { onPick: (emoji: string) => void; onClose: () => void; stickers?: StickerTab }) {
  const t = useTranslations('groups.wa');
  const ref = useRef<HTMLDivElement>(null);
  const [panel, setPanel] = useState<'emoji' | 'stickers'>(() => (stickers ? readPanel() : 'emoji'));
  const choosePanel = (p: 'emoji' | 'stickers') => {
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
    const r = readRecent();
    setRecent(r);
    if (r.length) setActive('recent');
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

  const list: Array<[string, string]> = results ?? (active === 'recent' ? recent.map((e) => [e, e] as [string, string]) : (data?.[active] ?? []));

  const panelTabs = stickers ? (
    <div className="wa-xp-tabs" role="tablist" aria-label={t('stickers.panels')}>
      {(['emoji', 'stickers'] as const).map((p) => (
        <button key={p} type="button" role="tab" aria-selected={panel === p} onClick={() => choosePanel(p)}>
          {p === 'emoji' ? t('emoji') : t('stickers.tab')}
        </button>
      ))}
    </div>
  ) : null;

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
        {CATS.filter((c) => c.key !== 'recent' || recent.length > 0).map((c) => (
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
