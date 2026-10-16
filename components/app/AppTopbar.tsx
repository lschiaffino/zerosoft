'use client';

import { usePathname } from '@/i18n/navigation';
import { appProductFromPath, type AppProduct } from './sidebar-nav';

interface AppTopbarProps {
  /** Secciones de la app (ya traducidas). El título es la de prefijo más largo. */
  sections: Array<{ href: string; label: string }>;
}

const PRODUCT_NAMES: Record<AppProduct, string> = {
  link: 'Link',
  crm: 'CRM',
  docs: 'Docs',
  calendar: 'Cal',
  track: 'Track',
  chat: 'Chat',
  flow: 'Flow',
  notes: 'Notes',
  board: 'Board',
  agents: 'Agents',
  robots: 'Robots',
};

export function productFromPath(pathname: string): AppProduct {
  return appProductFromPath(pathname);
}

export default function AppTopbar({ sections }: AppTopbarProps) {
  const pathname = usePathname();
  const productName = PRODUCT_NAMES[productFromPath(pathname)];
  // Una página de detalle (/app/crm/contacts/<id>) muestra su sección (Contacts).
  const section = sections
    .filter((s) => pathname === s.href || pathname.startsWith(`${s.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];

  return (
    <div className="app-topbar-inner">
      <div className="app-topbar-product">
        <span className="app-topbar-icon" aria-hidden="true">
          0
        </span>
        <span className="app-topbar-name">{productName}</span>
        {section && (
          <>
            <span className="app-topbar-sep" aria-hidden="true">/</span>
            <span className="app-topbar-page">{section.label}</span>
          </>
        )}
      </div>
    </div>
  );
}
