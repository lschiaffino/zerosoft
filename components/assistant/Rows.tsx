'use client';

import { useCallback, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { initialRows, nextReveal, type Reveal } from '@/lib/assistant/scroll';
import { useHoldScroll } from './useFollow';

/** "Mostrar las 27" o "Mostrar 100 más". */
export function useRevealLabel() {
  const t = useTranslations('assistant');
  return useCallback((r: Reveal) => (r.kind === 'all' ? t('rows.showAll', { count: r.total }) : t('rows.showMore', { count: r.count })), [t]);
}

/**
 * Lista larga de una tarjeta (carpetas, chats que no encontró): los primeros
 * renglones y un botón que suma el resto en el lugar. Sin scroll propio: la
 * charla es la única barra.
 */
export function CollapsedRows({ rows }: { rows: string[] }) {
  const label = useRevealLabel();
  const hold = useHoldScroll();
  const [shown, setShown] = useState(() => initialRows(rows.length));
  const listRef = useRef<HTMLUListElement>(null);
  const next = nextReveal(rows.length, shown);
  return (
    <>
      <ul className="asst-detail-list" data-testid="assistant-action-list" ref={listRef}>
        {rows.slice(0, shown).map((l, i) => (
          <li key={i} tabIndex={-1}>
            {l}
          </li>
        ))}
      </ul>
      {next && (
        <button
          type="button"
          className="btn btn-ghost btn-sm asst-show-rows"
          data-testid="assistant-show-rows"
          onClick={() => {
            hold();
            const from = shown;
            setShown(next.to);
            // El foco pasa al primer renglón nuevo (el botón puede irse), sin mover la charla.
            requestAnimationFrame(() => (listRef.current?.children[from] as HTMLElement | undefined)?.focus({ preventScroll: true }));
          }}
        >
          {label(next)}
        </button>
      )}
    </>
  );
}
