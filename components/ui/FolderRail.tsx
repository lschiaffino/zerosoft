'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from '@/i18n/navigation';
import { folderHue, folderInitials } from '@/lib/folder-rail';

export interface RailFolder {
  id: string;
  name: string;
  href: string;
  active: boolean;
  unread: number;
  /** Color propio de la carpeta (Inbox); sin color sale uno estable del nombre. */
  color?: string;
  depth: number;
}

/**
 * Carpetas en el sidebar colapsado (Lines e Inbox): un cuadrado con iniciales por
 * carpeta, el nombre en el tooltip, la abierta marcada y un punto si hay sin leer.
 */
export default function FolderRail({ label, folders, unreadLabel }: { label: string; folders: RailFolder[]; unreadLabel: (n: number, name: string) => string }) {
  // Nombre al pasar el mouse o con foco, al instante y a la derecha (el title nativo tarda y a veces no aparece).
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const show = (el: HTMLElement, f: RailFolder) => {
    const r = el.getBoundingClientRect();
    setTip({ text: f.unread > 0 ? unreadLabel(f.unread, f.name) : f.name, x: r.right + 10, y: r.top + r.height / 2 });
  };
  if (!folders.length) return null;
  return (
    <nav className="folder-rail" aria-label={label} onMouseLeave={() => setTip(null)} onScroll={() => setTip(null)}>
      <ul role="list">
        {folders.map((f) => (
          <li key={f.id} className={f.depth ? 'is-sub' : undefined}>
            <Link
              href={f.href}
              prefetch={false}
              className={`folder-rail-btn${f.active ? ' is-active' : ''}`}
              aria-current={f.active ? 'page' : undefined}
              aria-label={f.unread > 0 ? unreadLabel(f.unread, f.name) : f.name}
              onMouseEnter={(e) => show(e.currentTarget, f)}
              onFocus={(e) => show(e.currentTarget, f)}
              onBlur={() => setTip(null)}
              style={f.color ? { ['--fr-c' as string]: f.color } : { ['--fr-h' as string]: String(folderHue(f.name)) }}
            >
              <span className="folder-rail-ini" aria-hidden>
                {folderInitials(f.name)}
              </span>
              {f.unread > 0 && <span className="folder-rail-dot" aria-hidden />}
            </Link>
          </li>
        ))}
      </ul>
      {tip &&
        typeof document !== 'undefined' &&
        createPortal(
          <span className="folder-rail-tip" role="tooltip" style={{ left: tip.x, top: tip.y }}>
            {tip.text}
          </span>,
          document.body,
        )}
    </nav>
  );
}
