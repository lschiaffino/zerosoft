'use client';

import { useLocale } from 'next-intl';
import { formatDateTime, formatTimeAgo } from '@/lib/datetime';
import { useMounted } from '@/components/ui/useMounted';

export { useMounted };

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
