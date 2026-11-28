import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-23-track-releases',
  date: '2026-11-23',
  title: {
    en: 'Track: Releases',
    es: 'Track: Releases',
    pt: 'Track: Releases',
  },
  items: [
    {
      product: 'track',
      en: 'Releases, as in Linear: create one for a team with a name, version, target date and status (planned, in progress, released) from Track › Releases or ⌘K. Add issues from the release page, from the Release property of an issue, or from a list with ⌘K (also on a selection). With GitHub connected, an issue whose linked pull request is merged joins the team\'s current release on its own. The release page shows progress, its issues by status and release notes generated from the issue titles, grouped into new, improvements and fixes by label; edit them, copy them or generate them again. Lists and boards can show Release as a property, filter by it and group by it. A release follows its team\'s access: private teams and guests see only their own.',
      es: 'Releases, como en Linear: creá uno para un team con nombre, versión, fecha objetivo y estado (planeado, en curso, publicado) desde Track › Releases o ⌘K. Sumá issues desde la página del release, desde la propiedad Release de un issue o desde una lista con ⌘K (también con una selección). Con GitHub conectado, un issue cuyo pull request vinculado se mergea entra solo al release en curso del team. La página del release muestra el avance, sus issues por estado y notas generadas con los títulos de los issues, agrupadas en novedades, mejoras y arreglos según el label; editalas, copialas o generalas de nuevo. Listas y tableros pueden mostrar Release como propiedad, filtrar y agrupar por él. Un release sigue el acceso de su team: los teams privados y los invitados ven solo los suyos.',
      pt: 'Releases, como no Linear: crie um para um team com nome, versão, data prevista e status (planejado, em andamento, publicado) em Track › Releases ou ⌘K. Adicione issues pela página do release, pela propriedade Release de um issue ou por uma lista com ⌘K (também com uma seleção). Com o GitHub conectado, um issue cujo pull request vinculado é mergeado entra sozinho no release em andamento do team. A página do release mostra o andamento, os issues por status e notas geradas com os títulos dos issues, agrupadas em novidades, melhorias e correções pelo label; edite, copie ou gere de novo. Listas e quadros podem mostrar Release como propriedade, filtrar e agrupar por ele. Um release segue o acesso do seu team: teams privados e convidados veem só os seus.',
    },
  ],
} satisfies ChangelogEntry;
