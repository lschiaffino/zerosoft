'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import type { DocsMentionableUser } from '@/lib/docs-types';

interface UserMentionPopoverProps {
  query: string;
  /** Posición fija (viewport) calculada por el editor a partir del caret. */
  style?: CSSProperties;
  onSelect: (user: DocsMentionableUser) => void;
  onClose: () => void;
}

/** Popover de @menciones: lista miembros del workspace y filtra por nombre/email. */
export default function UserMentionPopover({ query, style, onSelect, onClose }: UserMentionPopoverProps) {
  const t = useTranslations('docs');
  const [members, setMembers] = useState<DocsMentionableUser[] | null>(null);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/docs/members')
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
  }, []);

  const filtered = useMemo(() => {
    if (!members) return null;
    const q = query.trim().toLowerCase();
    if (!q) return members;
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
    const items = filtered ?? [];
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (!items.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setActive((a) =>
          e.key === 'ArrowDown' ? (a + 1) % items.length : (a - 1 + items.length) % items.length,
        );
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const member = items[Math.min(active, items.length - 1)];
        if (member) onSelect(member);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [filtered, active, onSelect, onClose]);

  // El item activo queda visible dentro del scroll del popover.
  useEffect(() => {
    rootRef.current
      ?.querySelector('.docs-mention-item.sel')
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const items = filtered ?? [];
  const sel = Math.min(active, Math.max(0, items.length - 1));

  return (
    <div
      ref={rootRef}
      className="docs-mention-popover"
      style={style}
      onMouseDown={(e) => e.preventDefault()}
    >
      {filtered === null ? (
        <div className="docs-mention-empty">…</div>
      ) : items.length === 0 ? (
        <div className="docs-mention-empty">{t('mentions.noMembers')}</div>
      ) : (
        items.map((member, i) => (
          <button
            key={member.id}
            type="button"
            className={`docs-mention-item${i === sel ? ' sel' : ''}`}
            onMouseEnter={() => setActive(i)}
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
