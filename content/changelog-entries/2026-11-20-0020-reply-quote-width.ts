import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-reply-quote-width',
  date: '2026-11-20',
  title: {
    en: 'Inbox and Lines: a reply to a long message no longer stretches the bubble',
    es: 'Inbox y Lines: responder a un mensaje largo ya no estira la burbuja',
    pt: 'Inbox e Lines: responder a uma mensagem longa não estica mais o balão',
  },
  items: [
    {
      product: 'inbox',
      en: 'When someone replied to a long message, the quoted text ran on one line and made the whole bubble as wide as the screen, even for a short voice note. Now, as in WhatsApp, the bubble is as wide as the reply itself and the quote wraps to fit, up to three lines with "…" at the end.',
      es: 'Cuando alguien respondía a un mensaje largo, el texto citado iba en un solo renglón y hacía la burbuja tan ancha como la pantalla, aunque la respuesta fuera un audio corto. Ahora, como en WhatsApp, la burbuja tiene el ancho de la respuesta y la cita se acomoda a ese ancho, en hasta tres renglones con "…" al final.',
      pt: 'Quando alguém respondia a uma mensagem longa, o texto citado ia numa linha só e deixava o balão inteiro da largura da tela, mesmo para um áudio curto. Agora, como no WhatsApp, o balão tem a largura da resposta e a citação se ajusta a ela, em até três linhas com "…" no fim.',
    },
  ],
} satisfies ChangelogEntry;
