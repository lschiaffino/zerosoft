import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-wa-group-mentions-open',
  date: '2026-11-15',
  title: {
    en: 'Inbox and Lines: a mention in a group opens that person',
    es: 'Inbox y Lines: una mención en un grupo abre a esa persona',
    pt: 'Inbox e Lines: uma menção em um grupo abre essa pessoa',
  },
  items: [
    {
      product: 'inbox',
      en: 'Clicking an @mention in a group message opens the contact info of the person mentioned, like on WhatsApp.',
      es: 'Hacer clic en una @mención de un mensaje de grupo abre la info del contacto de la persona mencionada, como en WhatsApp.',
      pt: 'Clicar em uma @menção numa mensagem de grupo abre os dados do contato da pessoa mencionada, como no WhatsApp.',
    },
    {
      product: 'groups',
      en: 'Lines does the same, and a one on one chat you open from a group shows the person’s photo right away instead of waiting for the daily refresh.',
      es: 'Lines hace lo mismo, y un chat individual que abrís desde un grupo muestra la foto de la persona enseguida en vez de esperar al repaso diario.',
      pt: 'O Lines faz o mesmo, e uma conversa individual aberta a partir de um grupo mostra a foto da pessoa na hora, sem esperar a atualização diária.',
    },
  ],
} satisfies ChangelogEntry;
