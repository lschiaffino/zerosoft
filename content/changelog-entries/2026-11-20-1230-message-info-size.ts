import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-message-info-size',
  date: '2026-11-20',
  title: {
    en: 'Inbox and Lines: Message info at the chat\'s text size',
    es: 'Inbox y Lines: Info del mensaje con el tamaño de letra del chat',
    pt: 'Inbox e Lines: Dados da mensagem com o tamanho de letra da conversa',
  },
  items: [
    {
      product: 'inbox',
      en: 'The Message info window (read, delivered, sent) used a larger text than the messages behind it. It now uses the same size as the chat.',
      es: 'La ventana Info del mensaje (leído, entregado, enviado) usaba una letra más grande que la de los mensajes de atrás. Ahora usa el mismo tamaño que el chat.',
      pt: 'A janela Dados da mensagem (lida, entregue, enviada) usava uma letra maior que a das mensagens atrás. Agora usa o mesmo tamanho da conversa.',
    },
  ],
} satisfies ChangelogEntry;
