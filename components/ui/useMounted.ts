'use client';

import { useEffect, useState } from 'react';

/**
 * true después de montar. Lo que depende de la zona o el "ahora" del navegador
 * se escribe recién ahí: el servidor no los sabe y el texto no coincidiría al
 * hidratar (error #418).
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
