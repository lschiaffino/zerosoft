import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-17-analytics-docs-board',
  date: '2026-11-17',
  title: {
    en: 'Docs and Board: analytics with the same layout as Lines',
    es: 'Docs y Board: analítica con el mismo formato que Lines',
    pt: 'Docs e Board: análises com o mesmo formato do Lines',
  },
  items: [
    {
      product: 'docs',
      en: 'New Analytics page: pages created and edited, edits, views, readers and comments against the previous period, edits and views per day, when pages get edited, who edits, by teamspace and a table by page. Filter by teamspace. Admins also get the published site tab with visits, visitors, most read pages, sources and how helpful readers found each page.',
      es: 'Nueva página de Analítica: páginas creadas y editadas, ediciones, vistas, lectores y comentarios contra el período anterior, ediciones y vistas por día, cuándo se editan, quién edita, por teamspace y una tabla por página. Filtro por teamspace. Los admins ven además la pestaña del sitio publicado con visitas, visitantes, páginas más leídas, de dónde llegan y si les sirvió cada página.',
      pt: 'Nova página de Análises: páginas criadas e editadas, edições, visualizações, leitores e comentários contra o período anterior, edições e visualizações por dia, quando são editadas, quem edita, por teamspace e uma tabela por página. Filtro por teamspace. Os admins também veem a aba do site publicado com visitas, visitantes, páginas mais lidas, de onde chegam e se cada página foi útil.',
    },
    {
      product: 'board',
      en: 'New Analytics page: boards created and edited, edits, collaborators, comments and elements against the previous period, activity per day, when boards get edited, who edits, by folder and a table by board. Filter by folder.',
      es: 'Nueva página de Analítica: pizarras creadas y editadas, ediciones, colaboradores, comentarios y elementos contra el período anterior, actividad por día, cuándo se editan, quién edita, por carpeta y una tabla por pizarra. Filtro por carpeta.',
      pt: 'Nova página de Análises: quadros criados e editados, edições, colaboradores, comentários e elementos contra o período anterior, atividade por dia, quando são editados, quem edita, por pasta e uma tabela por quadro. Filtro por pasta.',
    },
  ],
} satisfies ChangelogEntry;
