import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-19-lines-personal-folders',
  date: '2026-11-19',
  title: {
    en: 'Lines: folders are now personal',
    es: 'Lines: las carpetas ahora son personales',
    pt: 'Lines: as pastas agora são pessoais',
  },
  items: [
    {
      product: 'groups',
      en: 'Each person has their own folders in Lines and their own filing of chats. Nobody else sees your folders or where you put a chat, admins included, and the same chat can sit in a different folder for each person. The folders that already existed stay with whoever created them, with their chats inside; everyone else starts with none and can create the first one from the sidebar or from Move to folder. Inbox folders were already personal.',
      es: 'Cada persona tiene sus propias carpetas en Lines y su propio orden de chats. Nadie más ve tus carpetas ni dónde pusiste un chat, tampoco los admins, y el mismo chat puede estar en una carpeta distinta para cada persona. Las carpetas que ya existían quedan para quien las creó, con sus chats adentro; el resto empieza sin carpetas y puede crear la primera desde el lateral o desde Mover a carpeta. Las carpetas de Inbox ya eran personales.',
      pt: 'Cada pessoa tem suas próprias pastas no Lines e sua própria organização de conversas. Ninguém mais vê suas pastas nem onde você colocou uma conversa, nem os admins, e a mesma conversa pode ficar numa pasta diferente para cada pessoa. As pastas que já existiam ficam com quem as criou, com as conversas dentro; os demais começam sem pastas e podem criar a primeira pela lateral ou em Mover para pasta. As pastas do Inbox já eram pessoais.',
    },
  ],
} satisfies ChangelogEntry;
