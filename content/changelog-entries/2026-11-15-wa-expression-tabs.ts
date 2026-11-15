import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-wa-expression-tabs',
  date: '2026-11-15',
  title: {
    en: 'Inbox and Lines: stickers and GIFs are easier to find',
    es: 'Inbox y Lines: los stickers y los GIF se encuentran más fácil',
    pt: 'Inbox e Lines: figurinhas e GIFs mais fáceis de achar',
  },
  items: [
    {
      product: 'inbox',
      en: 'The emoji button opens a panel with three tabs, Emoji, GIFs and Stickers, now with an icon each, like WhatsApp. The first time you open Stickers, the stickers from your chats are imported on their own, so the tab is not empty.',
      es: 'El botón de emoji abre un panel con tres pestañas, Emoji, GIF y Stickers, ahora con un ícono cada una, como en WhatsApp. La primera vez que abrís Stickers, los stickers de tus chats se importan solos, así la pestaña no aparece vacía.',
      pt: 'O botão de emoji abre um painel com três abas, Emoji, GIFs e Figurinhas, agora com um ícone cada uma, como no WhatsApp. Na primeira vez que você abre Figurinhas, as figurinhas das suas conversas são importadas sozinhas, então a aba não aparece vazia.',
    },
    {
      product: 'groups',
      en: 'Lines has the same tabs and the same automatic import.',
      es: 'Lines tiene las mismas pestañas y la misma importación automática.',
      pt: 'O Lines tem as mesmas abas e a mesma importação automática.',
    },
  ],
} satisfies ChangelogEntry;
