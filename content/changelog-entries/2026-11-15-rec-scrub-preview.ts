import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-rec-scrub-preview',
  date: '2026-11-15',
  title: {
    en: 'Rec: frame previews on the timeline',
    es: 'Rec: vista previa de cuadros en la línea de tiempo',
    pt: 'Rec: prévia de quadros na linha do tempo',
  },
  items: [
    {
      product: 'rec',
      en: 'Hover over the player\'s timeline, or drag on it on a phone, to see a frame of that moment with the time and the chapter, like on YouTube or Loom. The frames are prepared together with the playback copy after the upload: one every 2 seconds, or more spaced out in long videos. On a trimmed video they only show what stays inside the trim.',
      es: 'Pasá el mouse por la línea de tiempo del reproductor, o arrastrá en el teléfono, para ver un cuadro de ese momento con el tiempo y el capítulo, como en YouTube o Loom. Los cuadros se arman junto con la copia para reproducir después de subir: uno cada 2 segundos, o más espaciados en videos largos. En un video recortado solo muestran lo que queda dentro del recorte.',
      pt: 'Passe o mouse pela linha do tempo do player, ou arraste no celular, para ver um quadro daquele momento com o tempo e o capítulo, como no YouTube ou no Loom. Os quadros são preparados junto com a cópia para reprodução depois do envio: um a cada 2 segundos, ou mais espaçados em vídeos longos. Num vídeo cortado eles só mostram o que fica dentro do corte.',
    },
  ],
} satisfies ChangelogEntry;
