import type { TourDef } from './index';

/**
 * Tour de Pulse (analítica de producto y web, como PostHog). Textos en
 * common.json › tour.pulse.
 * Arranca en el inicio (/app/pulse, web analytics) y no cambia de página: lo
 * demás está en el lateral de la app.
 * Anclajes `data-tour`:
 *   pulse-new-project  components/analytics/NoProject.tsx (vacío: crear el primer proyecto, quien administra)
 *   pulse-setup        components/analytics/ProjectBar.tsx (Instalación y ajustes, si ya hay proyecto)
 *   pulse-stats        components/analytics/WebOverview.tsx (visitantes, páginas vistas, sesiones)
 *   pulse-events       components/app/sidebar-nav.ts (Actividad en el lateral)
 *   pulse-live         components/analytics/WebOverview.tsx (Ver eventos en vivo: en el teléfono)
 *   pulse-insights     components/app/sidebar-nav.ts (Insights en el lateral)
 *   pulse-dashboards   components/app/sidebar-nav.ts (Tableros en el lateral)
 * Sin proyecto la página muestra el vacío: crear proyecto señala su botón y
 * la instalación y los números se saltean (sin el botón, porque no
 * administra, también se saltea). Con proyecto, al revés. En el teléfono el
 * lateral es un cajón: la actividad señala el link de la página y los
 * insights y tableros se saltean.
 */
export const PULSE_TOUR = {
  key: 'pulse',
  startPath: '/app/pulse',
  paths: ['/app/pulse'],
  steps: [
    { id: 'intro' },
    { id: 'newProject', targets: ['pulse-new-project'] },
    { id: 'setup', targets: ['pulse-setup'] },
    { id: 'web', targets: ['pulse-stats'] },
    { id: 'events', targets: ['pulse-events', 'pulse-live'] },
    { id: 'insights', targets: ['pulse-insights'] },
    { id: 'dashboards', targets: ['pulse-dashboards'] },
    { id: 'done' },
  ],
} as const satisfies TourDef;
