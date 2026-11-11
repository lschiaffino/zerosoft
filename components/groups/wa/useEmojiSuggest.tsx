'use client';

import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { ALIASES, readRecent, saveRecent } from './EmojiPicker';
import type { EmojiCategory } from './emoji-data';
import { emojiQueryAt, rankEmoji } from './emoji-suggest';

type Data = Record<EmojiCategory, Array<[string, string]>>;
let cache: Array<[string, string]> | null = null;

/**
 * Sugerencias de emoji del composer: escribís ":che" y aparece una tira con
 * los emojis; ←/→ (o ↑/↓) eligen, Enter o Tab lo ponen en lugar de ":che",
 * Esc la cierra. `caret` es la posición del cursor en `text`; `apply`
 * reemplaza [start, end) por el emoji.
 */
export function useEmojiSuggest({ text, caret, apply, disabled }: { text: string; caret: number; apply: (start: number, end: number, emoji: string) => void; disabled?: boolean }) {
  const t = useTranslations('groups.wa');
  const [all, setAll] = useState<Array<[string, string]> | null>(cache);
  const [index, setIndex] = useState(0);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const hit = disabled ? null : emojiQueryAt(text, caret);

  useEffect(() => {
    if (!hit || all) return;
    let alive = true;
    void import('./emoji-data').then((m) => {
      cache = Object.values(m.EMOJI_DATA as Data).flat();
      if (alive) setAll(cache);
    });
    return () => {
      alive = false;
    };
  }, [hit, all]);

  const query = hit?.query ?? '';
  const start = hit?.start ?? -1;
  const items = useMemo(() => (all && query && start !== dismissed ? rankEmoji(all, query, ALIASES, readRecentSafe()) : []), [all, query, start, dismissed]);
  useEffect(() => setIndex(0), [query]);
  // Otra búsqueda (otro ":"): lo cerrado con Esc vuelve a abrir.
  useEffect(() => {
    if (dismissed !== null && start !== dismissed) setDismissed(null);
  }, [start, dismissed]);

  const open = items.length > 0;
  const pick = (i: number) => {
    const it = items[i];
    if (!it || !hit) return;
    apply(hit.start, caret, it.char);
    saveRecent([it.char, ...readRecentSafe().filter((x) => x !== it.char)]);
  };

  /** true: la tecla era de las sugerencias (el composer no la usa). */
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open || e.nativeEvent.isComposing) return false;
    const n = items.length;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => (i + 1) % n);
      return true;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => (i - 1 + n) % n);
      return true;
    }
    if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
      e.preventDefault();
      pick(Math.min(index, n - 1));
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setDismissed(start);
      return true;
    }
    return false;
  };

  const strip = open ? (
    <div className="wa-emoji-suggest" role="listbox" aria-label={t('emojiSuggest')} data-testid="emoji-suggest">
      {items.map((it, i) => (
        <button
          key={it.char}
          type="button"
          role="option"
          aria-selected={i === index}
          className={`wa-emoji-suggest-item${i === index ? ' is-active' : ''}`}
          title={`:${it.name.replace(/\s+/g, '_')}:`}
          aria-label={it.name}
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => setIndex(i)}
          onClick={() => pick(i)}
        >
          {it.char}
        </button>
      ))}
    </div>
  ) : null;

  return { open, onKeyDown, strip };
}

function readRecentSafe(): string[] {
  return typeof window === 'undefined' ? [] : readRecent();
}
