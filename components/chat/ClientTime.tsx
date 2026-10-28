'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { formatDateTime, formatTimeAgo } from '@/lib/datetime';

/** true después de montar: lo que depende de la hora o la zona del navegador se dibuja recién ahí. */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

/**
 * Hora relativa ("hace 5 min") o absoluta, dibujada en el cliente: el server
 * no sabe la zona ni el "ahora" del navegador y el texto no coincidiría al
 * hidratar (error #418).
 */
export default function ClientTime({ iso, mode = 'ago', className }: { iso: string; mode?: 'ago' | 'date'; className?: string }) {
  const locale = useLocale();
  const mounted = useMounted();
  return (
    <time className={className} dateTime={iso} title={mounted ? formatDateTime(iso, locale) : undefined}>
      {mounted ? (mode === 'ago' ? formatTimeAgo(iso, locale) : formatDateTime(iso, locale)) : ''}
    </time>
  );
}
