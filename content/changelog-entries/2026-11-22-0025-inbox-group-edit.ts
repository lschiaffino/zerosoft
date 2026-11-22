import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-22-inbox-group-edit',
  date: '2026-11-22',
  title: {
    en: 'Inbox: change a group name and description',
    es: 'Inbox: cambiar el nombre y la descripción de un grupo',
    pt: 'Inbox: mudar o nome e a descrição de um grupo',
  },
  items: [
    {
      product: 'inbox',
      en: 'In the group info of a WhatsApp group, the pencil next to the name and the description edits them, like in WhatsApp Web. Enter saves the name (Cmd or Ctrl+Enter the description), Esc leaves it as it was. The change goes to WhatsApp and shows in the chat as "You changed the group name".',
      es: 'En la info de un grupo de WhatsApp, el lápiz al lado del nombre y de la descripción los edita, como en WhatsApp Web. Enter guarda el nombre (Cmd o Ctrl+Enter la descripción) y Esc lo deja como estaba. El cambio va a WhatsApp y queda en el chat como "Cambiaste el nombre del grupo".',
      pt: 'Nos dados de um grupo do WhatsApp, o lápis ao lado do nome e da descrição os edita, como no WhatsApp Web. Enter salva o nome (Cmd ou Ctrl+Enter a descrição) e Esc deixa como estava. A mudança vai para o WhatsApp e aparece na conversa como "Você mudou o nome do grupo".',
    },
  ],
} satisfies ChangelogEntry;
