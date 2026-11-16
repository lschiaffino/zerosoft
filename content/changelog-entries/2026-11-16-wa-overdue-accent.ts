import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-16-wa-overdue-accent',
  date: '2026-11-16',
  title: {
    en: 'Inbox and Lines: overdue chats get a colored edge, and buttons use the app color',
    es: 'Inbox y Lines: los chats vencidos llevan un borde de color y los botones el color de la app',
    pt: 'Inbox e Lines: chats vencidos ganham uma borda colorida e os botões a cor do app',
  },
  items: [
    {
      product: 'inbox',
      en: 'A chat that came back from snooze or whose reminder ran out without a reply has a thin colored line on the left of its row. Hover it to see since when. The row keeps its height. Send and the confirm buttons use the Inbox color.',
      es: 'Un chat que volvió de posponer o cuyo recordatorio venció sin respuesta tiene una línea fina de color a la izquierda de la fila. Al pasar el mouse dice desde cuándo. La fila no cambia de alto. Enviar y los botones de confirmar llevan el color de Inbox.',
      pt: 'Um chat que voltou do adiamento ou cujo lembrete venceu sem resposta tem uma linha fina colorida à esquerda da linha. Ao passar o mouse diz desde quando. A linha não muda de altura. Enviar e os botões de confirmar usam a cor do Inbox.',
    },
    {
      product: 'groups',
      en: 'In Lines, a chat past the reply limit gets the same line next to the red clock, and Send uses the Lines color.',
      es: 'En Lines, un chat que pasó el límite de respuesta lleva la misma línea junto al reloj rojo, y Enviar el color de Lines.',
      pt: 'No Lines, um chat que passou do limite de resposta ganha a mesma linha junto ao relógio vermelho, e Enviar usa a cor do Lines.',
    },
  ],
} satisfies ChangelogEntry;
