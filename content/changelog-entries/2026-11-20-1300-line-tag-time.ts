import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-line-tag-time',
  date: '2026-11-20',
  title: {
    en: 'Lines: "Sent from" no longer overlaps the time',
    es: 'Lines: "Enviado desde" ya no se pisa con la hora',
    pt: 'Lines: "Enviado de" não se sobrepõe mais à hora',
  },
  items: [
    {
      product: 'groups',
      en: 'In a chat that arrives on several lines, the "Sent from …" / "Received on …" line under a short message was drawn under the time. It now leaves room for it.',
      es: 'En un chat que llega por varias líneas, el renglón "Enviado desde …" / "Recibido en …" debajo de un mensaje corto se dibujaba debajo de la hora. Ahora le deja lugar.',
      pt: 'Numa conversa que chega por várias linhas, a linha "Enviado de …" / "Recebido em …" abaixo de uma mensagem curta ficava embaixo da hora. Agora deixa espaço para ela.',
    },
  ],
} satisfies ChangelogEntry;
