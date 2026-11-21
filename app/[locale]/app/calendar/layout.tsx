import { Suspense, type ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';
import CalOffline from '@/components/calendar/CalOffline';
import AppTour from '@/components/tour/AppTour';
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
      <div className="cal-app">
        <CalOffline>{props.children}</CalOffline>
      </div>
      {/* Tour guiado de Cal (lib/tours/cal.ts): la primera vez, y desde el menú de la cuenta. */}
      <Suspense fallback={null}>
        <AppTour tour="cal" />
      </Suspense>
    </ClientMessages>
  );
}
