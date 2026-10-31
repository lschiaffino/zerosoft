'use client';

import { useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

/**
 * Barra fina arriba mientras carga una navegación: un clic en un link siempre
 * da respuesta, también cuando la página destino todavía no mostró su esqueleto.
 */
export default function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [pending, setPending] = useState(false);

  useEffect(() => setPending(false), [pathname, search]);

  useEffect(() => {
    if (!pending) return;
    // Una navegación cancelada o una descarga no dejan la barra colgada.
    const timer = setTimeout(() => setPending(false), 15000);
    return () => clearTimeout(timer);
  }, [pending]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented && !(e.target instanceof Element && e.target.closest('a[href]'))) return;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const url = new URL(a.href, window.location.href);
      // Las exportaciones son descargas sin atributo download: la página no cambia.
      if (url.pathname.startsWith('/api/')) return;
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      setPending(true);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  return pending ? <div className="nav-progress" role="progressbar" aria-hidden="true" data-testid="nav-progress" /> : null;
}
