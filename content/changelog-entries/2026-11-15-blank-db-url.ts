import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-blank-db-url',
  date: '2026-11-15',
  title: {
    en: 'Self-host: the app opens with the example .env as it comes',
    es: 'Self-host: la app abre con el .env de ejemplo tal como viene',
    pt: 'Self-host: o app abre com o .env de exemplo do jeito que vem',
  },
  items: [
    {
      product: 'platform',
      en: 'Copying .env.example or .env.offline.example left TURSO_DATABASE_URL empty, and every page that read the database failed with URL_INVALID. An empty value now means the local SQLite file at data/zerosoftware.db, as the file says.',
      es: 'Copiar .env.example o .env.offline.example dejaba TURSO_DATABASE_URL vacía, y toda página que leía la base fallaba con URL_INVALID. Un valor vacío ahora usa el archivo SQLite local en data/zerosoftware.db, como dice el archivo.',
      pt: 'Copiar .env.example ou .env.offline.example deixava TURSO_DATABASE_URL vazia, e toda página que lia o banco falhava com URL_INVALID. Um valor vazio agora usa o arquivo SQLite local em data/zerosoftware.db, como o arquivo diz.',
    },
  ],
} satisfies ChangelogEntry;
