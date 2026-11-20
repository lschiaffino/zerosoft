import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-composer-tabs-gray',
  date: '2026-11-20',
  title: {
    en: 'Lines: calmer composer tabs and a lighter "Reply from"',
    es: 'Lines: solapas del compositor más calmas y un "Responder desde" más liviano',
    pt: 'Lines: abas do compositor mais calmas e um "Responder de" mais leve',
  },
  items: [
    {
      product: 'groups',
      en: 'The WhatsApp tab and the reply box go back to the usual grey (the note tab stays yellow), and the tabs lose the coloured line on top. "Reply from" takes less height: the line name is plain text that underlines and shows a small arrow on hover, and opens the list on click.',
      es: 'La solapa de WhatsApp y la caja de respuesta vuelven al gris de siempre (la de la nota sigue amarilla), y las solapas pierden el filete de color de arriba. "Responder desde" ocupa menos alto: el nombre de la línea es texto que se subraya y muestra una flechita al pasar el mouse, y abre la lista con un clic.',
      pt: 'A aba do WhatsApp e a caixa de resposta voltam ao cinza de sempre (a da nota continua amarela), e as abas perdem o filete colorido de cima. "Responder de" ocupa menos altura: o nome da linha é texto que sublinha e mostra uma setinha ao passar o mouse, e abre a lista com um clique.',
    },
  ],
} satisfies ChangelogEntry;
