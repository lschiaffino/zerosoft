import type { TourDef } from './index';

/**
 * Tour de Talk (mensajería de equipo, como Slack). Textos en common.json › tour.talk.
 * Talk entra a /app/talk y enseguida pasa al último canal (/app/talk/<id>, o
 * #general): el tour arranca en cualquiera de las dos, nunca en Ajustes ni en
 * Analíticas (startPattern).
 * Anclajes `data-tour`:
 *   talk-channels   components/talk/Sidebar.tsx (sección Canales, con el + para crear uno)
 *   talk-dms        components/talk/Sidebar.tsx (sección Mensajes directos)
 *   talk-composer   components/talk/Composer.tsx (el redactor del canal, no el de un hilo)
 *   talk-threads    components/talk/Sidebar.tsx (Hilos: las respuestas de los hilos que seguís)
 *   talk-search     components/talk/Sidebar.tsx (buscador, Cmd+G)
 *   talk-analytics  components/app/sidebar-nav.ts (Analítica en el lateral de la app)
 *   talk-settings   components/app/sidebar-nav.ts (Ajustes de Talk en el lateral de la app)
 * En el teléfono se ve la lista (canales y mensajes directos) sin la
 * conversación: el paso del redactor se saltea, y el lateral de la app es un
 * cajón: analítica y ajustes también.
 */
export const TALK_TOUR = {
  key: 'talk',
  startPath: '/app/talk',
  startPattern: /^\/app\/talk(?:\/(?!settings$|analytics$)[^/]+)?$/,
  paths: ['/app/talk'],
  steps: [
    { id: 'intro' },
    { id: 'channels', targets: ['talk-channels'] },
    { id: 'dms', targets: ['talk-dms'] },
    { id: 'composer', targets: ['talk-composer'] },
    { id: 'threads', targets: ['talk-threads'] },
    { id: 'search', targets: ['talk-search'] },
    { id: 'analytics', targets: ['talk-analytics'] },
    { id: 'settings', targets: ['talk-settings'] },
    { id: 'done' },
  ],
} as const satisfies TourDef;
