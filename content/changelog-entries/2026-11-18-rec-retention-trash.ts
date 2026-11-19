import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-18-rec-retention-trash',
  date: '2026-11-18',
  title: {
    en: 'Rec: Videos removed by the retention can be restored',
    es: 'Rec: Los videos que saca la retención se pueden restaurar',
    pt: 'Rec: Os vídeos removidos pela retenção podem ser restaurados',
  },
  items: [
    {
      product: 'rec',
      en: 'When the workspace keeps videos for a set number of days, videos near the end of that term now go to a trash in Rec settings instead of being deleted right away. Whoever recorded a video sees theirs and an admin sees all of them, with the date each one will be deleted for good and a Restore button that brings back the video with its comments and analytics. Videos are still deleted for good, with their files, on the same day as before.',
      es: 'Cuando el workspace guarda los videos por una cantidad de días, los que llegan al final de ese plazo ahora pasan a una papelera en los ajustes de Rec en vez de borrarse en el momento. Quien grabó un video ve los suyos y un admin ve todos, con la fecha en que cada uno se borra para siempre y un botón Restaurar que devuelve el video con sus comentarios y analítica. Los videos se siguen borrando para siempre, con sus archivos, el mismo día que antes.',
      pt: 'Quando o workspace guarda os vídeos por um número de dias, os que chegam ao fim desse prazo agora vão para uma lixeira nos ajustes do Rec em vez de serem excluídos na hora. Quem gravou um vídeo vê os seus e um admin vê todos, com a data em que cada um será excluído de vez e um botão Restaurar que traz de volta o vídeo com comentários e análises. Os vídeos continuam sendo excluídos de vez, com seus arquivos, no mesmo dia de antes.',
    },
  ],
} satisfies ChangelogEntry;
