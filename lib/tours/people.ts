import type { TourDef } from './index';

/**
 * Tour de People (directorio, organigrama, ausencias y evaluaciones, como BambooHR).
 * Textos en common.json › tour.people.
 * Arranca en el directorio (/app/people) y no cambia de página: lo demás está
 * en el lateral de la app.
 * Anclajes `data-tour`:
 *   people-person    components/people/Directory.tsx (la primera fila del directorio)
 *   people-filters   components/people/Directory.tsx (búsqueda y filtros)
 *   people-add       components/people/Directory.tsx (Agregar persona, solo RR. HH.)
 *   people-org       components/app/sidebar-nav.ts (Organigrama en el lateral)
 *   people-time-off  components/app/sidebar-nav.ts (Ausencias: pedir días y aprobarlos)
 *   people-reviews   components/app/sidebar-nav.ts (Evaluaciones y encuestas)
 *   people-settings  components/app/sidebar-nav.ts (Ajustes de People: políticas, campos, feriados)
 * Agregar persona se ve solo para RR. HH. (sin el botón, el paso se saltea).
 * Evaluaciones, solo para equipo; ajustes, solo para quien administra. En el
 * teléfono el lateral es un cajón: organigrama, ausencias, evaluaciones y
 * ajustes se saltean.
 */
export const PEOPLE_TOUR = {
  key: 'people',
  startPath: '/app/people',
  paths: ['/app/people'],
  steps: [
    { id: 'intro', askAudience: true },
    { id: 'person', targets: ['people-person'] },
    { id: 'filters', targets: ['people-filters'] },
    { id: 'add', targets: ['people-add'] },
    { id: 'org', targets: ['people-org'] },
    { id: 'timeOff', targets: ['people-time-off'] },
    { id: 'reviews', targets: ['people-reviews'], audience: 'team' },
    { id: 'settings', targets: ['people-settings'], adminOnly: true },
    { id: 'done' },
  ],
} as const satisfies TourDef;
