import type { TourDef } from './index';

/**
 * Tour de Inbox (WhatsApp y Gmail de la persona). Textos en common.json ›
 * tour.inbox. Inbox es de cada persona (no se comparte con el equipo): no hay
 * pasos de equipo ni pregunta "sola o con un equipo".
 * Anclajes `data-tour`:
 *   inbox-connect    components/inbox/InboxApp.tsx (bandeja sin cuentas)
 *   inbox-chat-list  components/inbox/InboxApp.tsx (la lista)
 *   inbox-filters    components/inbox/InboxApp.tsx (pestañas de filtro)
 *   inbox-search     components/inbox/InboxApp.tsx (buscador)
 *   inbox-chat-row   components/inbox/InboxApp.tsx (cada fila; gana la primera)
 *   inbox-composer   components/inbox/wa/WaComposer.tsx y components/inbox/Composer.tsx (responder)
 *   inbox-triage     components/inbox/wa/WaConversation.tsx y components/inbox/Conversation.tsx (hecho, posponer…)
 *   inbox-settings   components/app/sidebar-nav.ts (Ajustes de Inbox en el lateral)
 * Sin cuentas, los pasos de la bandeja no encuentran su elemento y se saltean:
 * queda el de conectar una cuenta.
 */
export const INBOX_TOUR = {
  key: 'inbox',
  startPath: '/app/inbox',
  paths: ['/app/inbox'],
  steps: [
    { id: 'intro' },
    { id: 'connect', targets: ['inbox-connect'] },
    { id: 'chatList', targets: ['inbox-chat-list'] },
    { id: 'filters', targets: ['inbox-filters'] },
    { id: 'search', targets: ['inbox-search'] },
    { id: 'openChat', targets: ['inbox-chat-row'], advanceOn: 'click' },
    { id: 'composer', targets: ['inbox-composer'] },
    { id: 'triage', targets: ['inbox-triage'] },
    { id: 'settings', targets: ['inbox-settings'] },
    { id: 'done' },
  ],
} as const satisfies TourDef;
