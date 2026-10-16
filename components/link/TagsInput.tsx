'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

interface TagsInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  max?: number;
  /** id del rótulo visible del campo. */
  labelledBy?: string;
  id?: string;
}

/** Tags como badges rectos: Enter o coma agrega, el botón o Backspace quita. */
export default function TagsInput({ tags, onChange, max = 5, labelledBy, id }: TagsInputProps) {
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
    <div className={`lk-tags${atMax ? ' at-max' : ''}`}>
      {tags.map((tag) => (
        <span key={tag} className="badge lk-tag">
          {tag}
          <button
            type="button"
            className="lk-tag-remove"
            onClick={() => onChange(tags.filter((x) => x !== tag))}
            aria-label={t('new.tagRemove', { tag })}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
        </span>
      ))}
      <input
        id={id}
        className="lk-tags-field"
        value={input}
        maxLength={40}
        aria-labelledby={labelledBy}
        onChange={(e) => {
          const v = e.target.value;
          if (v.endsWith(',')) addTag(v);
          else setInput(v);
        }}
        onBlur={() => input.trim() && addTag(input)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            addTag(input);
          } else if (e.key === 'Backspace' && !input && tags.length > 0) {
            onChange(tags.slice(0, -1));
          }
        }}
        placeholder={atMax ? t('new.tagsMax') : tags.length === 0 ? t('new.tagsPlaceholder') : ''}
        disabled={atMax}
      />
    </div>
  );
}
