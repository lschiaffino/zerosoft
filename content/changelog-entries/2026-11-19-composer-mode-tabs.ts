import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-19-composer-mode-tabs',
  date: '2026-11-19',
  title: {
    en: 'Lines and Inbox: colored tabs for WhatsApp and notes, and a floating Polish',
    es: 'Lines e Inbox: solapas de color para WhatsApp y notas, y Pulir flotando',
    pt: 'Lines e Inbox: abas coloridas para WhatsApp e notas, e Polir flutuando',
  },
  items: [
    {
      product: 'groups',
      en: 'The switch above the message box was plain text on a gray strip. It is now two folder tabs that stand on the chat background: WhatsApp in green and Internal note in yellow, with its lock. The tab you are on has the same color as the message box below it, so you can tell at a glance whether you are writing to the customer or to your team. The arrow keys move between the two tabs.',
      es: 'El selector arriba del campo de mensaje era texto sobre una franja gris. Ahora son dos solapas de carpeta paradas sobre el fondo del chat: WhatsApp en verde y Nota interna en amarillo, con su candado. La solapa elegida tiene el mismo color que el campo de abajo, así se ve de un vistazo si estás escribiendo al cliente o a tu equipo. Las flechas pasan de una solapa a la otra.',
      pt: 'O seletor acima da caixa de mensagem era texto sobre uma faixa cinza. Agora são duas abas de pasta sobre o fundo do chat: WhatsApp em verde e Nota interna em amarelo, com o cadeado. A aba escolhida tem a mesma cor da caixa de baixo, então dá para ver de relance se você está escrevendo para o cliente ou para a sua equipe. As setas passam de uma aba para a outra.',
    },
    {
      product: 'inbox',
      en: 'When you write a long message, the Polish offer used to appear as a new row above the message box and pushed the whole conversation up. It now floats as a small button over the top edge of the box, like the dictation mic, and nothing moves. The "Draft inserted" notice with Undo floats the same way.',
      es: 'Al escribir un mensaje largo, la oferta de Pulir aparecía como una fila nueva arriba del campo y subía toda la conversación. Ahora flota como un botón chico sobre el borde de arriba del campo, como el micrófono de dictado, y nada se mueve. El aviso de "Borrador insertado" con Deshacer flota igual.',
      pt: 'Ao escrever uma mensagem longa, a oferta de Polir aparecia como uma linha nova acima da caixa e empurrava a conversa toda para cima. Agora ela flutua como um botão pequeno sobre a borda de cima da caixa, como o microfone de ditado, e nada se mexe. O aviso de "Rascunho inserido" com Desfazer flutua do mesmo jeito.',
    },
  ],
} satisfies ChangelogEntry;
