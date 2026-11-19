import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-19-search-name-first',
  date: '2026-11-19',
  title: {
    en: 'Search shows the chats whose name matches first',
    es: 'El buscador muestra primero los chats cuyo nombre coincide',
    pt: 'A busca mostra primeiro as conversas cujo nome coincide',
  },
  items: [
    {
      product: 'groups',
      en: 'When you search the chat list, the chats whose name or number matches come first, even if their last message is old. The chats that only mention the word in a message come after. Pinned chats no longer jump ahead while you search.',
      es: 'Al buscar en la lista de chats, primero van los chats cuyo nombre o número coincide, aunque su último mensaje sea viejo. Después van los chats que solo mencionan la palabra en algún mensaje. Los chats fijados ya no se adelantan mientras buscás.',
      pt: 'Ao buscar na lista de conversas, primeiro vêm as conversas cujo nome ou número coincide, mesmo que a última mensagem seja antiga. Depois vêm as conversas que só mencionam a palavra em alguma mensagem. As conversas fixadas não passam mais na frente enquanto você busca.',
    },
    {
      product: 'inbox',
      en: 'Search in Inbox orders the same way: chats and emails whose name, number or address matches come first, under "Chats", and the ones found by the text of a message come after. Cmd+K follows the same order.',
      es: 'El buscador de Inbox ordena igual: primero los chats y correos cuyo nombre, número o dirección coincide, bajo "Chats", y después los que se encontraron por el texto de un mensaje. Cmd+K sigue el mismo orden.',
      pt: 'A busca do Inbox ordena do mesmo jeito: primeiro as conversas e os e-mails cujo nome, número ou endereço coincide, em "Conversas", e depois os encontrados pelo texto de uma mensagem. O Cmd+K segue a mesma ordem.',
    },
  ],
} satisfies ChangelogEntry;
