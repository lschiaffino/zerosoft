import type { CSSProperties } from 'react';
import { statusGlyphColor } from '@/lib/track-color';

/*
 * Glifos de Track como los de Linear (estado y prioridad). Sin dependencias
 * de la app: los usa también la paleta ⌘K global.
 */

/**
 * Prioridad en tinta: el color de Track queda solo para orientarse. Urgente
 * en rojo, alta y media en tinta, baja en gris (≥3:1 como gráfico).
 */
export function priorityColor(priority: string): string {
  return priority === 'urgent'
    ? 'var(--bad)'
    : priority === 'high' || priority === 'medium'
      ? 'var(--ink)'
      : 'var(--brand-gray-3)';
}

/**
 * Prioridad como en Linear: barras crecientes (baja 1, media 2, alta 3) y
 * urgente como un cuadrado con "!". El color va solo en urgente.
 */
export function PriorityIcon({ priority }: { priority: string }) {
  if (priority === 'urgent') {
    return (
      <svg className="track-prio-icon is-urgent" viewBox="0 0 14 14" width="14" height="14" aria-hidden>
        <rect x="1" y="1" width="12" height="12" rx="2" fill="var(--bad)" />
        <path d="M7 3.6v4.3" stroke="var(--bg)" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="7" cy="10.3" r="1" fill="var(--bg)" />
      </svg>
    );
  }
  if (priority === 'none') {
    // Sin prioridad: tres rayitas grises, como el "---" de Linear.
    return (
      <svg className="track-prio-icon is-none" viewBox="0 0 14 14" width="14" height="14" aria-hidden>
        {[0, 1, 2].map((n) => (
          <rect key={n} x={1.5 + n * 4} y="6.25" width="3" height="1.5" rx="0.5" fill="var(--brand-gray-3)" />
        ))}
      </svg>
    );
  }
  const level = priority === 'high' ? 3 : priority === 'medium' ? 2 : 1;
  return (
    <svg className="track-prio-icon" viewBox="0 0 14 14" width="14" height="14" aria-hidden>
      {[0, 1, 2].map((n) => (
        <rect
          key={n}
          x={1.5 + n * 4}
          y={9 - n * 3}
          width="3"
          height={4 + n * 3}
          rx="0.6"
          fill={n < level ? 'var(--ink)' : 'var(--line-strong, var(--brand-gray-3))'}
          opacity={n < level ? 1 : 0.35}
        />
      ))}
    </svg>
  );
}

/**
 * Glifo de status como en Linear: un círculo. Backlog punteado, por hacer
 * vacío, en progreso con la mitad llena, hecho lleno con tilde y cancelado
 * lleno en gris con cruz.
 */
export function StatusDot({ color, category }: { color: string | null; category: string | null }) {
  const cancelled = category === 'cancelled';
  const c = statusGlyphColor(color, category);
  const filled = category === 'done' || cancelled;
  return (
    <svg className="track-status-glyph" viewBox="0 0 14 14" width="14" height="14" aria-hidden style={{ color: c } as CSSProperties}>
      <circle
        cx="7"
        cy="7"
        r="5.75"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray={category === 'backlog' ? '2.2 1.8' : undefined}
      />
      {category === 'in_progress' && <path d="M7 3.25a3.75 3.75 0 0 1 0 7.5z" fill="currentColor" />}
      {category === 'done' && <path d="M4.4 7.2l1.8 1.8 3.5-3.7" fill="none" stroke="var(--bg)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />}
      {cancelled && <path d="M5 5l4 4M9 5l-4 4" fill="none" stroke="var(--bg)" strokeWidth="1.5" strokeLinecap="round" />}
    </svg>
  );
}

