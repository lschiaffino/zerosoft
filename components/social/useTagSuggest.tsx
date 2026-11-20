'use client';

import { useId, useState, type KeyboardEvent, type ReactNode, type RefObject, type SyntheticEvent, type TextareaHTMLAttributes } from 'react';
import { matchTags, tagAtCaret, type SocialTagSuggestions, type TagCount } from '@/lib/social-tag-match';

/**
 * Sugerencias de #hashtags y @menciones mientras se escribe en el compositor:
 * al tipear `#caf` aparece una lista con los tags que el equipo ya usó que
 * empiezan así. ↑/↓ eligen, Enter o Tab insertan, Esc cierra (y no vuelve a
 * abrir para ese tag), salir del campo la cierra. Devuelve las props para el
 * <textarea> y la lista, que va debajo del campo.
 */
export function useTagSuggest({
  ref,
  value,
  setValue,
  data,
  label,
  countLabel,
}: {
  ref: RefObject<HTMLTextAreaElement | null>;
  value: string;
  setValue: (next: string) => void;
  data: SocialTagSuggestions | null;
  label: string;
  countLabel: (n: number) => string;
}): { bind: TextareaHTMLAttributes<HTMLTextAreaElement>; popup: ReactNode } {
  const id = useId();
  const [caret, setCaret] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<number | null>(null);

  const token = caret == null ? null : tagAtCaret(value, caret);
  // Hasta 200 tags por tipo: filtrarlos en cada render es barato.
  const items: TagCount[] = token && data ? matchTags(token.kind === '#' ? data.hashtags : data.mentions, token.query) : [];
  const open = Boolean(token && items.length && dismissed !== token.start);
  const current = Math.min(active, Math.max(items.length - 1, 0));

  function track(e: SyntheticEvent<HTMLTextAreaElement>) {
    const el = e.currentTarget;
    const next = el.selectionStart === el.selectionEnd ? el.selectionStart : null;
    if (next !== caret) {
      setCaret(next);
      setActive(0);
    }
  }

  function pick(item: TagCount) {
    if (!token || caret == null) return;
    const after = value.slice(caret);
    const insert = `${token.kind}${item.tag}${/^\s/.test(after) ? '' : ' '}`;
    const next = `${value.slice(0, token.start)}${insert}${after}`;
    const pos = token.start + insert.length;
    setValue(next);
    setCaret(pos);
    setActive(0);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (!open || !token) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((current + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length);
    } else if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
      e.preventDefault();
      pick(items[current]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setDismissed(token.start);
    }
  }

  const optionId = (i: number) => `${id}-o${i}`;
  const bind: TextareaHTMLAttributes<HTMLTextAreaElement> = {
    onKeyDown,
    onSelect: track,
    onClick: track,
    onKeyUp: track,
    onInput: track,
    onBlur: () => setCaret(null),
    'aria-autocomplete': 'list',
    'aria-controls': open ? id : undefined,
    'aria-activedescendant': open ? optionId(current) : undefined,
  };

  const popup = open ? (
    <ul id={id} className="sc-suggest" role="listbox" aria-label={label} data-testid="tag-suggest">
      {items.map((x, i) => (
        <li
          key={x.tag}
          id={optionId(i)}
          role="option"
          aria-selected={i === current}
          className="sc-suggest-opt"
          data-testid="tag-suggest-option"
          // mousedown, no click: el textarea no pierde el foco antes de insertar.
          onMouseDown={(e) => {
            e.preventDefault();
            pick(x);
          }}
          onMouseEnter={() => setActive(i)}
        >
          <span className="sc-grow">
            {token?.kind}
            {x.tag}
          </span>
          <span className="sc-muted sc-small">{countLabel(x.n)}</span>
        </li>
      ))}
    </ul>
  ) : null;

  return { bind, popup };
}
