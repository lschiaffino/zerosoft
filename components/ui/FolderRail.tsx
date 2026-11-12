'use client';

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
  if (!folders.length) return null;
  return (
    <nav className="folder-rail" aria-label={label}>
      <ul role="list">
        {folders.map((f) => (
          <li key={f.id} className={f.depth ? 'is-sub' : undefined}>
            <Link
              href={f.href}
              prefetch={false}
              className={`folder-rail-btn${f.active ? ' is-active' : ''}`}
              aria-current={f.active ? 'page' : undefined}
              aria-label={f.unread > 0 ? unreadLabel(f.unread, f.name) : f.name}
              title={f.name}
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
    </nav>
  );
}
