'use client';

import LocalText from './LocalText';
import { formatDate, formatDateTime } from '@/lib/utils';

/**
 * Fecha u hora guardada (ISO, formato de SQLite o día suelto) escrita en la zona
 * del navegador. Para páginas del servidor: allá no se sabe la zona de quien mira
 * (Vercel corre en UTC), así que el texto se arma acá y LocalText evita el #418.
 * Un día suelto ('2026-03-15') es un día del calendario: no se corre de zona.
 */
export default function LocalDate({
  value,
  locale,
  kind = 'datetime',
  className,
}: {
  value: string | null | undefined;
  locale: string;
  kind?: 'date' | 'datetime';
  className?: string;
}) {
  if (!value) return null;
  return <LocalText className={className}>{kind === 'date' ? formatDate(value, locale) : formatDateTime(value, locale)}</LocalText>;
}
