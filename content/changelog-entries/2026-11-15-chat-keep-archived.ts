import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-chat-keep-archived',
  date: '2026-11-15',
  title: {
    en: 'Inbox and Lines: keep a chat archived',
    es: 'Inbox y Lines: mantener un chat archivado',
    pt: 'Inbox e Lines: manter uma conversa arquivada',
  },
  items: [
    {
      product: 'inbox',
      en: 'Contact and group info now has Keep archived. Turn it on and the chat moves to Archived and stays there: new messages arrive unread inside Archived, and messages you send, from here or from the phone, leave it there too. Archived chats show a small archive mark in the list, and the chat menu can turn it off. Unarchiving the chat by hand turns it off.',
      es: 'La info de un contacto o grupo ahora tiene Mantener archivado. Al prenderlo el chat pasa a Archivados y se queda ahí: los mensajes nuevos llegan sin leer dentro de Archivados, y los que mandás, desde acá o desde el teléfono, también lo dejan ahí. Esos chats muestran una pequeña marca de archivo en la lista, y el menú del chat permite apagarlo. Desarchivar el chat a mano lo apaga.',
      pt: 'As informações de um contato ou grupo agora têm Manter arquivada. Ao ativar, a conversa vai para Arquivadas e fica lá: as mensagens novas chegam não lidas dentro de Arquivadas, e as que você envia, daqui ou do celular, também a deixam lá. Essas conversas mostram uma pequena marca de arquivo na lista, e o menu da conversa permite desativar. Desarquivar a conversa manualmente desativa.',
    },
    {
      product: 'groups',
      en: 'Lines has the same Keep archived switch in the chat details, for each chat of the workspace. It applies even when the workspace setting brings archived chats back with new messages.',
      es: 'Lines tiene el mismo interruptor Mantener archivado en los detalles del chat, para cada chat del workspace. Vale aunque el ajuste del workspace devuelva los chats archivados con mensajes nuevos.',
      pt: 'O Lines tem a mesma opção Manter arquivada nos detalhes da conversa, para cada conversa do workspace. Vale mesmo quando o ajuste do workspace traz de volta as conversas arquivadas com mensagens novas.',
    },
  ],
} satisfies ChangelogEntry;
