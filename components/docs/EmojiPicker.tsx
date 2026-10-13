'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { emojiMatches } from '@/lib/emoji-names';

interface EmojiPickerProps {
  value: string;
  onChange: (emoji: string) => void;
  children: React.ReactNode;
}

const EMOJI_CATEGORIES: { key: string; emojis: string[] }[] = [
  {
    key: 'recent',
    emojis: ['📄', '✅', '📌', '💡', '🔥', '🚀', '📊', '📁', '📝', '⚙️'],
  },
  {
    key: 'smileys',
    emojis: ['😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🥸', '🤩', '🥳'],
  },
  {
    key: 'objects',
    emojis: ['💼', '📁', '📂', '🗂️', '📅', '📆', '🗒️', '📋', '📌', '📍', '✂️', '🖊️', '🖋️', '✒️', '📝', '✏️', '🔍', '🔎', '🔐', '🔒', '🔓', '🔑', '🗝️', '💡', '🔦', '🔋', '🔌', '💻', '🖥️', '🖨️'],
  },
  {
    key: 'symbols',
    emojis: ['✅', '❌', '⭕', '❗', '❓', '‼️', '⁉️', '➡️', '⬅️', '⬆️', '⬇️', '↗️', '↘️', '↙️', '↖️', '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚫', '⚪', '🟤', '⭐', '🌟', '💫', '✨', '⚡', '🔥'],
  },
  {
    key: 'nature',
    emojis: ['🌱', '🌿', '☘️', '🍀', '🍁', '🍂', '🍃', '🌵', '🌴', '🌲', '🌳', '🌷', '🌹', '🌺', '🌸', '🌼', '🌻', '🌞', '🌝', '🌛', '🌜', '⭐', '🌟', '☁️', '⛅', '🌧️', '⛈️', '❄️', '🔥', '💧'],
  },
  {
    key: 'food',
    emojis: ['☕', '🍵', '🥤', '🍺', '🍷', '🍕', '🍔', '🍟', '🌭', '🍿', '🥐', '🥯', '🍞', '🥖', '🥨', '🧀', '🥚', '🍳', '🥞', '🧇', '🥓', '🥩', '🍗', '🍖', '🌮', '🌯', '🥗', '🥙', '🥪', '🍣'],
  },
];

export default function EmojiPicker({ value, onChange, children }: EmojiPickerProps) {
  const t = useTranslations('docs');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        // Focus was auto-moved into the popover search; give it back to the trigger.
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const filtered = useMemo(() => {
    if (!query.trim()) return EMOJI_CATEGORIES;
    // Búsqueda por nombre ("rocket", "cohete"): una sola lista sin duplicados.
    const seen = new Set<string>();
    const emojis = EMOJI_CATEGORIES.flatMap((cat) => cat.emojis).filter((emoji) => {
      if (seen.has(emoji) || !emojiMatches(emoji, query)) return false;
      seen.add(emoji);
      return true;
    });
    return emojis.length ? [{ key: 'results', emojis }] : [];
  }, [query]);

  return (
    <div ref={wrapRef} className="emoji-picker-wrap">
      <button
        type="button"
        ref={triggerRef}
        className="emoji-picker-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-label={t('emoji.pick')}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        {children}
      </button>
      {open && (
        <div className="emoji-picker-popover">
          <input
            className="emoji-picker-search"
            type="text"
            placeholder={t('emoji.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <div className="emoji-picker-body">
            {filtered.map((cat) => (
              <div key={cat.key} className="emoji-picker-category">
                <span className="emoji-picker-cat-name">{t(`emoji.categories.${cat.key}`)}</span>
                <div className="emoji-picker-grid">
                  {cat.emojis.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      className={`emoji-picker-item${emoji === value ? ' sel' : ''}`}
                      onClick={() => {
                        onChange(emoji);
                        setOpen(false);
                        setQuery('');
                      }}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="emoji-picker-empty">{t('emoji.empty')}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
