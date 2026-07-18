'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

interface TagsInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  max?: number;
}

/** Chip-based tag editor: Enter or comma adds, × removes. */
export default function TagsInput({ tags, onChange, max = 5 }: TagsInputProps) {
  const t = useTranslations('link');
  const [input, setInput] = useState('');

  const atMax = tags.length >= max;

  function addTag(raw: string) {
    const value = raw.trim().replace(/,+$/, '');
    if (!value || tags.includes(value) || tags.length >= max) return;
    onChange([...tags, value]);
    setInput('');
  }

  return (
    <div className={`tags-input${atMax ? ' at-max' : ''}`}>
      <div className="tags-chips">
        {tags.map((tag) => (
          <span key={tag} className="badge tag-chip">
            {tag}
            <button
              type="button"
              className="tag-remove"
              onClick={() => onChange(tags.filter((x) => x !== tag))}
              aria-label={`remove ${tag}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          className="tags-field mono"
          value={input}
          onChange={(e) => {
            const v = e.target.value;
            if (v.endsWith(',')) addTag(v);
            else setInput(v);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addTag(input);
            } else if (e.key === 'Backspace' && !input && tags.length > 0) {
              onChange(tags.slice(0, -1));
            }
          }}
          placeholder={atMax ? t('new.tagsMax') : t('new.tagsPlaceholder')}
          disabled={atMax}
        />
      </div>
    </div>
  );
}
