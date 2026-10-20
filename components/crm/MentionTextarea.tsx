'use client';

import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import {
  mentionQueryAt,
  mentionSegments,
  mentionSuggestions,
  mentionText,
  type Mentionable,
} from '@/lib/crm-mentions';

interface MentionTextareaProps {
  value: string;
  onChange: (next: string) => void;
  people: Mentionable[];
  className?: string;
  rows?: number;
  placeholder?: string;
  maxLength?: number;
  'aria-label'?: string;
}

/**
 * Textarea con @menciones: al escribir "@" sugiere personas del workspace
 * (flechas + Enter o Tab para elegir, Escape para cerrar) e inserta "@Nombre".
 */
export default function MentionTextarea({ value, onChange, people, ...rest }: MentionTextareaProps) {
  const t = useTranslations('crm');
  const listId = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<{ query: string; start: number } | null>(null);
  const [active, setActive] = useState(0);
  const suggestions = query && people.length ? mentionSuggestions(query.query, people) : [];
  const open = suggestions.length > 0;

  function refresh(text: string, caret: number) {
    const q = mentionQueryAt(text, caret);
    setQuery(q);
    setActive(0);
  }

  function pick(p: Mentionable) {
    const el = ref.current;
    if (!el || !query) return;
    const caret = el.selectionStart ?? value.length;
    const insert = `${mentionText(p)} `;
    const next = value.slice(0, query.start) + insert + value.slice(caret);
    onChange(next);
    setQuery(null);
    const pos = query.start + insert.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (!open) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = suggestions.length;
      setActive((i) => (e.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n));
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      pick(suggestions[Math.min(active, suggestions.length - 1)]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setQuery(null);
    }
  }

  return (
    <div className="crm-mention">
      <textarea
        ref={ref}
        {...rest}
        value={value}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        onChange={(e) => {
          onChange(e.target.value);
          refresh(e.target.value, e.target.selectionStart ?? e.target.value.length);
        }}
        onKeyDown={onKeyDown}
        onClick={(e) => refresh(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
        onBlur={() => setTimeout(() => setQuery(null), 120)}
      />
      {open && (
        <ul className="crm-mention-menu" role="listbox" id={listId} aria-label={t('mentions.suggestions')}>
          {suggestions.map((p, i) => (
            <li
              key={p.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'is-active' : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(p);
              }}
            >
              <span className="crm-mention-name">{p.name || p.email}</span>
              {p.name && <span className="muted">{p.email}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Texto con las menciones resaltadas (cuerpo de notas y tareas). */
export function MentionText({ text, people }: { text: string; people: Mentionable[] }) {
  return (
    <>
      {mentionSegments(text, people).map((s, i) =>
        s.mention ? (
          <span key={i} className="crm-mention-tag">
            {s.text}
          </span>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}
