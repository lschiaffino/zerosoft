import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-23-liquid-tabs-edges',
  date: '2026-11-23',
  title: {
    en: 'Liquid look: tabs without blocks at the edges',
    es: 'Aspecto Líquido: pestañas sin bloques en los bordes',
    pt: 'Aparência Líquido: abas sem blocos nas bordas',
  },
  items: [
    {
      product: 'platform',
      en: 'In the Liquid look, tab rows across the apps no longer paint a plain light block at their left and right edges over the gradient background. The other looks stay the same.',
      es: 'En el aspecto Líquido, las filas de pestañas de las apps ya no pintan un bloque claro liso en sus bordes izquierdo y derecho sobre el fondo en degradé. Los otros aspectos quedan igual.',
      pt: 'Na aparência Líquido, as fileiras de abas dos apps não pintam mais um bloco claro liso nas bordas esquerda e direita sobre o fundo em degradê. As outras aparências ficam iguais.',
    },
  ],
} satisfies ChangelogEntry;
