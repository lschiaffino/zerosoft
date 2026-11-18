import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-17-link-preview-cache-hash',
  date: '2026-11-17',
  title: {
    en: 'Link previews no longer store the link',
    es: 'Las vistas previas de links ya no guardan el link',
    pt: 'As prévias de links não guardam mais o link',
  },
  items: [
    {
      product: 'inbox',
      en: 'The preview cache for links shared in WhatsApp chats keeps a one-way code of each link instead of the link itself, so a token in a link is never stored. Old entries are deleted every hour after two weeks.',
      es: 'La caché de vistas previas de los links que se comparten en chats de WhatsApp guarda un código de una sola vía de cada link en vez del link, así que un token dentro de un link nunca queda guardado. Cada hora se borra lo que tiene más de dos semanas.',
      pt: 'O cache de prévias dos links compartilhados em conversas do WhatsApp guarda um código de mão única de cada link em vez do link, então um token dentro de um link nunca fica guardado. A cada hora é apagado o que tem mais de duas semanas.',
    },
    {
      product: 'groups',
      en: 'Lines uses the same cache, with the same rule.',
      es: 'Lines usa la misma caché, con la misma regla.',
      pt: 'O Lines usa o mesmo cache, com a mesma regra.',
    },
  ],
} satisfies ChangelogEntry;
