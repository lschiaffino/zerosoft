import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-23-inbox-tabs-case',
  date: '2026-11-23',
  title: {
    en: 'Inbox: filter tabs and the list title without capitals, like WhatsApp',
    es: 'Inbox: las pestañas de filtro y el título de la lista sin mayúsculas, como WhatsApp',
    pt: 'Inbox: as abas de filtro e o título da lista sem maiúsculas, como no WhatsApp',
  },
  items: [
    {
      product: 'inbox',
      en: 'The tabs above the chat list (All, WhatsApp, Email, Groups...) and the list title on a phone showed in capitals, smaller and in gray, because they took the style of the search section titles. They now read like Lines and WhatsApp Web. The Chats and Found in messages titles of a search stay as they were.',
      es: 'Las pestañas arriba de la lista de chats (Todos, WhatsApp, Correo, Grupos...) y el título de la lista en el teléfono se veían en mayúsculas, más chicos y en gris, porque tomaban el estilo de los títulos de la búsqueda. Ahora se leen como en Lines y WhatsApp Web. Los títulos Chats y Encontrado en mensajes de una búsqueda quedan como estaban.',
      pt: 'As abas acima da lista de conversas (Todas, WhatsApp, E-mail, Grupos...) e o título da lista no celular apareciam em maiúsculas, menores e em cinza, porque pegavam o estilo dos títulos da pesquisa. Agora aparecem como no Lines e no WhatsApp Web. Os títulos Conversas e Encontrado nas mensagens de uma pesquisa ficam como estavam.',
    },
  ],
} satisfies ChangelogEntry;
