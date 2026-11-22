import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-22-chat-cmdk',
  date: '2026-11-22',
  title: {
    en: 'Lines and Inbox: the actions of the open chat in Cmd+K',
    es: 'Lines e Inbox: las acciones del chat abierto en Cmd+K',
    pt: 'Lines e Inbox: as ações da conversa aberta no Cmd+K',
  },
  items: [
    {
      product: 'inbox',
      en: 'With a chat open, Cmd+K lists its actions first, the same as the / menu of the message field: done, snooze, remind, folder, read, pin, archive, mute (with how long), info, rename and attach, plus Search messages. Type to filter them, with their shortcut on the right.',
      es: 'Con un chat abierto, Cmd+K muestra primero sus acciones, las mismas del menú / del campo de mensaje: hecho, posponer, recordar, carpeta, leído, fijar, archivar, silenciar (con cuánto tiempo), info, renombrar y adjuntar, y Buscar mensajes. Escribí para filtrarlas, con su atajo a la derecha.',
      pt: 'Com uma conversa aberta, o Cmd+K mostra primeiro as ações dela, as mesmas do menu / do campo de mensagem: feito, adiar, lembrar, pasta, lida, fixar, arquivar, silenciar (por quanto tempo), dados, renomear e anexar, e Pesquisar mensagens. Digite para filtrar, com o atalho à direita.',
    },
    {
      product: 'groups',
      en: 'With a chat open, Cmd+K lists its actions first, the same as the / menu: assign, team, close or reopen, label (the ones on the chat are checked), note, ticket, task, send later, mute, pin, archive, summary, details and more, plus Search messages.',
      es: 'Con un chat abierto, Cmd+K muestra primero sus acciones, las mismas del menú /: asignar, equipo, cerrar o reabrir, etiqueta (las que tiene el chat aparecen tildadas), nota, ticket, tarea, enviar más tarde, silenciar, fijar, archivar, resumen, detalles y más, y Buscar mensajes.',
      pt: 'Com uma conversa aberta, o Cmd+K mostra primeiro as ações dela, as mesmas do menu /: atribuir, equipe, fechar ou reabrir, etiqueta (as da conversa aparecem marcadas), nota, ticket, tarefa, enviar mais tarde, silenciar, fixar, arquivar, resumo, detalhes e mais, e Pesquisar mensagens.',
    },
  ],
} satisfies ChangelogEntry;
