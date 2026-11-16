import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-offline-lines-inbox-queue',
  date: '2026-11-15',
  title: {
    en: 'Lines and Inbox offline: messages wait in line and send on their own',
    es: 'Lines e Inbox sin conexión: los mensajes esperan en cola y salen solos',
    pt: 'Lines e Inbox sem conexão: as mensagens esperam na fila e saem sozinhas',
  },
  items: [
    {
      product: 'groups',
      en: 'Chats you already opened in Lines open without a connection. A message you write offline shows in the chat with the clock, stays there if you reload, and you can delete it before it goes. When the connection is back it sends on its own, in the order you wrote it and only once, even with two tabs open. If the server rejects it, it stays as not sent with retry. Files still need a connection and stay in the tray until you are back online.',
      es: 'Los chats que ya abriste en Lines se abren sin conexión. Un mensaje que escribís sin red aparece en el chat con el reloj, sigue ahí si recargás y lo podés borrar antes de que salga. Cuando vuelve la conexión sale solo, en el orden en que lo escribiste y una sola vez, aunque tengas dos pestañas abiertas. Si el servidor lo rechaza, queda como no enviado con reintentar. Los archivos siguen necesitando conexión y quedan en la bandeja hasta que vuelva la red.',
      pt: 'As conversas que você já abriu no Lines abrem sem conexão. Uma mensagem escrita sem conexão aparece na conversa com o relógio, continua lá se você recarregar e pode ser apagada antes de sair. Quando a conexão volta, ela sai sozinha, na ordem em que você escreveu e uma única vez, mesmo com duas abas abertas. Se o servidor recusar, ela fica como não enviada, com tentar de novo. Arquivos ainda precisam de conexão e ficam na bandeja até a conexão voltar.',
    },
    {
      product: 'inbox',
      en: 'The same in Inbox for WhatsApp chats: chats you opened read offline, and text you write without a connection waits with the clock and sends in order when you are back online.',
      es: 'Lo mismo en Inbox para los chats de WhatsApp: los chats que abriste se leen sin conexión, y lo que escribís sin red espera con el reloj y sale en orden cuando vuelve la conexión.',
      pt: 'O mesmo no Inbox para as conversas do WhatsApp: as conversas que você abriu podem ser lidas sem conexão, e o que você escreve sem conexão espera com o relógio e sai em ordem quando a conexão volta.',
    },
  ],
} satisfies ChangelogEntry;
