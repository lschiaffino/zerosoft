import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-19-archive-after-sending',
  date: '2026-11-19',
  title: {
    en: 'Inbox and Lines: archiving a chat right after you wrote in it now reaches WhatsApp',
    es: 'Inbox y Lines: archivar un chat en el que acabás de escribir ahora llega a WhatsApp',
    pt: 'Inbox e Lines: arquivar uma conversa em que você acabou de escrever agora chega ao WhatsApp',
  },
  items: [
    {
      product: 'inbox',
      en: 'When the last messages of a one-to-one chat were written from Inbox or Lines, archiving it here did not archive it on the phone. WhatsApp knows some chats by two ids, and the archive order pointed at an older message than the real last one, so the phone ignored it. The order now carries the newest message of the chat, whichever id it was saved under. Groups were not affected.',
      es: 'Cuando los últimos mensajes de un chat uno a uno se habían escrito desde Inbox o Lines, archivarlo acá no lo archivaba en el teléfono. WhatsApp conoce algunos chats por dos ids, y la orden de archivado apuntaba a un mensaje más viejo que el último real, así que el teléfono la ignoraba. Ahora la orden lleva el mensaje más nuevo del chat, esté guardado con el id que sea. Los grupos no tenían el problema.',
      pt: 'Quando as últimas mensagens de uma conversa individual tinham sido escritas pelo Inbox ou pelo Lines, arquivá-la aqui não a arquivava no telefone. O WhatsApp conhece algumas conversas por dois ids, e a ordem de arquivamento apontava para uma mensagem mais antiga que a última real, então o telefone a ignorava. Agora a ordem leva a mensagem mais nova da conversa, seja qual for o id com que foi salva. Os grupos não tinham o problema.',
    },
  ],
} satisfies ChangelogEntry;
