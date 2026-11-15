import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-wa-messages-no-ring',
  date: '2026-11-15',
  title: {
    en: 'Inbox and Lines: no green border around the chat when you press a key',
    es: 'Inbox y Lines: sin borde verde alrededor del chat al tocar una tecla',
    pt: 'Inbox e Lines: sem borda verde em volta do chat ao apertar uma tecla',
  },
  items: [
    {
      product: 'inbox',
      en: 'After clicking in a conversation, pressing any key drew a green frame around the whole chat. It no longer does; the arrow keys still scroll the messages.',
      es: 'Después de hacer clic en una conversación, cualquier tecla dibujaba un marco verde alrededor de todo el chat. Ya no; las flechas siguen moviendo los mensajes.',
      pt: 'Depois de clicar numa conversa, qualquer tecla desenhava uma moldura verde em volta do chat inteiro. Não mais; as setas continuam rolando as mensagens.',
    },
    {
      product: 'groups',
      en: 'The same in Lines.',
      es: 'Lo mismo en Lines.',
      pt: 'O mesmo no Lines.',
    },
  ],
} satisfies ChangelogEntry;
