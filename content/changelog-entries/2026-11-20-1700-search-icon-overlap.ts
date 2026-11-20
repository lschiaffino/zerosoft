import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-search-icon-overlap',
  date: '2026-11-20',
  title: {
    en: 'Search fields: the magnifier no longer covers the text',
    es: 'Buscadores: la lupa ya no tapa el texto',
    pt: 'Campos de busca: a lupa não cobre mais o texto',
  },
  items: [
    {
      product: 'groups',
      en: 'In the group info of Lines and Inbox ("Search members"), and in the search fields of Board, Link and Notes, the magnifier icon was drawn on top of the first letters. The text now starts after the icon.',
      es: 'En la info del grupo de Lines e Inbox ("Buscar miembros"), y en los buscadores de Board, Link y Notes, la lupa se dibujaba encima de las primeras letras. Ahora el texto empieza después de la lupa.',
      pt: 'Nos dados do grupo de Lines e Inbox ("Buscar membros"), e nos campos de busca de Board, Link e Notes, o ícone de lupa ficava em cima das primeiras letras. Agora o texto começa depois do ícone.',
    },
  ],
} satisfies ChangelogEntry;
