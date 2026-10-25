'use client';

import { useEffect, useState } from 'react';
import { usePathname } from '@/i18n/navigation';
import { appProductFromPath, type AppProduct } from './sidebar-nav';

interface AppTopbarProps {
  /** Secciones de la app (ya traducidas). Se muestra la de prefijo más largo. */
  sections: Array<{ href: string; label: string }>;
}

/** Una página puede nombrar su sección (el team de Track en vez de "Teams"). */
export const TOPBAR_LABEL_EVENT = 'zs:topbar-label';
export function setTopbarLabel(path: string, label: string | null): void {
  window.dispatchEvent(new CustomEvent(TOPBAR_LABEL_EVENT, { detail: { path, label } }));
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
  const [override, setOverride] = useState<{ path: string; label: string | null } | null>(null);
  useEffect(() => {
    const on = (e: Event) => setOverride((e as CustomEvent<{ path: string; label: string | null }>).detail ?? null);
    window.addEventListener(TOPBAR_LABEL_EVENT, on);
    return () => window.removeEventListener(TOPBAR_LABEL_EVENT, on);
  }, []);
  const custom = override && override.path === pathname ? override.label : null;
  // Una página de detalle (/app/crm/contacts/<id>) muestra su sección (Contacts).
  const section = sections
    .filter((s) => pathname === s.href || pathname.startsWith(`${s.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];

  if (!section && !custom) return null;
  return (
    <p className="band-section">
      <span className="band-sep" aria-hidden="true">
        /
      </span>
      <span className="band-section-name">{custom ?? section?.label}</span>
    </p>
  );
}
