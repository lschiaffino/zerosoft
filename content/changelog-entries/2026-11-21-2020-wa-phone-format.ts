import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-21-2020-wa-phone-format',
  date: '2026-11-21',
  title: {
    en: 'Lines and Inbox: phone numbers look like they do on WhatsApp Web',
    es: 'Lines e Inbox: los teléfonos se ven como en WhatsApp Web',
    pt: 'Lines e Inbox: os telefones aparecem como no WhatsApp Web',
  },
  items: [
    {
      product: 'groups',
      en: 'Numbers show in international format, like +54 9 11 5555-0000, under the chat name, next to whoever writes in a group, in the member list, in replies and in the chat list preview. Before, some of those places showed the bare digits. Besides Argentina, the United States and Brazil, Mexico, Chile, Colombia, Uruguay, Spain and the United Kingdom are now formatted too. Hidden numbers stay hidden.',
      es: 'Los números se ven en formato internacional, como +54 9 11 5555-0000, debajo del nombre del chat, al lado de quien escribe en un grupo, en la lista de miembros, en las respuestas citadas y en la vista previa de la lista de chats. Antes algunos de esos lugares mostraban los dígitos sueltos. Además de Argentina, Estados Unidos y Brasil, ahora también tienen formato México, Chile, Colombia, Uruguay, España y Reino Unido. Los números ocultos siguen ocultos.',
      pt: 'Os números aparecem em formato internacional, como +54 9 11 5555-0000, embaixo do nome da conversa, ao lado de quem escreve em um grupo, na lista de membros, nas respostas citadas e na prévia da lista de conversas. Antes alguns desses lugares mostravam os dígitos soltos. Além de Argentina, Estados Unidos e Brasil, agora também têm formato México, Chile, Colômbia, Uruguai, Espanha e Reino Unido. Os números ocultos continuam ocultos.',
    },
    {
      product: 'inbox',
      en: 'In a group, when someone without a saved name writes last, the chat list and search results show their number formatted instead of bare digits.',
      es: 'En un grupo, cuando escribe último alguien sin nombre guardado, la lista de chats y los resultados de búsqueda muestran su número con formato en lugar de los dígitos sueltos.',
      pt: 'Em um grupo, quando quem escreveu por último não tem nome salvo, a lista de conversas e os resultados da busca mostram o número com formato em vez dos dígitos soltos.',
    },
  ],
} satisfies ChangelogEntry;
