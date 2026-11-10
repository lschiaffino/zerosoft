'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { isSettingsRoute } from '@/lib/settings-embed';

/**
 * Dentro de la ventana de Ajustes del escritorio: un link a algo que no es
 * ajustes (abrir el CRM, un doc) no se abre en esa ventana. Se hace una
 * navegación completa, que la app intercepta (nav.rs, settings_route) y
 * abre en la ventana principal. Si la navegación vino por el router (push
 * desde código), se vuelve atrás y se pide igual.
 */
export default function SettingsEmbedGuard() {
  const pathname = usePathname();

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || isSettingsRoute(url.pathname)) return;
      e.preventDefault();
      e.stopPropagation();
      window.location.assign(url.href);
    }
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  useEffect(() => {
    if (isSettingsRoute(pathname)) return;
    // La app cancela esta navegación y la abre en la ventana principal; acá se vuelve a la sección.
    window.location.assign(window.location.href);
    const back = window.setTimeout(() => window.history.back(), 80);
    return () => window.clearTimeout(back);
  }, [pathname]);

  return null;
}
