import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-api-private-no-store',
  date: '2026-11-15',
  title: {
    en: 'API responses are not cached by default',
    es: 'Las respuestas de la API no se guardan en caché por defecto',
    pt: 'As respostas da API não ficam em cache por padrão',
  },
  items: [
    {
      product: 'platform',
      en: 'Every response under /api now says private, no-store unless the route sets its own caching on purpose, like social preview images, feeds, embeds and public files.',
      es: 'Toda respuesta bajo /api ahora dice private, no-store, salvo las rutas que fijan su caché a propósito, como las imágenes para redes, los feeds, los embeds y los archivos públicos.',
      pt: 'Toda resposta em /api agora diz private, no-store, exceto as rotas que definem o próprio cache de propósito, como imagens para redes, feeds, embeds e arquivos públicos.',
    },
  ],
} satisfies ChangelogEntry;
