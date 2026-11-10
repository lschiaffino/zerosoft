'use client';

import { useEffect, useRef } from 'react';

/**
 * Navegación sin pasar por el servidor, para pantallas donde la URL solo
 * cambia qué lista se ve (la carpeta, la vista o la lista guardada de una
 * bandeja). `history.pushState` deja la URL nueva en el historial y Next la
 * refleja en `usePathname` y `useSearchParams`, así que atrás y adelante
 * funcionan y un link se puede compartir; pero no se pide nada al servidor,
 * no aparece el esqueleto de carga y nada de lo que está montado (el chat
 * abierto, lo escrito en el composer) se vuelve a crear.
 */
export function pushUrl(url: string): void {
  if (url === window.location.pathname + window.location.search + window.location.hash) return;
  window.history.pushState(null, '', url);
}

/**
 * Atiende los clics en links de la página (también los del sidebar, que
 * viven fuera de este componente): `resolve` recibe la URL del link y
 * devuelve la URL a la que ir sin recargar, o null para dejar que el link
 * navegue como siempre. No toca clics con Cmd/Ctrl/Shift, botón del medio,
 * links a otra pestaña ni descargas.
 */
export function useShallowLinks(resolve: (url: URL, link: HTMLAnchorElement) => string | null): void {
  const ref = useRef(resolve);
  useEffect(() => {
    ref.current = resolve;
  });
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!link || (link.target && link.target !== '_self') || link.hasAttribute('download')) return;
      let url: URL;
      try {
        url = new URL(link.href, window.location.href);
      } catch {
        return;
      }
      // Otro sitio, o un ancla dentro de la página (ir a un mensaje): no es un cambio de lista.
      if (url.origin !== window.location.origin || url.hash) return;
      const to = ref.current(url, link);
      if (to === null) return;
      // El link no navega: Next ve el clic ya atendido y no pide la página.
      e.preventDefault();
      pushUrl(to);
    };
    // En captura: antes que el onClick del Link de Next.
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);
}
