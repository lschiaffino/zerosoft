'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

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

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
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
    const q = query.toLowerCase();
    return EMOJI_CATEGORIES.map((cat) => ({
      ...cat,
      emojis: cat.emojis.filter((emoji) => emoji.includes(q)),
    })).filter((cat) => cat.emojis.length > 0);
  }, [query]);

  return (
    <div ref={wrapRef} className="emoji-picker-wrap">
      <button
        type="button"
        className="emoji-picker-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-label={t('emoji.pick')}
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
