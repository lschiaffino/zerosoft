import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-inbox-no-list-head',
  date: '2026-11-15',
  title: {
    en: 'Inbox: more room for your chats',
    es: 'Inbox: más lugar para tus chats',
    pt: 'Inbox: mais espaço para seus chats',
  },
  items: [
    {
      product: 'inbox',
      en: 'On desktop, the chat list no longer repeats "Inbox" and the "New" button: the top bar already says where you are and "New" is in the sidebar. Like in Lines. Inside a folder you still see its name and "Edit".',
      es: 'En la computadora, la lista de chats ya no repite "Bandeja" ni el botón "Nuevo": la barra de arriba ya dice dónde estás y "Nuevo" está en el lateral. Igual que en Lines. Dentro de una carpeta se sigue viendo su nombre y "Editar".',
      pt: 'No computador, a lista de chats não repete mais "Caixa de entrada" nem o botão "Novo": a barra de cima já diz onde você está e "Novo" fica na lateral. Igual ao Lines. Dentro de uma pasta você continua vendo o nome e "Editar".',
    },
  ],
} satisfies ChangelogEntry;
