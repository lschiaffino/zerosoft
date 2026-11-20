'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from './ui';
// Los estilos del tablero van con el botón: al prenderlo, la bandeja cambia de forma sin esperar al código del tablero.
import '@/styles/lines-kanban.css';

/** Tablero: tres columnas verticales. */
function KanbanIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3.5" y="4" width="4.5" height="15" rx="1" />
      <rect x="9.75" y="4" width="4.5" height="10" rx="1" />
      <rect x="16" y="4" width="4.5" height="12.5" rx="1" />
    </svg>
  );
}

/**
 * La vista elegida (lista o kanban), por persona: arranca con lo que trajo el
 * servidor y se guarda al cambiar.
 */
export function useKanbanView(initial: boolean): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(initial);
  const set = useCallback((next: boolean) => {
    setOn(next);
    void api('/api/groups/kanban', { method: 'PUT', body: { on: next } });
  }, []);
  return [on, set];
}

/** El botón chico junto al selector de línea de la bandeja: prende y apaga el kanban. */
export function KanbanToggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  const t = useTranslations('groups.kanban');
  return (
    <button
      type="button"
      className={`wa-icon-btn gr-kanban-toggle${on ? ' is-on' : ''}`}
      aria-pressed={on}
      aria-label={t('toggle')}
      title={on ? t('toggleOff') : t('toggleOn')}
      data-testid="lines-kanban-toggle"
      onClick={() => onChange(!on)}
    >
      <KanbanIcon size={18} />
    </button>
  );
}
