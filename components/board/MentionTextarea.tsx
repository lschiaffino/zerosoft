'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { filterMembers, insertMention, mentionQuery, type MentionMember } from '@/lib/board-mentions';

/**
 * Textarea de comentarios con autocompletado de @menciones (miembros del
 * workspace). Enter con ⌘/Ctrl manda; con la lista abierta, Enter o Tab elige.
 */
export default function MentionTextarea({
  value,
  onChange,
  onSubmit,
  members,
  placeholder,
  autoFocus,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  members: MentionMember[];
  placeholder: string;
  autoFocus?: boolean;
  label: string;
}) {
  const t = useTranslations('board.comments');
  const ref = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const query = mentionQuery(value, caret);
  const q = query?.query;
  const options = useMemo(() => (q === undefined ? [] : filterMembers(members, q)), [members, q]);
  const open = Boolean(query) && options.length > 0 && !dismissed;

  function pick(m: MentionMember) {
    const next = insertMention(value, caret, m);
    if (!next) return;
    onChange(next.value);
    setCaret(next.caret);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(next.caret, next.caret);
    });
  }

  return (
    <div className="board-mention">
      <textarea
        ref={ref}
        className="input board-comment-input"
        value={value}
        rows={3}
        maxLength={5000}
        placeholder={placeholder}
        aria-label={label}
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart ?? e.target.value.length);
          setActive(0);
          setDismissed(false);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
        onKeyDown={(e) => {
          if (open) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              const step = e.key === 'ArrowDown' ? 1 : -1;
              setActive((i) => (i + step + options.length) % options.length);
              return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              pick(options[Math.min(active, options.length - 1)]);
              return;
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setDismissed(true);
              return;
            }
          }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSubmit();
          }
        }}
      />
      {open && (
        <ul id={listId} className="board-mention-list" role="listbox" aria-label={t('mentionList')}>
          {options.map((m, i) => (
            <li key={m.id} role="option" aria-selected={i === active}>
              <button
                type="button"
                className={`board-mention-option${i === active ? ' is-active' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(m);
                }}
              >
                <span className="board-mention-name">{m.name || m.email}</span>
                {m.name && <span className="board-mention-email">{m.email}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
