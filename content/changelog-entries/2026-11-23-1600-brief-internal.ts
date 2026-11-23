import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-23-brief-internal',
  date: '2026-11-23',
  title: {
    en: 'Inbox: internal contacts stay out of your daily brief',
    es: 'Inbox: los contactos internos quedan fuera de tu resumen del día',
    pt: 'Inbox: contatos internos ficam fora do seu resumo do dia',
  },
  items: [
    {
      product: 'inbox',
      en: 'Chats with people marked as internal no longer count as chats to reply in the daily brief, on the card and in the morning email, the same as in the To reply view.',
      es: 'Los chats con personas marcadas como internas ya no cuentan como chats por responder en el resumen del día, en la tarjeta y en el email de la mañana, igual que en la vista Por responder.',
      pt: 'Conversas com pessoas marcadas como internas não contam mais como conversas para responder no resumo do dia, no cartão e no e-mail da manhã, igual à visão Para responder.',
    },
  ],
} satisfies ChangelogEntry;
