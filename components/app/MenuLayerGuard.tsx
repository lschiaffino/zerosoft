'use client';

import { useEffect } from 'react';
import { closeMenusOutside, closeUnregisteredPopups, LAYER_TRIGGER_ATTR, visible } from '@/lib/ui/layers';

/**
 * Red de seguridad del registro de capas (lib/ui/layers.ts) para los menús que
 * todavía arman su propio estado: cuando un botón con aria-haspopup pasa a
 * aria-expanded="true" (con mouse, teclado o atajo), se cierran los demás
 * menús abiertos que no lo contienen, registrados o no. Así nunca quedan dos
 * menús encimados aunque un menú solo escuche el mousedown de afuera.
 */
export default function MenuLayerGuard() {
  useEffect(() => {
    const mo = new MutationObserver((records) => {
      for (const rec of records) {
        const el = rec.target as HTMLElement;
        if (el.getAttribute('aria-expanded') !== 'true' || !el.matches('[aria-haspopup]:not([aria-haspopup="false"])')) continue;
        // Los registrados ya hicieron esto al abrirse.
        if (el.hasAttribute(LAYER_TRIGGER_ATTR)) continue;
        // Una copia oculta del botón (listas medidas) no es un menú nuevo a la vista.
        if (!visible(el)) continue;
        closeMenusOutside(el);
        closeUnregisteredPopups(el);
      }
    });
    mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['aria-expanded'] });
    return () => mo.disconnect();
  }, []);
  return null;
}
