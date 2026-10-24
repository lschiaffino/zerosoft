'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import Icon from '@/components/app/icons';
import { useShellBranch } from '@/components/app/useShellBranch';

/** Evento que avisa al sidebar que cambió la lista de objetos (crear, renombrar, borrar). */
export const OBJECTS_CHANGED = 'zs:crm-objects-changed';

export function notifyObjectsChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(OBJECTS_CHANGED));
}

interface ObjectItem {
  id: string;
  slug: string;
  plural: string;
}

/**
 * Objetos propios en el sidebar del CRM, colgados de "Objetos propios" (como
 * las pizarras de Board). Se recarga al navegar y con OBJECTS_CHANGED; el
 * abierto queda marcado.
 */
export default function CrmObjectsBranch() {
  const t = useTranslations('crm');
  const pathname = usePathname();
  const slot = useShellBranch();
  const [objects, setObjects] = useState<ObjectItem[] | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch('/api/crm/objects')
        .then((r) => (r.ok ? (r.json() as Promise<{ rows: ObjectItem[] }>) : null))
        .then((d) => {
          if (alive && d) setObjects(d.rows);
        })
        .catch(() => null);
    void load();
    window.addEventListener(OBJECTS_CHANGED, load);
    return () => {
      alive = false;
      window.removeEventListener(OBJECTS_CHANGED, load);
    };
  }, [pathname]);

  if (!slot || !objects || objects.length === 0) return null;
  return createPortal(
    <nav className="docs-branch crm-objects-branch" aria-label={t('objects.groupLabel')}>
      <ul className="docs-tree" role="list">
        {objects.map((o) => {
          const href = `/app/crm/objects/${o.slug}`;
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={o.id} className={`docs-tree-row${active ? ' active' : ''}`}>
              <span className="docs-tree-chevron-spacer" aria-hidden="true" />
              <Link href={href} className="docs-tree-link" aria-current={active ? 'page' : undefined}>
                <span className="docs-tree-icon" aria-hidden="true">
                  <Icon name="objects" size={14} />
                </span>
                <span className="docs-tree-title">{o.plural}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>,
    slot,
  );
}
