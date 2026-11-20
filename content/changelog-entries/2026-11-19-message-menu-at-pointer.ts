import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-19-message-menu-at-pointer',
  date: '2026-11-19',
  title: {
    en: 'Inbox and Lines: right-clicking a message opens its menu where you clicked',
    es: 'Inbox y Lines: el clic derecho en un mensaje abre su menú donde hiciste clic',
    pt: 'Inbox e Lines: o clique direito numa mensagem abre o menu onde você clicou',
  },
  items: [
    {
      product: 'inbox',
      en: 'Right-clicking a message opened its menu next to the arrow at the end of the bubble, wherever you clicked, and near the bottom of the window the last items could end up cut off. The menu now opens at the pointer, as in WhatsApp on the computer, and opens to the left or upward when it would not fit, so every item stays inside the window. The arrow on the bubble still opens it next to the bubble.',
      es: 'El clic derecho en un mensaje abría su menú al lado de la flecha del final de la burbuja, hicieras clic donde hicieras clic, y cerca del borde de abajo de la ventana los últimos ítems podían quedar cortados. Ahora el menú se abre en el puntero, como WhatsApp en la compu, y se abre hacia la izquierda o hacia arriba cuando no entra, así cada ítem queda dentro de la ventana. La flecha de la burbuja lo sigue abriendo al lado de la burbuja.',
      pt: 'O clique direito numa mensagem abria o menu ao lado da seta no fim do balão, onde quer que você clicasse, e perto da borda de baixo da janela os últimos itens podiam ficar cortados. Agora o menu abre no ponteiro, como o WhatsApp no computador, e abre para a esquerda ou para cima quando não cabe, assim cada item fica dentro da janela. A seta do balão continua abrindo o menu ao lado do balão.',
    },
  ],
} satisfies ChangelogEntry;
