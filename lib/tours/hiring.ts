import type { TourDef } from './index';

/**
 * Tour de Hiring (puestos, pipeline y candidatos, como Greenhouse o Lever).
 * Textos en common.json › tour.hiring.
 * Arranca en el inicio (/app/hiring) y no cambia de página: lo demás está en
 * el lateral de la app.
 * Anclajes `data-tour`:
 *   hiring-new-job     components/hiring/HiringOverview.tsx (Nuevo puesto, quien puede crear puestos)
 *   hiring-jobs        components/hiring/HiringOverview.tsx (puestos abiertos: cada uno abre su pipeline)
 *   hiring-pending     components/hiring/HiringOverview.tsx (evaluaciones que esperan a esta persona)
 *   hiring-recent      components/hiring/HiringOverview.tsx (candidatos recientes)
 *   hiring-candidates  components/app/sidebar-nav.ts (Candidatos en el lateral)
 *   hiring-reports     components/app/sidebar-nav.ts (Informes)
 *   hiring-templates   components/app/sidebar-nav.ts (Plantillas de mails y de oferta)
 *   hiring-settings    components/app/sidebar-nav.ts (Ajustes de Hiring: página de empleos, mails, retención)
 * Nuevo puesto se ve solo para quien puede crear puestos (sin el botón, el
 * paso se saltea). Las evaluaciones son de equipo; los ajustes, de quien
 * administra. En el teléfono el lateral es un cajón: candidatos, informes,
 * plantillas y ajustes se saltean.
 */
export const HIRING_TOUR = {
  key: 'hiring',
  startPath: '/app/hiring',
  paths: ['/app/hiring'],
  steps: [
    { id: 'intro', askAudience: true },
    { id: 'newJob', targets: ['hiring-new-job'] },
    { id: 'jobs', targets: ['hiring-jobs'] },
    { id: 'pending', targets: ['hiring-pending'], audience: 'team' },
    { id: 'recent', targets: ['hiring-recent'] },
    { id: 'candidates', targets: ['hiring-candidates'] },
    { id: 'reports', targets: ['hiring-reports'] },
    { id: 'templates', targets: ['hiring-templates'] },
    { id: 'settings', targets: ['hiring-settings'], adminOnly: true },
    { id: 'done' },
  ],
} as const satisfies TourDef;
