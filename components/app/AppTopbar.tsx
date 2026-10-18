'use client';

import { usePathname } from '@/i18n/navigation';
import { appProductFromPath, type AppProduct } from './sidebar-nav';

interface AppTopbarProps {
  /** Secciones de la app (ya traducidas). Se muestra la de prefijo más largo. */
  sections: Array<{ href: string; label: string }>;
}

export function productFromPath(pathname: string): AppProduct {
  return appProductFromPath(pathname);
}

/**
 * La sección actual dentro de la banda ("CRM / Contactos"). El nombre del
 * producto lo pone el switcher de AppSidebar; acá va solo la sección.
 */
export default function AppTopbar({ sections }: AppTopbarProps) {
  const pathname = usePathname();
  // Una página de detalle (/app/crm/contacts/<id>) muestra su sección (Contacts).
  const section = sections
    .filter((s) => pathname === s.href || pathname.startsWith(`${s.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];

  if (!section) return null;
  return (
    <p className="band-section">
      <span className="band-sep" aria-hidden="true">
        /
      </span>
      <span className="band-section-name">{section.label}</span>
    </p>
  );
}
