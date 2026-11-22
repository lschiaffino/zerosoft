import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-22-wa-favorites',
  date: '2026-11-22',
  title: {
    en: 'Inbox and Lines: Favorites, like the WhatsApp list',
    es: 'Inbox y Lines: Favoritos, como la lista de WhatsApp',
    pt: 'Inbox e Lines: Favoritos, como a lista do WhatsApp',
  },
  items: [
    {
      product: 'inbox',
      en: 'A Favorites tab next to Unread lists the chats you marked. Add or remove a chat from its ⋯ menu or with a right click on the row, with Undo. Favorites stay in Inbox: they do not sync to the phone.',
      es: 'Una pestaña Favoritos al lado de No leídos lista los chats que marcaste. Agregá o quitá un chat desde su menú ⋯ o con clic derecho en la fila, con Deshacer. Los Favoritos quedan en Inbox: no se sincronizan con el teléfono.',
      pt: 'Uma aba Favoritos ao lado de Não lidas lista as conversas que você marcou. Adicione ou remova uma conversa pelo menu ⋯ dela ou com o clique direito na linha, com Desfazer. Os Favoritos ficam no Inbox: não sincronizam com o celular.',
    },
    {
      product: 'groups',
      en: 'The same Favorites tab in the Lines chat list, between Unread and Groups, and as a filter in the filter panel. The team shares them, and the same chat on several lines is added once.',
      es: 'La misma pestaña Favoritos en la lista de chats de Lines, entre No leídos y Grupos, y como filtro en el panel de filtros. El equipo los comparte, y el mismo chat en varias líneas se agrega una vez.',
      pt: 'A mesma aba Favoritos na lista de conversas do Lines, entre Não lidas e Grupos, e como filtro no painel de filtros. A equipe compartilha, e a mesma conversa em várias linhas é adicionada uma vez.',
    },
  ],
} satisfies ChangelogEntry;
