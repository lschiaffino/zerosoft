import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-22-pulse-paths-cleaning',
  date: '2026-11-22',
  title: {
    en: 'Pulse: skip and group steps in paths',
    es: 'Pulse: saltear y agrupar pasos en los caminos',
    pt: 'Pulse: pular e agrupar etapas nos caminhos',
  },
  items: [
    {
      product: 'pulse',
      en: 'Paths insights have two new lists. Skip takes pages or events out of the path, and the path goes on as if they were not there (/admin/* or a heartbeat event). Group counts every page that matches a pattern as one step (/blog/* for every blog post), and you can start or end a path at a group. Up to 20 patterns each, with * as a wildcard, saved with the insight.',
      es: 'Los insights de caminos tienen dos listas nuevas. Saltear saca páginas o eventos del camino, que sigue como si no estuvieran (/admin/* o un evento de heartbeat). Agrupar cuenta como un solo paso todas las páginas que coinciden con un patrón (/blog/* para todas las notas del blog), y un camino puede empezar o terminar en un grupo. Hasta 20 patrones cada una, con * como comodín, guardadas con el insight.',
      pt: 'Os insights de caminhos têm duas listas novas. Pular tira páginas ou eventos do caminho, que segue como se não estivessem lá (/admin/* ou um evento de heartbeat). Agrupar conta como uma só etapa todas as páginas que batem com um padrão (/blog/* para todos os posts do blog), e um caminho pode começar ou terminar em um grupo. Até 20 padrões cada uma, com * como curinga, salvas com o insight.',
    },
  ],
} satisfies ChangelogEntry;
