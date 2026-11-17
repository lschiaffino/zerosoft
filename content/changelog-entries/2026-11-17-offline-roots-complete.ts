import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-17-offline-roots-complete',
  date: '2026-11-17',
  title: {
    en: 'Offline: apps you never opened load in full',
    es: 'Sin conexión: las apps que nunca abriste cargan enteras',
    pt: 'Sem conexão: os apps que você nunca abriu carregam inteiros',
  },
  items: [
    {
      product: 'platform',
      en: 'The start page of each offline app is saved in the background. If the connection dropped during that save, the app could open without internet showing "Application error". Each page is now saved only after its files, so it opens complete or not at all. Pages in folder-like routes, like the Docs and Calendar home, also save their files now.',
      es: 'El inicio de cada app sin conexión se guarda solo, en segundo plano. Si la conexión se cortaba durante ese guardado, la app podía abrir sin internet con "Application error". Ahora cada página se guarda recién después de sus archivos: abre completa o no se guarda. Las páginas de rutas agrupadas, como el inicio de Docs y de Cal, también guardan sus archivos ahora.',
      pt: 'O início de cada app sem conexão é salvo sozinho, em segundo plano. Se a conexão caía durante esse salvamento, o app podia abrir sem internet com "Application error". Agora cada página só é salva depois dos arquivos dela: abre completa ou não é salva. As páginas de rotas agrupadas, como o início do Docs e do Cal, também salvam os arquivos agora.',
    },
  ],
} satisfies ChangelogEntry;
