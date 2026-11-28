import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-28-brief-email-unsubscribe',
  date: '2026-11-28',
  title: {
    en: 'Daily brief email: one-click unsubscribe',
    es: 'Email del resumen del día: baja de un clic',
    pt: 'E-mail do resumo do dia: cancelar com um clique',
  },
  items: [
    {
      product: 'groups',
      en: 'The daily brief email now carries a one-click unsubscribe that Gmail, Outlook and Apple Mail show next to the sender, and an Unsubscribe link at the bottom that asks you to confirm. It only turns off the email; the card in Lines and Inbox stays.',
      es: 'El email del resumen del día ahora trae la baja de un clic que Gmail, Outlook y Apple Mail muestran al lado del remitente, y un link para darte de baja al pie que te pide confirmar. Solo apaga el email; la tarjeta de Lines e Inbox sigue.',
      pt: 'O e-mail do resumo do dia agora traz o cancelamento com um clique que o Gmail, o Outlook e o Apple Mail mostram ao lado do remetente, e um link para cancelar no rodapé que pede confirmação. Só desliga o e-mail; o cartão do Lines e do Inbox continua.',
    },
  ],
} satisfies ChangelogEntry;
