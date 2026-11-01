import type { ReactNode } from 'react';
import { DATE_SLOT, splitAroundDate } from '@/lib/date-slot';

export { DATE_SLOT };

/**
 * Una frase traducida con una fecha adentro ("Until {date}") donde la fecha es un
 * componente del navegador (LocalDate). t.rich no sirve para un argumento simple:
 * deja la función en lo que se le manda al cliente y rompe la página.
 */
export function TextAroundDate({ text, children }: { text: string; children: ReactNode }) {
  const [before, after] = splitAroundDate(text);
  return (
    <>
      {before}
      {children}
      {after}
    </>
  );
}
