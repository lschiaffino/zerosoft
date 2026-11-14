import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-14-wa-archive-safe',
  date: '2026-11-14',
  title: {
    en: 'Inbox and Lines: archiving sends WhatsApp one change per chat, at a steady pace',
    es: 'Inbox y Lines: archivar le manda a WhatsApp un cambio por chat, con ritmo',
    pt: 'Inbox e Lines: arquivar envia ao WhatsApp uma mudança por conversa, com ritmo',
  },
  items: [
    {
      product: 'inbox',
      en: 'Archiving or unarchiving a chat now sends WhatsApp a single change. Before, a one-to-one chat could get two: one with the phone number and another with WhatsApp\'s internal id for the same person. When you archive many chats at once, the changes now go out one every few seconds and at most 12 a minute, like on a phone. The rest follow on their own. The same applies to Lines.',
      es: 'Archivar o desarchivar un chat ahora le manda a WhatsApp un solo cambio. Antes un chat uno a uno podía recibir dos: uno con el número de teléfono y otro con el id interno de WhatsApp para la misma persona. Si archivás muchos chats a la vez, los cambios ahora salen de a uno cada pocos segundos y como mucho 12 por minuto, como en un teléfono. El resto sale solo después. Lo mismo vale para Lines.',
      pt: 'Arquivar ou desarquivar uma conversa agora envia ao WhatsApp uma única mudança. Antes, uma conversa individual podia receber duas: uma com o número de telefone e outra com o id interno do WhatsApp para a mesma pessoa. Se você arquiva muitas conversas de uma vez, as mudanças agora saem uma a cada poucos segundos e no máximo 12 por minuto, como num celular. O resto sai sozinho depois. O mesmo vale para o Lines.',
    },
  ],
} satisfies ChangelogEntry;
