import type { TourDef } from './index';

/**
 * Tour de Send (compartir documentos con links que miden, como DocSend).
 * Textos en common.json › tour.send.
 * Arranca en la lista de documentos (/app/send) y sigue en el documento que
 * se abre: el paso "abrí un documento" se cumple con el clic en una fila, y el
 * motor sigue montado en el layout de Send al cambiar de página.
 * Anclajes `data-tour`:
 *   send-new        components/send/SendHome.tsx (Nuevo documento: subir un archivo)
 *   send-doc-item   components/send/SendHome.tsx (el nombre en cada fila; gana la primera)
 *   send-link-new   components/send/LinksPanel.tsx (Nuevo link)
 *   send-links      components/send/LinksPanel.tsx (la sección de links, si el documento todavía no está listo)
 *   send-activity   components/send/DocumentDetail.tsx (pestaña Actividad: quién lo abrió y cuánto leyó)
 *   send-sharing    components/send/DocumentDetail.tsx (privado o visible para el workspace)
 *   send-spaces     components/app/sidebar-nav.ts (Espacios en el lateral)
 *   send-analytics  components/app/sidebar-nav.ts (Analítica en el lateral)
 * Equipo: quién del workspace ve el documento. En el teléfono el lateral es un
 * cajón: espacios y analítica se saltean. Sin documentos, abrir uno y los
 * pasos del documento se saltean, y el tour termina en la lista.
 */
export const SEND_TOUR = {
  key: 'send',
  startPath: '/app/send',
  paths: ['/app/send'],
  steps: [
    { id: 'intro', askAudience: true },
    { id: 'newDocument', targets: ['send-new'] },
    // El lateral antes de abrir un documento: en el teléfono se saltea ahí y la cuenta "n de m" no cambia después del clic.
    { id: 'spaces', targets: ['send-spaces'] },
    { id: 'analytics', targets: ['send-analytics'] },
    { id: 'openDocument', targets: ['send-doc-item'], advanceOn: 'click' },
    { id: 'links', targets: ['send-link-new', 'send-links'] },
    { id: 'activity', targets: ['send-activity'] },
    { id: 'sharing', targets: ['send-sharing'], audience: 'team' },
    { id: 'done' },
  ],
} as const satisfies TourDef;
