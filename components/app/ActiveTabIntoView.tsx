'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { usePathname } from '@/i18n/navigation';

const ACTIVE = '[aria-current="page"], [aria-current="true"], [aria-selected="true"], .active, .is-active';

/** En una fila de pestañas con scroll (teléfono), la activa queda a la vista al entrar y al cambiar de pestaña. */
export default function ActiveTabIntoView() {
  const pathname = usePathname();
  const search = useSearchParams()?.toString();
  useEffect(() => {
    for (const row of document.querySelectorAll<HTMLElement>('.ui-tabs, .app-tabs')) {
      if (row.scrollWidth <= row.clientWidth + 1) continue;
      const tab = row.querySelector<HTMLElement>(ACTIVE);
      if (!tab) continue;
      const a = tab.getBoundingClientRect();
      const r = row.getBoundingClientRect();
      row.scrollLeft = Math.max(0, row.scrollLeft + (a.left - r.left) - (row.clientWidth - a.width) / 2);
    }
  }, [pathname, search]);
  return null;
}
