import type { TourDef } from './index';

/**
 * Tour de Track (issues, como Linear). Textos en common.json › tour.track.
 * Arranca en el resumen (/app/track, adonde lleva el lanzador) y sigue en
 * Issues: el paso "abrí Issues" se cumple con el clic en el lateral, y el
 * motor sigue montado en el layout de Track al cambiar de página.
 * Anclajes `data-tour`:
 *   track-new-team   components/track/TrackOverview.tsx (resumen sin teams)
 *   track-overview   components/track/TrackOverview.tsx (la tabla de teams)
 *   app-new          components/app/AppSidebar.tsx (botón Nuevo del lateral)
 *   track-inbox      components/app/sidebar-nav.ts (Inbox de Track)
 *   track-my-issues  components/app/sidebar-nav.ts (My issues)
 *   track-issues     components/app/sidebar-nav.ts (Issues del workspace)
 *   track-filters    components/track/IssueFilters.tsx (botón de filtro y chips)
 *   track-display    components/track/IssueDisplayOptions.tsx (lista, tablero, agrupar, ordenar)
 *   track-views      components/track/SavedViewsMenu.tsx (vistas guardadas)
 * En el teléfono el lateral es un cajón: sus pasos se saltean y el de
 * atajos va centrado igual.
 */
export const TRACK_TOUR = {
  key: 'track',
  startPath: '/app/track',
  paths: ['/app/track'],
  steps: [
    { id: 'intro' },
    { id: 'newTeam', targets: ['track-new-team'] },
    { id: 'overview', targets: ['track-overview'] },
    { id: 'newIssue', targets: ['app-new'] },
    { id: 'inbox', targets: ['track-inbox'] },
    { id: 'myIssues', targets: ['track-my-issues'] },
    { id: 'issues', targets: ['track-issues'], advanceOn: 'click' },
    { id: 'filters', targets: ['track-filters'] },
    { id: 'display', targets: ['track-display'] },
    { id: 'views', targets: ['track-views'] },
    { id: 'shortcuts' },
    { id: 'done' },
  ],
} as const satisfies TourDef;
