import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-wa-group-invite-card',
  date: '2026-11-20',
  title: {
    en: 'Lines and Inbox: WhatsApp group invites get their own card, with Join group',
    es: 'Lines e Inbox: las invitaciones a grupos de WhatsApp tienen su tarjeta, con Unirme al grupo',
    pt: 'Lines e Inbox: os convites para grupos do WhatsApp ganham um cartão, com Entrar no grupo',
  },
  items: [
    {
      product: 'groups',
      en: 'A message with a group invite link (chat.whatsapp.com) showed the generic link card, with the group photo cropped in a narrow column. It now shows a card like the one in WhatsApp: the group photo whole and round, the group name, "WhatsApp group invite" and two buttons. Join group joins with the line the message came in on, after you confirm, since the group members see it; then Open group takes you to the chat. If the link was reset, the line is already in the group or an admin has to approve, the card says so. Open in WhatsApp opens the link in a new tab. Only people who can see the line can join with it.',
      es: 'Un mensaje con un link de invitación a un grupo (chat.whatsapp.com) mostraba la tarjeta de link común, con la foto del grupo recortada en una columna angosta. Ahora muestra una tarjeta como la de WhatsApp: la foto del grupo entera y redonda, el nombre, "Invitación a grupo de WhatsApp" y dos botones. Unirme al grupo entra con la línea por la que llegó el mensaje, después de confirmar, porque los miembros del grupo lo ven; después Abrir grupo te lleva al chat. Si el link se reinició, la línea ya está en el grupo o un admin tiene que aprobar, la tarjeta lo dice. Abrir en WhatsApp abre el link en otra pestaña. Solo quien ve la línea puede entrar con ella.',
      pt: 'Uma mensagem com um link de convite para um grupo (chat.whatsapp.com) mostrava o cartão de link comum, com a foto do grupo cortada numa coluna estreita. Agora mostra um cartão como o do WhatsApp: a foto do grupo inteira e redonda, o nome, "Convite para grupo do WhatsApp" e dois botões. Entrar no grupo entra com a linha pela qual a mensagem chegou, depois de confirmar, porque os membros do grupo veem; depois Abrir grupo leva ao chat. Se o link foi redefinido, a linha já está no grupo ou um admin precisa aprovar, o cartão avisa. Abrir no WhatsApp abre o link em outra aba. Só quem vê a linha pode entrar com ela.',
    },
    {
      product: 'inbox',
      en: 'The same card in Inbox: Join group uses the WhatsApp account of the chat, and Open group takes you to the new group. Only the account owner can join.',
      es: 'La misma tarjeta en Inbox: Unirme al grupo usa la cuenta de WhatsApp del chat, y Abrir grupo te lleva al grupo nuevo. Solo la dueña de la cuenta puede unirse.',
      pt: 'O mesmo cartão no Inbox: Entrar no grupo usa a conta de WhatsApp da conversa, e Abrir grupo leva ao grupo novo. Só a dona da conta pode entrar.',
    },
  ],
} satisfies ChangelogEntry;
