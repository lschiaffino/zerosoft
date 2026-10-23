import type { ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';
import '@/styles/calendar.css';

/**
 * Envoltorio de Cal sin caja propia (display: contents): solo da un ámbito
 * para reglas de Cal que dependen de la página, como dejar lugar al botón de
 * feedback a la derecha del pie de los formularios en mobile.
 */
export default async function CalendarLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <ClientMessages locale={locale} namespaces={['calendar']}>
      <div className="cal-app">{props.children}</div>
    </ClientMessages>
  );
}
