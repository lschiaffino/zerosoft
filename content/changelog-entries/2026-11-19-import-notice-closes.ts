import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-19-import-notice-closes',
  date: '2026-11-19',
  title: {
    en: 'The import notice above the chat list says what it is doing and can be closed',
    es: 'El aviso de importación arriba de la lista de chats dice en qué anda y se puede cerrar',
    pt: 'O aviso de importação acima da lista de conversas diz o que está fazendo e pode ser fechado',
  },
  items: [
    {
      product: 'groups',
      en: 'The import notice in Lines could stay on "Importing messages: 20 of 20 chats" with a full bar and no way to close it. With every chat counted the import was still bringing in profile photos, group members and older messages, or waiting for a disconnected line. Now the notice says which of those it is, tells you when the import is paused or not moving, goes away by itself a few seconds after it finishes, and has a close button in every state. A notice you closed stays closed for that import.',
      es: 'El aviso de importación de Lines podía quedarse en "Importando mensajes: 20 de 20 chats" con la barra llena y sin forma de cerrarlo. Con todos los chats contados la importación seguía trayendo fotos de perfil, miembros de los grupos y mensajes viejos, o esperando a una línea desconectada. Ahora el aviso dice cuál de esas cosas está haciendo, avisa cuando la importación está en pausa o no avanza, se va solo unos segundos después de terminar y tiene un botón para cerrarlo en cualquier estado. Un aviso que cerraste queda cerrado para esa importación.',
      pt: 'O aviso de importação do Lines podia ficar em "Importando mensagens: 20 de 20 conversas" com a barra cheia e sem como fechar. Com todas as conversas contadas, a importação continuava trazendo fotos de perfil, membros dos grupos e mensagens antigas, ou esperando uma linha desconectada. Agora o aviso diz qual dessas coisas está fazendo, avisa quando a importação está em pausa ou não avança, some sozinho alguns segundos depois de terminar e tem um botão para fechar em qualquer estado. Um aviso que você fechou continua fechado para aquela importação.',
    },
    {
      product: 'inbox',
      en: 'The import notice in Inbox works the same way: it can be closed while the import runs, it says when the import is paused because WhatsApp or Gmail is disconnected or when it stopped, and the "Import finished" notice goes away by itself.',
      es: 'El aviso de importación de Inbox funciona igual: se puede cerrar mientras la importación corre, dice cuando está en pausa porque WhatsApp o Gmail está desconectado o cuando se cortó, y el aviso de "Importación lista" se va solo.',
      pt: 'O aviso de importação do Inbox funciona do mesmo jeito: pode ser fechado enquanto a importação roda, diz quando ela está em pausa porque o WhatsApp ou o Gmail está desconectado ou quando parou, e o aviso de "Importação pronta" some sozinho.',
    },
  ],
} satisfies ChangelogEntry;
