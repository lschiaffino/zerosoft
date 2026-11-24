import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-23-track-inbox-side-panel',
  date: '2026-11-23',
  title: {
    en: 'Track: the inbox opens issues next to the list',
    es: 'Track: el inbox abre los issues al lado de la lista',
    pt: 'Track: o inbox abre os issues ao lado da lista',
  },
  items: [
    {
      product: 'track',
      en: 'Opening a notification shows its issue next to the inbox, like Linear: the list stays where it was, J and K move to the next or previous notification and the panel follows, and Esc or the close button returns to the list. On a phone the issue takes the full screen. You can also unsubscribe from an issue right from its row, or from the issue you opened, and both stay in sync.',
      es: 'Abrir un aviso muestra su issue al lado del inbox, como en Linear: la lista queda donde estaba, J y K pasan al aviso siguiente o anterior y el panel los sigue, y Esc o la cruz vuelven a la lista. En el teléfono el issue ocupa la pantalla. También podés dejar de seguir un issue desde su fila o desde el issue abierto, y los dos quedan sincronizados.',
      pt: 'Abrir um aviso mostra o issue ao lado do inbox, como no Linear: a lista fica onde estava, J e K vão para o aviso seguinte ou anterior e o painel acompanha, e Esc ou o botão de fechar voltam à lista. No celular o issue ocupa a tela. Também dá para deixar de seguir um issue pela linha ou pelo issue aberto, e os dois ficam sincronizados.',
    },
  ],
} satisfies ChangelogEntry;
