import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-1901-social-list-filters',
  date: '2026-11-20',
  title: {
    en: 'Social: filter the post list by network and account',
    es: 'Social: filtrar la lista de publicaciones por red y cuenta',
    pt: 'Social: filtrar a lista de publicações por rede e conta',
  },
  items: [
    {
      product: 'social',
      en: 'Posts has two new filters next to the search: network and account. Picking a network leaves only the accounts of that network in the second filter. Filters stay on when you switch between Drafts, Scheduled and the other tabs, and live in the address so you can share or bookmark the view. If nothing matches, Clear filters brings back the whole list.',
      es: 'Publicaciones tiene dos filtros nuevos al lado de la búsqueda: red y cuenta. Al elegir una red, el segundo filtro deja solo las cuentas de esa red. Los filtros quedan puestos al pasar entre Borradores, Programadas y las otras pestañas, y van en la dirección, así que la vista se puede compartir o guardar. Si nada coincide, Quitar filtros vuelve a la lista entera.',
      pt: 'Publicações tem dois filtros novos ao lado da busca: rede e conta. Ao escolher uma rede, o segundo filtro mostra só as contas dessa rede. Os filtros continuam ao trocar entre Rascunhos, Agendadas e as outras abas, e ficam no endereço, então dá para compartilhar ou salvar a visão. Se nada corresponder, Limpar filtros volta à lista inteira.',
    },
  ],
} satisfies ChangelogEntry;
