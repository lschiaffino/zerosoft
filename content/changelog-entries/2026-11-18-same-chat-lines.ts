import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-18-same-chat-lines',
  date: '2026-11-18',
  title: {
    en: 'The same chat on two lines is one row',
    es: 'El mismo chat en dos líneas es una sola fila',
    pt: 'A mesma conversa em duas linhas é uma linha só',
  },
  items: [
    {
      product: 'groups',
      en: 'When a group or a contact talks to more than one of your lines, the inbox lists it once with the unread of every line. The chat shows the messages of all those lines in order, a group message that reached two lines shows once, and each message says which line it came in on. Reading, archiving, snoozing or closing it applies to every line.',
      es: 'Cuando un grupo o un contacto habla con más de una de tus líneas, la bandeja lo lista una vez con los no leídos de todas. El chat muestra los mensajes de esas líneas en orden, un mensaje de grupo que llegó a dos líneas se ve una vez y cada mensaje dice por qué línea entró. Leer, archivar, posponer o cerrar vale para todas las líneas.',
      pt: 'Quando um grupo ou contato fala com mais de uma das suas linhas, a caixa mostra a conversa uma vez com as não lidas de todas. A conversa mostra as mensagens dessas linhas em ordem, uma mensagem de grupo que chegou a duas linhas aparece uma vez e cada mensagem diz por qual linha chegou. Ler, arquivar, adiar ou fechar vale para todas as linhas.',
    },
  ],
} satisfies ChangelogEntry;
