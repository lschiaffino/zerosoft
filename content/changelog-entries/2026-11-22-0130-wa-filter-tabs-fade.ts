import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-22-wa-filter-tabs-fade',
  date: '2026-11-22',
  title: {
    en: 'Lines and Inbox: the filter tabs show there are more to scroll',
    es: 'Lines e Inbox: las pestañas de filtro muestran que hay más para deslizar',
    pt: 'Lines e Inbox: as abas de filtro mostram que há mais para deslizar',
  },
  items: [
    {
      product: 'groups',
      en: 'When the filter tabs above the chat list do not fit, the edge with more tabs fades out instead of cutting a tab in half. Scroll sideways to see the rest.',
      es: 'Cuando las pestañas de filtro arriba de la lista no entran, el borde con más pestañas se esfuma en lugar de cortar una pestaña a la mitad. Deslizá de costado para ver el resto.',
      pt: 'Quando as abas de filtro acima da lista não cabem, a borda com mais abas se esvai em vez de cortar uma aba ao meio. Deslize para o lado para ver o resto.',
    },
    {
      product: 'inbox',
      en: 'The filter tabs above the chat list fade at the edge when there are more to scroll.',
      es: 'Las pestañas de filtro arriba de la lista se esfuman en el borde cuando hay más para deslizar.',
      pt: 'As abas de filtro acima da lista se esvaem na borda quando há mais para deslizar.',
    },
  ],
} satisfies ChangelogEntry;
