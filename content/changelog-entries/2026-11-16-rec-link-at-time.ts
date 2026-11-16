import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-16-rec-link-at-time',
  date: '2026-11-16',
  title: {
    en: 'Rec: share a video starting at a given moment',
    es: 'Rec: compartí un video desde un momento puntual',
    pt: 'Rec: compartilhe um vídeo a partir de um momento',
  },
  items: [
    {
      product: 'rec',
      en: 'On a video page, "Copy link at 1:05" copies the link with the current time. Anyone who opens it starts there. You can also write it by hand: add ?t=90 or ?t=1m30s to the link.',
      es: 'En la página de un video, "Copiar link en 1:05" copia el link con el momento actual. Quien lo abre empieza ahí. También se puede escribir a mano: agregá ?t=90 o ?t=1m30s al link.',
      pt: 'Na página de um vídeo, "Copiar link em 1:05" copia o link com o momento atual. Quem abre começa ali. Também dá para escrever à mão: adicione ?t=90 ou ?t=1m30s ao link.',
    },
  ],
} satisfies ChangelogEntry;
