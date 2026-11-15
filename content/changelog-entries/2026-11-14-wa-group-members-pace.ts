import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-14-wa-group-members-pace',
  date: '2026-11-14',
  title: {
    en: 'Lines: fewer requests to WhatsApp for group members',
    es: 'Lines: menos pedidos a WhatsApp por los miembros de los grupos',
    pt: 'Lines: menos pedidos ao WhatsApp pelos membros dos grupos',
  },
  items: [
    {
      product: 'groups',
      en: 'When WhatsApp did not return the members of a group, Lines asked again with every new message in that group, and WhatsApp started rejecting the requests. Now it asks at most once every six hours per group, and it waits a moment between groups when it reads many of them at once.',
      es: 'Cuando WhatsApp no devolvía los miembros de un grupo, Lines los volvía a pedir con cada mensaje nuevo del grupo, y WhatsApp empezaba a rechazar los pedidos. Ahora los pide como mucho una vez cada seis horas por grupo, y espera un momento entre grupos cuando lee muchos de una vez.',
      pt: 'Quando o WhatsApp não devolvia os membros de um grupo, o Lines pedia de novo a cada mensagem nova do grupo, e o WhatsApp começava a recusar os pedidos. Agora pede no máximo uma vez a cada seis horas por grupo, e espera um momento entre grupos quando lê muitos de uma vez.',
    },
  ],
} satisfies ChangelogEntry;
