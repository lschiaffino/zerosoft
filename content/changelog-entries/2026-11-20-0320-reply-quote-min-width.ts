import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-reply-quote-min-width',
  date: '2026-11-20',
  title: {
    en: 'Inbox and Lines: a short reply shows its quote on one line',
    es: 'Inbox y Lines: una respuesta corta muestra la cita en un renglón',
    pt: 'Inbox e Lines: uma resposta curta mostra a citação numa linha',
  },
  items: [
    {
      product: 'inbox',
      en: 'After the last change, a short reply ("Ahora sí!") squeezed the quoted message into three narrow lines. Now, as in WhatsApp, the quote widens the bubble up to the width of its text (at most about 400px), and only a long quote wraps.',
      es: 'Después del último cambio, una respuesta corta ("¡Ahora sí!") apretaba el mensaje citado en tres renglones angostos. Ahora, como en WhatsApp, la cita ensancha la burbuja hasta el ancho de su texto (como mucho unos 400px), y solo una cita larga baja de renglón.',
      pt: 'Depois da última mudança, uma resposta curta ("Agora sim!") apertava a mensagem citada em três linhas estreitas. Agora, como no WhatsApp, a citação alarga o balão até a largura do texto (no máximo uns 400px), e só uma citação longa quebra a linha.',
    },
  ],
} satisfies ChangelogEntry;
