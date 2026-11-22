import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-22-wa-vip',
  date: '2026-11-22',
  title: {
    en: 'Inbox and Lines: a VIP split for the people who matter',
    es: 'Inbox y Lines: una división VIP para las personas importantes',
    pt: 'Inbox e Lines: uma divisão VIP para as pessoas importantes',
  },
  items: [
    {
      product: 'inbox',
      en: 'Mark as VIP, in the ⋯ menu of a chat or with a right click on the row, marks the person, not the chat. The VIP tab lists their WhatsApp chats on any linked account and their emails. Groups are not marked.',
      es: 'Marcar como VIP, en el menú ⋯ de un chat o con clic derecho en la fila, marca a la persona, no al chat. La pestaña VIP lista sus chats de WhatsApp de cualquier cuenta vinculada y sus correos. Los grupos no se marcan.',
      pt: 'Marcar como VIP, no menu ⋯ de uma conversa ou com o clique direito na linha, marca a pessoa, não a conversa. A aba VIP lista as conversas de WhatsApp dela em qualquer conta vinculada e os e-mails dela. Os grupos não são marcados.',
    },
    {
      product: 'groups',
      en: 'The same Mark as VIP in Lines, for the whole team: the VIP tab, and the VIP filter in the filter panel, list the chats of those people on every line.',
      es: 'El mismo Marcar como VIP en Lines, para todo el equipo: la pestaña VIP, y el filtro VIP del panel de filtros, listan los chats de esas personas en todas las líneas.',
      pt: 'O mesmo Marcar como VIP no Lines, para toda a equipe: a aba VIP, e o filtro VIP do painel de filtros, listam as conversas dessas pessoas em todas as linhas.',
    },
  ],
} satisfies ChangelogEntry;
