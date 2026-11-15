import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-wa-participant-photos',
  date: '2026-11-15',
  title: {
    en: 'Inbox and Lines: profile photos of everyone in a group',
    es: 'Inbox y Lines: la foto de perfil de cada persona en un grupo',
    pt: 'Inbox e Lines: a foto de perfil de cada pessoa em um grupo',
  },
  items: [
    {
      product: 'inbox',
      en: 'In a group, messages from people you never chatted with one on one showed their initials, even when they had a photo on WhatsApp. Now Inbox brings each participant’s photo, a few at a time so WhatsApp does not slow the line down, keeps a copy that does not expire and checks it again every week. You see it next to their messages, in the participant list and in the mention list.',
      es: 'En un grupo, los mensajes de quien nunca te escribió por privado mostraban sus iniciales aunque tuviera foto en WhatsApp. Ahora Inbox trae la foto de cada participante, de a pocas para que WhatsApp no frene la línea, guarda una copia que no vence y la vuelve a revisar cada semana. La ves al lado de sus mensajes, en la lista de participantes y en la lista para mencionar.',
      pt: 'Em um grupo, as mensagens de quem nunca conversou com você no privado mostravam as iniciais mesmo quando a pessoa tinha foto no WhatsApp. Agora o Inbox traz a foto de cada participante, poucas por vez para o WhatsApp não travar a linha, guarda uma cópia que não expira e confere de novo toda semana. Você vê a foto ao lado das mensagens, na lista de participantes e na lista para mencionar.',
    },
    {
      product: 'groups',
      en: 'Lines does the same on every line: group messages, the member list in the chat details and the mention list show each member’s WhatsApp photo.',
      es: 'Lines hace lo mismo en cada línea: los mensajes del grupo, la lista de miembros en los detalles del chat y la lista para mencionar muestran la foto de WhatsApp de cada miembro.',
      pt: 'O Lines faz o mesmo em cada linha: as mensagens do grupo, a lista de membros nos detalhes do chat e a lista para mencionar mostram a foto do WhatsApp de cada membro.',
    },
  ],
} satisfies ChangelogEntry;
