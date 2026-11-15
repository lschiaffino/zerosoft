import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-14-wa-list-format',
  date: '2026-11-14',
  title: {
    en: 'Inbox and Lines: bullet lists with bold text read like in WhatsApp',
    es: 'Inbox y Lines: las listas con negritas se leen como en WhatsApp',
    pt: 'Inbox e Lines: listas com negrito aparecem como no WhatsApp',
  },
  items: [
    {
      product: 'inbox',
      en: 'A list item with bold words in the middle was split into narrow side-by-side columns. Now each item is one paragraph that wraps normally, as in WhatsApp.',
      es: 'Un ítem de lista con palabras en negrita en el medio se partía en columnas angostas una al lado de la otra. Ahora cada ítem es un párrafo que corta la línea normal, como en WhatsApp.',
      pt: 'Um item de lista com palavras em negrito no meio era dividido em colunas estreitas lado a lado. Agora cada item é um parágrafo que quebra a linha normalmente, como no WhatsApp.',
    },
    {
      product: 'groups',
      en: 'The same fix applies to messages in Lines.',
      es: 'Lo mismo en los mensajes de Lines.',
      pt: 'O mesmo vale para as mensagens do Lines.',
    },
  ],
} satisfies ChangelogEntry;
