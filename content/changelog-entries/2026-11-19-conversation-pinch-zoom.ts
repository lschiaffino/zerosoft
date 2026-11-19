import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-19-conversation-pinch-zoom',
  date: '2026-11-19',
  title: {
    en: 'Pinching on the trackpad enlarges only the conversation',
    es: 'Pellizcar en el trackpad agranda solo la conversación',
    pt: 'O gesto de pinça no trackpad amplia só a conversa',
  },
  items: [
    {
      product: 'groups',
      en: 'In Lines, a trackpad pinch used to zoom the whole app and break the layout. Now a pinch over the messages enlarges the text and attachments of the conversation, up to 200%, and a pinch anywhere else does nothing. The level is remembered in that browser. Pinch out to go back to 100%, or press Cmd+0 (Ctrl+0 on Windows) with the pointer over the messages. The browser zoom with Cmd + and Cmd − works as before.',
      es: 'En Lines, pellizcar en el trackpad agrandaba la app entera y rompía el diseño. Ahora un pellizco sobre los mensajes agranda el texto y los adjuntos de la conversación, hasta 200%, y un pellizco en cualquier otro lado no hace nada. El nivel se recuerda en ese navegador. Para volver a 100%, pellizcá hacia afuera o apretá Cmd+0 (Ctrl+0 en Windows) con el puntero sobre los mensajes. El zoom del navegador con Cmd + y Cmd − sigue igual.',
      pt: 'No Lines, o gesto de pinça no trackpad ampliava o app inteiro e quebrava o layout. Agora uma pinça sobre as mensagens amplia o texto e os anexos da conversa, até 200%, e uma pinça em qualquer outro lugar não faz nada. O nível fica guardado naquele navegador. Para voltar a 100%, faça a pinça para fora ou aperte Cmd+0 (Ctrl+0 no Windows) com o ponteiro sobre as mensagens. O zoom do navegador com Cmd + e Cmd − continua igual.',
    },
    {
      product: 'inbox',
      en: 'Inbox does the same: a trackpad pinch over the messages enlarges only the conversation, in WhatsApp chats and in email threads.',
      es: 'Inbox hace lo mismo: un pellizco del trackpad sobre los mensajes agranda solo la conversación, en los chats de WhatsApp y en los hilos de correo.',
      pt: 'O Inbox faz o mesmo: uma pinça no trackpad sobre as mensagens amplia só a conversa, nas conversas do WhatsApp e nos e-mails.',
    },
  ],
} satisfies ChangelogEntry;
