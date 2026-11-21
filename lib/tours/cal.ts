import type { TourDef } from './index';

/**
 * Tour de Cal (reservas, como Cal.com). Textos en common.json › tour.cal.
 * Arranca en el resumen de Cal (/app/calendar) y no cambia de página: todo lo
 * que señala está en el resumen o en el lateral.
 * Anclajes `data-tour`:
 *   cal-new           components/calendar/EventTypesView.tsx (Nuevo tipo de evento, en la cabecera)
 *   cal-event-item    components/calendar/EventTypesView.tsx (primera fila: link para reservar y acciones)
 *   cal-upcoming      app/[locale]/app/calendar/(home)/page.tsx (Próximas reservas)
 *   cal-bookings      components/app/sidebar-nav.ts (Reservas en el lateral)
 *   cal-all-bookings  app/[locale]/app/calendar/(home)/page.tsx (Todas las reservas; en el teléfono, sin lateral)
 *   cal-availability  components/app/sidebar-nav.ts (Disponibilidad)
 *   cal-routing       components/app/sidebar-nav.ts (Formularios de ruteo)
 *   cal-settings      components/app/sidebar-nav.ts (Ajustes de Cal)
 * Equipo: suma los formularios de ruteo (mandar a cada persona con quien
 * corresponde). En el teléfono el lateral es un cajón: disponibilidad, ruteo
 * y ajustes se saltean. Sin tipos de evento, el paso de la fila se saltea.
 */
export const CAL_TOUR = {
  key: 'cal',
  startPath: '/app/calendar',
  paths: ['/app/calendar'],
  steps: [
    { id: 'intro', askAudience: true },
    { id: 'newEventType', targets: ['cal-new'] },
    { id: 'eventType', targets: ['cal-event-item'] },
    { id: 'upcoming', targets: ['cal-upcoming'] },
    { id: 'bookings', targets: ['cal-bookings', 'cal-all-bookings'] },
    { id: 'availability', targets: ['cal-availability'] },
    { id: 'routing', targets: ['cal-routing'], audience: 'team' },
    { id: 'settings', targets: ['cal-settings'] },
    { id: 'done' },
  ],
} as const satisfies TourDef;
