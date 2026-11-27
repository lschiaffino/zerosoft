import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-27-wa-unread-mention',
  date: '2026-11-27',
  title: {
    en: 'Lines and Inbox: @ in the chat list when a group mentions you',
    es: 'Lines e Inbox: @ en la lista de chats cuando un grupo te menciona',
    pt: 'Lines e Inbox: @ na lista de conversas quando um grupo menciona você',
  },
  items: [
    {
      product: 'groups',
      en: 'Like WhatsApp, a group with an unread message that mentions the line, or that replies to one of its messages, shows @ next to the unread count. It stays green when the chat is muted and goes away once the chat is read.',
      es: 'Como en WhatsApp, un grupo con un mensaje sin leer que menciona a la línea, o que responde a uno de sus mensajes, muestra @ junto al número de no leídos. Sigue en verde aunque el chat esté silenciado y se va cuando el chat queda leído.',
      pt: 'Como no WhatsApp, um grupo com uma mensagem não lida que menciona a linha, ou que responde a uma mensagem dela, mostra @ ao lado do número de não lidas. Continua verde mesmo com a conversa silenciada e some quando a conversa fica lida.',
    },
    {
      product: 'inbox',
      en: 'The same @ in Inbox for your WhatsApp groups: someone mentioned you or replied to one of your messages and you have not read it yet.',
      es: 'El mismo @ en Inbox para tus grupos de WhatsApp: alguien te mencionó o respondió a un mensaje tuyo y todavía no lo leíste.',
      pt: 'O mesmo @ no Inbox para os seus grupos de WhatsApp: alguém mencionou você ou respondeu a uma mensagem sua e você ainda não leu.',
    },
  ],
} satisfies ChangelogEntry;
