import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-22-wa-list-sender',
  date: '2026-11-22',
  title: {
    en: 'Lines and Inbox: long sender names no longer hide the message in the chat list',
    es: 'Lines e Inbox: un nombre largo ya no tapa el mensaje en la lista de chats',
    pt: 'Lines e Inbox: um nome longo não esconde mais a mensagem na lista de conversas',
  },
  items: [
    {
      product: 'groups',
      en: 'In a group row, the name of who sent the last message is cut with "…" when it is long, and the message always shows next to it, like in WhatsApp.',
      es: 'En la fila de un grupo, el nombre de quien mandó el último mensaje se corta con "…" si es largo y el mensaje siempre se ve al lado, como en WhatsApp.',
      pt: 'Na linha de um grupo, o nome de quem mandou a última mensagem é cortado com "…" quando é longo e a mensagem sempre aparece ao lado, como no WhatsApp.',
    },
    {
      product: 'inbox',
      en: 'In a group row, a long sender name is cut with "…" and the message always shows next to it.',
      es: 'En la fila de un grupo, un nombre largo se corta con "…" y el mensaje siempre se ve al lado.',
      pt: 'Na linha de um grupo, um nome longo é cortado com "…" e a mensagem sempre aparece ao lado.',
    },
  ],
} satisfies ChangelogEntry;
