import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-22-lines-group-subject',
  date: '2026-11-22',
  title: {
    en: 'Groups in Lines show their name right away',
    es: 'Los grupos en Lines muestran su nombre enseguida',
    pt: 'Os grupos no Lines mostram o nome na hora',
  },
  items: [
    {
      product: 'groups',
      en: 'When a group message arrives without the group name, Lines now asks WhatsApp for it at once, like Inbox does, so the chat list shows the real name within seconds. Until it comes, the list says "Group" instead of the long WhatsApp id.',
      es: 'Cuando llega un mensaje de un grupo sin su nombre, Lines ahora se lo pide a WhatsApp en el momento, como hace Inbox, y la lista muestra el nombre real en segundos. Hasta que llega, la lista dice "Grupo" en vez del id largo de WhatsApp.',
      pt: 'Quando chega uma mensagem de um grupo sem o nome, o Lines agora pede ao WhatsApp na hora, como faz o Inbox, e a lista mostra o nome real em segundos. Até chegar, a lista mostra "Grupo" em vez do id longo do WhatsApp.',
    },
  ],
} satisfies ChangelogEntry;
