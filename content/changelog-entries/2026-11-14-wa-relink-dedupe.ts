import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-14-wa-relink-dedupe',
  date: '2026-11-14',
  title: {
    en: 'Inbox and Lines: linking the same WhatsApp number again keeps one chat per person',
    es: 'Inbox y Lines: volver a vincular el mismo WhatsApp deja un solo chat por persona',
    pt: 'Inbox e Lines: vincular de novo o mesmo WhatsApp deixa um só chat por pessoa',
  },
  items: [
    {
      product: 'inbox',
      en: 'When you unlink WhatsApp and link the same number again, the history that comes back joins the chats you already had. WhatsApp sometimes sends a contact under a hidden id instead of their phone number. Inbox now moves that chat into the one with the phone number, with its messages, notes and folders, and removes the copies of messages that were already there. Chats that were already split this way were joined too.',
      es: 'Si desvinculás WhatsApp y volvés a vincular el mismo número, el historial que vuelve se suma a los chats que ya tenías. A veces WhatsApp manda un contacto con un id oculto en lugar de su teléfono. Ahora Inbox pasa ese chat al del teléfono, con sus mensajes, notas y carpetas, y saca las copias de los mensajes que ya estaban. Los chats que ya habían quedado partidos así también se juntaron.',
      pt: 'Se você desvincular o WhatsApp e vincular de novo o mesmo número, o histórico que volta se junta aos chats que você já tinha. Às vezes o WhatsApp manda um contato com um id oculto em vez do telefone. Agora o Inbox passa esse chat para o do telefone, com mensagens, notas e pastas, e tira as cópias das mensagens que já estavam lá. Os chats que já tinham ficado divididos assim também foram juntados.',
    },
    {
      product: 'groups',
      en: 'Reconnecting a line in Lines works the same way: a contact that arrives under a hidden id ends up in the chat with their phone number, with its messages, labels, tickets and tasks, and no message shows twice.',
      es: 'Volver a conectar una línea en Lines funciona igual: un contacto que llega con un id oculto queda en el chat con su teléfono, con sus mensajes, etiquetas, tickets y tareas, y ningún mensaje aparece dos veces.',
      pt: 'Reconectar uma linha no Lines funciona igual: um contato que chega com um id oculto fica no chat com o telefone, com mensagens, etiquetas, tickets e tarefas, e nenhuma mensagem aparece duas vezes.',
    },
  ],
} satisfies ChangelogEntry;
