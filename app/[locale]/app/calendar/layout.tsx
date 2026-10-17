import type { ReactNode } from 'react';

/**
 * Envoltorio de Cal sin caja propia (display: contents): solo da un ámbito
 * para reglas de Cal que dependen de la página, como dejar lugar al botón de
 * feedback a la derecha del pie de los formularios en mobile.
 */
export default function CalendarLayout({ children }: { children: ReactNode }) {
  return <div className="cal-app">{children}</div>;
}
