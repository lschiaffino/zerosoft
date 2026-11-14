import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-14-track-gauntlet-fixes',
  date: '2026-11-14',
  title: {
    en: 'Track: fixes from a full pass through the app',
    es: 'Track: arreglos de una pasada completa por la app',
    pt: 'Track: correções de uma passada completa pelo app',
  },
  items: [
    {
      product: 'track',
      en: 'In ⌘K, pressing Enter before the results arrive now opens the first result once it loads. Before, it could open an empty new issue. Issues with several labels stay on one line in the list, the Filter menu lines up each property with its icon, the Overview fits at phone width, and Initiatives says how many of its projects are active.',
      es: 'En ⌘K, Enter antes de que lleguen los resultados ahora abre el primero apenas carga. Antes podía abrir un issue nuevo vacío. Los issues con varias etiquetas quedan en una línea en la lista, el menú Filtro alinea cada propiedad con su ícono, el Resumen entra en el ancho de un teléfono e Initiatives dice cuántos de sus proyectos están activos.',
      pt: 'No ⌘K, apertar Enter antes de os resultados chegarem agora abre o primeiro assim que carrega. Antes podia abrir um issue novo vazio. Issues com várias etiquetas ficam em uma linha na lista, o menu Filtro alinha cada propriedade com seu ícone, o Resumo cabe na largura de um celular e Initiatives diz quantos dos seus projetos estão ativos.',
    },
  ],
} satisfies ChangelogEntry;
