import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-rec-webm-cues',
  date: '2026-11-15',
  title: {
    en: 'Rec: you can jump ahead in a video right after recording it',
    es: 'Rec: se puede adelantar un video apenas se termina de grabar',
    pt: 'Rec: dá para adiantar um vídeo logo depois de gravar',
  },
  items: [
    {
      product: 'rec',
      en: 'When you stop recording, Rec writes an index at the start of the recorded file, without re-encoding it. The player can jump to any second from the first moment, before the playback copy is ready. Trimmed and edited copies get the same index.',
      es: 'Al terminar de grabar, Rec escribe un índice al principio del archivo grabado, sin volver a codificarlo. El reproductor puede saltar a cualquier segundo desde el primer momento, antes de que esté lista la copia para reproducir. Las copias recortadas y editadas llevan el mismo índice.',
      pt: 'Ao terminar de gravar, o Rec escreve um índice no começo do arquivo gravado, sem codificar de novo. O player consegue pular para qualquer segundo desde o primeiro momento, antes de a cópia para reprodução ficar pronta. As cópias cortadas e editadas levam o mesmo índice.',
    },
  ],
} satisfies ChangelogEntry;
