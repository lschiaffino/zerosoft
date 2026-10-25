'use client';

import { useEffect, useState } from 'react';
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
  // Una app puede nombrar la sección actual (p. ej. el canal abierto en Talk) con el evento 'zs:crumb'.
  const [crumb, setCrumb] = useState<{ path: string; label: string } | null>(null);
  useEffect(() => {
    const on = (e: Event) => setCrumb((e as CustomEvent<{ path: string; label: string } | null>).detail ?? null);
    window.addEventListener('zs:crumb', on);
    return () => window.removeEventListener('zs:crumb', on);
  }, []);
  if (crumb && crumb.path === pathname) {
    return (
      <p className="band-section">
        <span className="band-sep" aria-hidden="true">
          /
        </span>
        <span className="band-section-name">{crumb.label}</span>
      </p>
    );
  }
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
