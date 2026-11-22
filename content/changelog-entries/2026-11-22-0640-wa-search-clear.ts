import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-22-wa-search-clear',
  date: '2026-11-22',
  title: {
    en: 'Lines and Inbox: a clear button in the search fields and long chat names cut with an ellipsis',
    es: 'Lines e Inbox: botón para borrar la búsqueda y nombres de chat largos cortados con puntos suspensivos',
    pt: 'Lines e Inbox: botão para limpar a busca e nomes de conversa longos cortados com reticências',
  },
  items: [
    {
      product: 'inbox',
      en: 'The chat list search, Search messages, New chat, Contacts, group members and the emoji and GIF panels have their own clear button instead of the one the browser draws. It shows once you type, empties the field and keeps the cursor in it. A long chat name in the conversation header stays on one line and ends in an ellipsis.',
      es: 'La búsqueda de la lista de chats, Buscar mensajes, Chat nuevo, Contactos, los miembros del grupo y los paneles de emojis y GIF tienen su propio botón para borrar en lugar del que dibuja el navegador. Aparece al escribir, vacía el campo y deja el cursor ahí. Un nombre de chat largo en el encabezado de la conversación queda en una línea y termina en puntos suspensivos.',
      pt: 'A busca da lista de conversas, Pesquisar mensagens, Nova conversa, Contatos, os membros do grupo e os painéis de emojis e GIFs têm seu próprio botão para limpar em vez do que o navegador desenha. Ele aparece ao digitar, esvazia o campo e mantém o cursor nele. Um nome de conversa longo no cabeçalho da conversa fica em uma linha e termina em reticências.',
    },
    {
      product: 'groups',
      en: 'The same clear button in the Lines searches (chat list, Search messages, New chat, Contacts, forward, group members, emoji and GIFs), and long group names end in an ellipsis in the chat header.',
      es: 'El mismo botón para borrar en las búsquedas de Lines (lista de chats, Buscar mensajes, Chat nuevo, Contactos, reenviar, miembros del grupo, emojis y GIF), y los nombres de grupo largos terminan en puntos suspensivos en el encabezado del chat.',
      pt: 'O mesmo botão para limpar nas buscas do Lines (lista de conversas, Pesquisar mensagens, Nova conversa, Contatos, encaminhar, membros do grupo, emojis e GIFs), e os nomes de grupo longos terminam em reticências no cabeçalho da conversa.',
    },
  ],
} satisfies ChangelogEntry;
