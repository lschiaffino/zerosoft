import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-19-lines-no-overdue-bar',
  date: '2026-11-19',
  title: {
    en: 'Lines: no more coloured bar on the left of overdue chats',
    es: 'Lines: se va la barra de color a la izquierda de los chats vencidos',
    pt: 'Lines: sai a barra colorida à esquerda das conversas vencidas',
  },
  items: [
    {
      product: 'groups',
      en: 'Chats past their reply limit carried a coloured bar on the left edge of the row. In an inbox where many chats are overdue, the bar ran down almost the whole list and said nothing. It is gone. An overdue chat still shows the small clock next to its time, with the detail when you hover over it, and the Waiting filter still finds them.',
      es: 'Los chats que pasaron su límite de respuesta llevaban una barra de color en el borde izquierdo de la fila. En una bandeja con muchos chats vencidos, la barra bajaba por casi toda la lista y no decía nada. Se sacó. Un chat vencido sigue mostrando el reloj chico junto a la hora, con el detalle al pasar el mouse, y el filtro En espera los sigue encontrando.',
      pt: 'As conversas que passaram do limite de resposta tinham uma barra colorida na borda esquerda da linha. Em uma caixa com muitas conversas vencidas, a barra descia por quase toda a lista e não dizia nada. Ela foi removida. Uma conversa vencida continua mostrando o relógio pequeno ao lado da hora, com o detalhe ao passar o mouse, e o filtro Aguardando continua encontrando-as.',
    },
  ],
} satisfies ChangelogEntry;
