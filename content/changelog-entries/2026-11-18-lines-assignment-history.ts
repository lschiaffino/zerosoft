import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-18-lines-assignment-history',
  date: '2026-11-18',
  title: {
    en: 'Lines: assignment history in each chat',
    es: 'Lines: historial de asignaciones en cada chat',
    pt: 'Lines: histórico de atribuições em cada chat',
  },
  items: [
    {
      product: 'groups',
      en: 'The chat details panel lists who had the chat, who it went to, when and why: assigned by hand, by a round-robin rule, or reassigned because someone went offline. The same list is available from the API at GET /api/groups/assignments?chat=<id>.',
      es: 'El panel de detalles del chat lista quién lo tenía, a quién pasó, cuándo y por qué: asignado a mano, por una regla round-robin o reasignado porque alguien se desconectó. La misma lista está en la API, en GET /api/groups/assignments?chat=<id>.',
      pt: 'O painel de detalhes do chat lista quem estava com ele, para quem passou, quando e por quê: atribuído à mão, por uma regra round-robin ou reatribuído porque alguém ficou offline. A mesma lista está na API, em GET /api/groups/assignments?chat=<id>.',
    },
  ],
} satisfies ChangelogEntry;
