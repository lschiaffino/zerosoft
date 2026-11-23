import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-23-track-sidebar-toolbar-polish',
  date: '2026-11-23',
  title: {
    en: 'Track: tidier issue properties and filter bar',
    es: 'Track: propiedades del issue y barra de filtros más prolijas',
    pt: 'Track: propriedades do issue e barra de filtros mais organizadas',
  },
  items: [
    {
      product: 'track',
      en: 'Time in status, SLA and Agent in the issue sidebar now look like the other properties, with an icon and the value. In issue lists, adding filters keeps search, saved views and Display on the first line; the filters wrap on their own.',
      es: 'Tiempo en el estado, SLA y Agente en el panel del issue ahora se ven como las demás propiedades, con un ícono y el valor. En las listas de issues, al sumar filtros la búsqueda, las vistas guardadas y Display quedan en la primera línea; los filtros bajan solos.',
      pt: 'Tempo no status, SLA e Agente no painel do issue agora aparecem como as outras propriedades, com um ícone e o valor. Nas listas de issues, ao adicionar filtros a busca, as visualizações salvas e o Display ficam na primeira linha; os filtros quebram sozinhos.',
    },
  ],
} satisfies ChangelogEntry;
