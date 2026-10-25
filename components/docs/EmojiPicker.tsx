'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { emojiMatches } from '@/lib/emoji-names';

interface EmojiPickerProps {
  value: string;
  onChange: (emoji: string) => void;
  /** Si está, el popover ofrece "Quitar ícono". */
  onRemove?: () => void;
  /** Clase del botón que abre el picker (por defecto, el ícono suelto). */
  triggerClassName?: string;
  /** Nombre accesible del botón (por defecto "Elegir ícono"). */
  triggerLabel?: string;
  /** Si está, el popover ofrece subir una imagen como ícono (ícono de página). */
  onUpload?: (file: File) => void;
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

export default function EmojiPicker({ value, onChange, onRemove, triggerClassName, triggerLabel, onUpload, children }: EmojiPickerProps) {
  const t = useTranslations('docs');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
        className={triggerClassName ?? 'emoji-picker-trigger'}
        onClick={() => setOpen((v) => !v)}
        aria-label={triggerLabel ?? t('emoji.pick')}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        {children}
      </button>
      {open && (
        <div className="docs-menu emoji-picker-popover" role="dialog" aria-label={t('emoji.pick')}>
          <div className="emoji-picker-top">
            <input
              className="input emoji-picker-search"
              type="search"
              placeholder={t('emoji.search')}
              aria-label={t('emoji.search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            {onUpload && (
              <>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>
                  {t('emoji.upload')}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  hidden
                  data-testid="docs-icon-file"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) {
                      onUpload(f);
                      setOpen(false);
                    }
                  }}
                />
              </>
            )}
            {onRemove && value && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  onRemove();
                  setOpen(false);
                  setQuery('');
                }}
              >
                {t('editor.removeIcon')}
              </button>
            )}
          </div>
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
                      aria-pressed={emoji === value}
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
