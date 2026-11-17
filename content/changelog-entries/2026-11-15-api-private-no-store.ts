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
      en: 'Every read under /api now says private, no-store and errors say private, so no shared cache keeps them. Routes that set their own caching on purpose keep it, like social preview images, feeds, embeds, the desktop update feed and public files.',
      es: 'Toda lectura bajo /api ahora dice private, no-store y los errores dicen private, así ningún caché compartido los guarda. Las rutas que fijan su caché a propósito la conservan, como las imágenes para redes, los feeds, los embeds, el feed de actualizaciones de escritorio y los archivos públicos.',
      pt: 'Toda leitura em /api agora diz private, no-store e os erros dizem private, assim nenhum cache compartilhado os guarda. As rotas que definem o próprio cache de propósito o mantêm, como imagens para redes, feeds, embeds, o feed de atualizações do desktop e arquivos públicos.',
    },
  ],
} satisfies ChangelogEntry;
