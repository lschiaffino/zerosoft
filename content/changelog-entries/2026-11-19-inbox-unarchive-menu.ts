import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-19-inbox-unarchive-menu',
  date: '2026-11-19',
  title: {
    en: 'Inbox: an archived chat always offers Unarchive',
    es: 'Inbox: un chat archivado siempre ofrece Desarchivar',
    pt: 'Inbox: uma conversa arquivada sempre oferece Desarquivar',
  },
  items: [
    {
      product: 'inbox',
      en: 'Some chats carried the Archived label but their right-click menu said "Archive chat". They were chats sent to Archived with Done instead of Archive: the list treated them as archived and the menu did not. The right-click menu, the swipe actions, the chat’s own menu and the selection bar now all offer Unarchive for any chat that is in Archived.',
      es: 'Algunos chats tenían la etiqueta Archivado pero su menú de clic derecho decía "Archivar chat". Eran chats mandados a Archivados con Hecho en vez de Archivar: la lista los trataba como archivados y el menú no. El menú de clic derecho, el deslizado, el menú del chat y la barra de selección ahora ofrecen Desarchivar para cualquier chat que esté en Archivados.',
      pt: 'Algumas conversas tinham a etiqueta Arquivada, mas o menu do clique direito dizia "Arquivar conversa". Eram conversas enviadas para Arquivadas com Concluir em vez de Arquivar: a lista as tratava como arquivadas e o menu não. O menu do clique direito, o deslizar, o menu da conversa e a barra de seleção agora oferecem Desarquivar para qualquer conversa que esteja em Arquivadas.',
    },
  ],
} satisfies ChangelogEntry;
