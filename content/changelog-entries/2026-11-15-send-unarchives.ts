import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-send-unarchives',
  date: '2026-11-15',
  title: {
    en: 'Inbox and Lines: sending a message unarchives the chat',
    es: 'Inbox y Lines: mandar un mensaje desarchiva el chat',
    pt: 'Inbox e Lines: enviar uma mensagem desarquiva a conversa',
  },
  items: [
    {
      product: 'inbox',
      en: 'Sending a WhatsApp message to an archived chat now brings it back to the list, like on WhatsApp. It works for text, files, voice notes, stickers, polls, contacts, replies and forwards, for a scheduled message at the moment it goes out, and for messages you send from the phone. If you send from the Archived view, the chat stays open and a notice lets you undo. Reactions leave the chat archived.',
      es: 'Mandar un mensaje de WhatsApp a un chat archivado ahora lo devuelve a la lista, como en WhatsApp. Vale para texto, archivos, notas de voz, stickers, encuestas, contactos, respuestas y reenvíos, para un mensaje programado en el momento en que sale y para lo que mandás desde el teléfono. Si mandás desde Archivados, el chat queda abierto y un aviso te deja deshacer. Las reacciones dejan el chat archivado.',
      pt: 'Enviar uma mensagem de WhatsApp para uma conversa arquivada agora a devolve para a lista, como no WhatsApp. Vale para texto, arquivos, notas de voz, figurinhas, enquetes, contatos, respostas e encaminhamentos, para uma mensagem agendada no momento em que sai e para o que você envia pelo celular. Se você envia a partir de Arquivadas, a conversa fica aberta e um aviso deixa desfazer. As reações deixam a conversa arquivada.',
    },
    {
      product: 'groups',
      en: 'Lines does the same: any message that goes out unarchives its chat, including each chat of a bulk send, scheduled messages when they are sent, messages sent through the API or by an agent, and messages sent from the phone. Internal notes and reactions leave it archived.',
      es: 'Lines hace lo mismo: cualquier mensaje que sale desarchiva su chat, también cada chat de un envío masivo, los programados cuando salen, lo que se manda por la API o un agente y lo que se manda desde el teléfono. Las notas internas y las reacciones lo dejan archivado.',
      pt: 'O Lines faz o mesmo: qualquer mensagem que sai desarquiva a conversa, inclusive cada conversa de um envio em massa, as agendadas quando saem, o que é enviado pela API ou por um agente e o que é enviado pelo celular. As notas internas e as reações a deixam arquivada.',
    },
  ],
} satisfies ChangelogEntry;
