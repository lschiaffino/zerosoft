import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-lines-export-admins',
  date: '2026-11-20',
  title: {
    en: 'Lines: only admins can export messages',
    es: 'Lines: solo los admins pueden exportar mensajes',
    pt: 'Lines: só os admins podem exportar mensagens',
  },
  items: [
    {
      product: 'groups',
      en: 'Exporting a chat\'s messages, and exporting chats or tickets to CSV, is now limited to the workspace owner and admins. Members no longer see the export buttons, and the export is refused if someone calls it directly.',
      es: 'Exportar los mensajes de un chat, y exportar chats o tickets a CSV, ahora es solo para el dueño del workspace y los admins. Los miembros ya no ven los botones de exportar, y si alguien lo pide directo, se rechaza.',
      pt: 'Exportar as mensagens de uma conversa, e exportar conversas ou tickets em CSV, agora é só para o dono do workspace e os admins. Os membros não veem mais os botões de exportar, e o pedido é recusado se alguém chamar direto.',
    },
  ],
} satisfies ChangelogEntry;
