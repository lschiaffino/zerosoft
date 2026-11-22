import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-21-retro-row-headers',
  date: '2026-11-21',
  title: {
    en: 'Cleaner tables in the Retro look',
    es: 'Tablas más prolijas en el aspecto Retro',
    pt: 'Tabelas mais limpas no aspecto Retro',
  },
  items: [
    {
      product: 'people',
      en: 'In the Retro look, the first cell of each row (the name in the People directory) no longer looks like a raised column header: the row reads as one line again. In the org chart, "Open the directory" is underlined so it reads as a link.',
      es: 'En el aspecto Retro, la primera celda de cada fila (el nombre en el directorio de People) ya no parece una cabecera de columna en relieve: la fila se lee de corrido otra vez. En el organigrama, "Abrir el directorio" va subrayado para que se lea como link.',
      pt: 'No aspecto Retro, a primeira célula de cada linha (o nome no diretório do People) não parece mais um cabeçalho de coluna em relevo: a linha volta a ser lida de uma vez. No organograma, "Abrir o diretório" fica sublinhado para ser lido como link.',
    },
  ],
} satisfies ChangelogEntry;
