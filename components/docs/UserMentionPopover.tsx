'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import type { DocsMentionableUser } from '@/lib/docs-types';
import DocsGlyph from './DocsGlyphs';

/** Opción de fecha (@hoy, @mañana, recordatorio) arriba de las personas. */
export interface DateMentionOption {
  key: string;
  label: string;
  detail: string;
  remind: boolean;
}

interface UserMentionPopoverProps {
  query: string;
  /** Página donde se menciona: lista los del workspace dueño de la página. */
  pageId: string;
  /** Posición fija (viewport) calculada por el editor a partir del caret. */
  style?: CSSProperties;
  onSelect: (user: DocsMentionableUser) => void;
  onClose: () => void;
  /** Fechas y recordatorios que coinciden con lo tipeado (lib/docs-dates.ts). */
  dates?: DateMentionOption[];
  onSelectDate?: (index: number) => void;
}

/** Popover de @menciones: lista miembros del workspace y filtra por nombre/email. */
export default function UserMentionPopover({ query, pageId, style, onSelect, onClose, dates = [], onSelectDate }: UserMentionPopoverProps) {
  const t = useTranslations('docs');
  const [members, setMembers] = useState<DocsMentionableUser[] | null>(null);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/docs/members?page=${encodeURIComponent(pageId)}`)
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((data) => {
        if (!cancelled) setMembers(data.rows ?? []);
      })
      .catch(() => {
        if (!cancelled) setMembers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [pageId]);

  const filtered = useMemo(() => {
    if (!members) return null;
    const q = query.trim().toLowerCase();
    if (!q) return members;
    // Una búsqueda con espacios ("recordar mañana 9") es de fecha, no de persona.
    if (/\s/.test(q)) return [];
    return members.filter(
      (m) =>
        (m.name ?? '').toLowerCase().includes(q) || m.email.toLowerCase().includes(q),
    );
  }, [members, query]);

  // Nueva query: la selección vuelve al primer resultado.
  useEffect(() => {
    setActive(0);
  }, [query]);

  // Teclado en fase de captura (gana al keydown del editor): ↑/↓ navega,
  // Enter elige el activo, Esc cierra. El caret del editor no se mueve.
  useEffect(() => {
    const people = filtered ?? [];
    const total = dates.length + people.length;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (!total) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setActive((a) => (e.key === 'ArrowDown' ? (a + 1) % total : (a - 1 + total) % total));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        const i = Math.min(active, total - 1);
        if (i < dates.length) onSelectDate?.(i);
        else {
          const member = people[i - dates.length];
          if (member) onSelect(member);
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [filtered, active, onSelect, onClose, dates, onSelectDate]);

  // El item activo queda visible dentro del scroll del popover.
  useEffect(() => {
    rootRef.current
      ?.querySelector('.docs-mention-item.sel')
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const items = filtered ?? [];
  const sel = Math.min(active, Math.max(0, dates.length + items.length - 1));

  return (
    <div
      ref={rootRef}
      className="docs-mention-popover"
      style={style}
      onMouseDown={(e) => e.preventDefault()}
    >
      {dates.length > 0 && <div className="docs-mention-section">{t('mentions.dates')}</div>}
      {dates.map((d, i) => (
        <button
          key={`${d.key}-${i}`}
          type="button"
          className={`docs-mention-item${i === sel ? ' sel' : ''}`}
          data-testid="docs-date-option"
          onMouseEnter={() => setActive(i)}
          onClick={() => onSelectDate?.(i)}
        >
          <span className="docs-mention-icon" aria-hidden>
            <DocsGlyph name={d.remind ? 'bell' : 'calendar'} size={14} />
          </span>
          <span className="docs-mention-title">{d.label}</span>
          <span className="docs-mention-detail">{d.detail}</span>
        </button>
      ))}
      {dates.length > 0 && items.length > 0 && <div className="docs-mention-section">{t('mentions.people')}</div>}
      {filtered === null ? (
        <div className="docs-mention-empty" aria-busy="true"><span className="ui-skeleton ui-skeleton-text" /></div>
      ) : items.length === 0 ? (
        dates.length === 0 ? <div className="docs-mention-empty">{t('mentions.noMembers')}</div> : null
      ) : (
        items.map((member, k) => (
          <button
            key={member.id}
            type="button"
            className={`docs-mention-item${k + dates.length === sel ? ' sel' : ''}`}
            onMouseEnter={() => setActive(k + dates.length)}
            onClick={() => onSelect(member)}
          >
            <span className="docs-mention-avatar" aria-hidden>
              {(member.name ?? member.email).charAt(0).toUpperCase()}
            </span>
            <span className="docs-mention-title">{member.name ?? member.email}</span>
          </button>
        ))
      )}
    </div>
  );
}
