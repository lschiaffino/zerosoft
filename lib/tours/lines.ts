import type { TourDef } from './index';

/**
 * Tour de Lines (la bandeja de WhatsApp). Textos en common.json › tour.lines.
 * Anclajes `data-tour`:
 *   lines-connect      components/groups/GetStarted.tsx (bandeja sin números)
 *   lines-line-select  components/groups/LineFolders.tsx (con dos líneas o más)
 *   lines-chat-list    components/groups/InboxShell.tsx (la lista)
 *   lines-filters      components/groups/InboxShell.tsx (pestañas de filtro)
 *   lines-search       components/groups/InboxShell.tsx (buscador)
 *   lines-chat-row     components/groups/InboxShell.tsx (cada fila; gana la primera)
 *   lines-composer     components/groups/ChatThread.tsx (responder)
 *   lines-assign       components/groups/ChatThread.tsx (responsable del chat)
 *   lines-note         components/groups/ChatThread.tsx (respuesta o nota interna)
 *   lines-settings     components/app/sidebar-nav.ts (Ajustes de Lines en el lateral)
 * Sin números, los pasos de la bandeja no encuentran su elemento y se saltean:
 * queda el de conectar una línea.
 */
export const LINES_TOUR = {
  key: 'lines',
  startPath: '/app/lines/inbox',
  paths: ['/app/lines'],
  steps: [
    { id: 'intro', askAudience: true },
    { id: 'connect', targets: ['lines-connect'] },
    { id: 'lineSelect', targets: ['lines-line-select'] },
    { id: 'chatList', targets: ['lines-chat-list'] },
    { id: 'filters', targets: ['lines-filters'] },
    { id: 'search', targets: ['lines-search'] },
    { id: 'openChat', targets: ['lines-chat-row'], advanceOn: 'click' },
    { id: 'composer', targets: ['lines-composer'] },
    // En el teléfono el responsable va en el menú del chat: el paso sale centrado igual.
    { id: 'assign', targets: ['lines-assign'], ifMissing: 'center', audience: 'team' },
    { id: 'note', targets: ['lines-note'], audience: 'team' },
    { id: 'lineAccess', targets: ['lines-settings'], ifMissing: 'center', audience: 'team', adminOnly: true },
    { id: 'settings', targets: ['lines-settings'], audience: 'solo', adminOnly: true },
    { id: 'done' },
  ],
} as const satisfies TourDef;
