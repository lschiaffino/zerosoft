import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-wa-contact-sheet',
  date: '2026-11-15',
  title: {
    en: 'Inbox and Lines: contact info of anyone in a group',
    es: 'Inbox y Lines: la info del contacto de cualquiera en un grupo',
    pt: 'Inbox e Lines: os dados do contato de qualquer pessoa em um grupo',
  },
  items: [
    {
      product: 'inbox',
      en: 'Click the photo or the name of someone in a group, or a participant in the group info, and their contact info opens like in WhatsApp: large photo, name, number, about, whether they are a group admin, and a Message button that opens your one on one chat with them (or starts it). When you already have a chat with them, it also shows the media, links and docs you shared, starred messages, mute and block, plus the other groups you have in common. On a phone it takes the whole screen.',
      es: 'Tocá la foto o el nombre de alguien en un grupo, o a un participante en la info del grupo, y se abre su info del contacto como en WhatsApp: foto grande, nombre, número, info, si es admin del grupo y un botón Mensaje que abre tu chat individual con esa persona (o lo empieza). Si ya tenés un chat con ella, también muestra los archivos, enlaces y documentos que se mandaron, los mensajes destacados, silenciar y bloquear, y los otros grupos que tienen en común. En el teléfono ocupa toda la pantalla.',
      pt: 'Toque na foto ou no nome de alguém em um grupo, ou em um participante nos dados do grupo, e os dados do contato abrem como no WhatsApp: foto grande, nome, número, recado, se é admin do grupo e um botão Mensagem que abre sua conversa individual com a pessoa (ou começa uma). Se você já tem uma conversa com ela, também aparecem a mídia, os links e os docs trocados, as mensagens favoritas, silenciar e bloquear, e os outros grupos em comum. No celular ocupa a tela inteira.',
    },
    {
      product: 'groups',
      en: 'Lines has the same contact info from group messages and from the member list in the chat details. Message opens or starts the chat on the same line. People who see hidden numbers get the contact info with the number hidden.',
      es: 'Lines tiene la misma info del contacto desde los mensajes del grupo y desde la lista de miembros en los detalles del chat. Mensaje abre o empieza el chat en la misma línea. Quien ve los números ocultos recibe la info con el número oculto.',
      pt: 'O Lines tem os mesmos dados do contato a partir das mensagens do grupo e da lista de membros nos detalhes da conversa. Mensagem abre ou começa a conversa na mesma linha. Quem vê os números ocultos recebe os dados com o número oculto.',
    },
  ],
} satisfies ChangelogEntry;
