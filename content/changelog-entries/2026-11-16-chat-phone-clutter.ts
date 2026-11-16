import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-16-chat-phone-clutter',
  date: '2026-11-16',
  title: {
    en: 'Inbox and Lines on the phone: less in the way',
    es: 'Inbox y Lines en el teléfono: menos cosas en el medio',
    pt: 'Inbox e Lines no celular: menos coisas no caminho',
  },
  items: [
    {
      product: 'inbox',
      en: 'The chat header on the phone shows the contact name again: follow up, move and notes are in the ⋯ menu. Icon buttons are 44px for your finger, the arrow on each message no longer stays visible after a tap, and the feedback tab no longer floats over the chat list and the conversation.',
      es: 'La cabecera del chat en el teléfono vuelve a mostrar el nombre del contacto: seguimiento, mover y notas están en el menú ⋯. Los botones de ícono miden 44px para el dedo, la flecha de cada mensaje ya no queda a la vista después de un toque, y la pestaña de comentarios ya no flota sobre la lista de chats ni sobre la conversación.',
      pt: 'O cabeçalho da conversa no celular volta a mostrar o nome do contato: acompanhar, mover e notas estão no menu ⋯. Os botões de ícone têm 44px para o dedo, a seta de cada mensagem não fica mais visível depois de um toque, e a aba de comentários não flutua mais sobre a lista de conversas nem sobre a conversa.',
    },
    {
      product: 'groups',
      en: 'Lines gets the same 44px buttons, no arrow left on tapped messages and no floating feedback tab on the phone. In both apps, you send feedback from the account menu (Send feedback).',
      es: 'Lines tiene los mismos botones de 44px, sin la flecha en los mensajes tocados y sin la pestaña de comentarios flotando en el teléfono. En las dos apps, el feedback se manda desde el menú de la cuenta (Enviar feedback).',
      pt: 'O Lines ganha os mesmos botões de 44px, sem a seta nas mensagens tocadas e sem a aba de comentários flutuando no celular. Nos dois apps, o feedback é enviado pelo menu da conta (Enviar feedback).',
    },
  ],
} satisfies ChangelogEntry;
