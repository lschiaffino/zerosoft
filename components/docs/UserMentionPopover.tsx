'use client';

import { useEffect, useMemo, useState } from 'react';
import type { DocsMentionableUser } from '@/lib/docs-types';

interface UserMentionPopoverProps {
  query: string;
  onSelect: (user: DocsMentionableUser) => void;
  onClose: () => void;
}

/** Popover de @menciones: lista miembros del workspace y filtra por nombre/email. */
export default function UserMentionPopover({ query, onSelect, onClose }: UserMentionPopoverProps) {
  const [members, setMembers] = useState<DocsMentionableUser[] | null>(null);

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

  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  const filtered = useMemo(() => {
    if (!members) return null;
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) =>
        (m.name ?? '').toLowerCase().includes(q) || m.email.toLowerCase().includes(q),
    );
  }, [members, query]);

  return (
    <div className="docs-mention-popover">
      {filtered === null ? (
        <div className="docs-mention-empty">…</div>
      ) : filtered.length === 0 ? (
        <div className="docs-mention-empty">No members</div>
      ) : (
        filtered.map((member) => (
          <button
            key={member.id}
            type="button"
            className="docs-mention-item"
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
