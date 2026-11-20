import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-2010-social-tag-suggestions',
  date: '2026-11-20',
  title: {
    en: 'Social: hashtag and mention suggestions while you write',
    es: 'Social: sugerencias de hashtags y menciones al escribir',
    pt: 'Social: sugestões de hashtags e menções ao escrever',
  },
  items: [
    {
      product: 'social',
      en: 'Type # or @ in the composer and a list shows the hashtags and mentions your team already used, most used first, with how many posts used each one. Keep typing to narrow it, use the arrows and Enter or Tab to insert one, or click it. Esc closes the list and leaves the text as it is. The list comes from the posts you can see and the hashtag sets in the library.',
      es: 'Escribí # o @ en el compositor y aparece una lista con los hashtags y menciones que el equipo ya usó, los más usados primero, con en cuántas publicaciones aparece cada uno. Seguí escribiendo para achicarla, usá las flechas y Enter o Tab para insertar uno, o hacé clic. Esc cierra la lista y deja el texto como está. La lista sale de las publicaciones que ves y de los grupos de hashtags de la biblioteca.',
      pt: 'Digite # ou @ no editor e aparece uma lista com as hashtags e menções que a equipe já usou, as mais usadas primeiro, com em quantas publicações cada uma aparece. Continue digitando para filtrar, use as setas e Enter ou Tab para inserir uma, ou clique nela. Esc fecha a lista e deixa o texto como está. A lista vem das publicações que você vê e dos grupos de hashtags da biblioteca.',
    },
  ],
} satisfies ChangelogEntry;
