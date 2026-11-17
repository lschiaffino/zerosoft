import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-17-track-inbox-filter',
  date: '2026-11-17',
  title: {
    en: 'Track: filter and sort the Inbox',
    es: 'Track: filtrar y ordenar la Inbox',
    pt: 'Track: filtrar e ordenar a Inbox',
  },
  items: [
    {
      product: 'track',
      en: 'The Track Inbox has the same Filter and Display buttons as the issue list. Filter by read or unread, type of notification (mentions, assignments, status changes, comments, reminders and more), project, team and who made the change, and pick several values at once. Display sorts newest or oldest first and groups by type, project or team. The filter stays in the address, so you can share it, and the Inbox remembers it the next time you open it. Press F to open the filter.',
      es: 'La Inbox de Track tiene los mismos botones Filtrar y Display que la lista de issues. Filtrá por leídas o sin leer, tipo de notificación (menciones, asignaciones, cambios de estado, comentarios, recordatorios y más), project, team y quién hizo el cambio, con varios valores a la vez. Display ordena primero las más nuevas o las más viejas y agrupa por tipo, project o team. El filtro queda en la dirección, así que se puede compartir, y la Inbox lo recuerda la próxima vez que la abrís. Con F se abre el filtro.',
      pt: 'A Inbox do Track tem os mesmos botões Filtrar e Display da lista de issues. Filtre por lidas ou não lidas, tipo de notificação (menções, atribuições, mudanças de status, comentários, lembretes e mais), project, team e quem fez a mudança, com vários valores ao mesmo tempo. Display ordena primeiro as mais novas ou as mais antigas e agrupa por tipo, project ou team. O filtro fica no endereço, então dá para compartilhar, e a Inbox lembra dele na próxima vez que você abrir. Com F abre o filtro.',
    },
  ],
} satisfies ChangelogEntry;
