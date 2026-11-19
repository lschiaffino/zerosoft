import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-19-composer-mode-tabs',
  date: '2026-11-19',
  title: {
    en: 'Lines: WhatsApp and internal note are two colored tabs',
    es: 'Lines: WhatsApp y nota interna son dos solapas de color',
    pt: 'Lines: WhatsApp e nota interna são duas abas coloridas',
  },
  items: [
    {
      product: 'groups',
      en: 'The switch above the message box was plain text on a gray strip. It is now two folder tabs that stand on the chat background: WhatsApp in green and Internal note in yellow, with its lock. The tab you are on has the same color as the message box below it, so you can tell at a glance whether you are writing to the customer or to your team. The arrow keys move between the two tabs.',
      es: 'El selector arriba del campo de mensaje era texto sobre una franja gris. Ahora son dos solapas de carpeta paradas sobre el fondo del chat: WhatsApp en verde y Nota interna en amarillo, con su candado. La solapa elegida tiene el mismo color que el campo de abajo, así se ve de un vistazo si estás escribiendo al cliente o a tu equipo. Las flechas pasan de una solapa a la otra.',
      pt: 'O seletor acima da caixa de mensagem era texto sobre uma faixa cinza. Agora são duas abas de pasta sobre o fundo do chat: WhatsApp em verde e Nota interna em amarelo, com o cadeado. A aba escolhida tem a mesma cor da caixa de baixo, então dá para ver de relance se você está escrevendo para o cliente ou para a sua equipe. As setas passam de uma aba para a outra.',
    },
  ],
} satisfies ChangelogEntry;
