import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-rec-fast-seek',
  date: '2026-11-15',
  title: {
    en: 'Rec: jumping to any point of a video is immediate',
    es: 'Rec: saltar a cualquier punto de un video es inmediato',
    pt: 'Rec: pular para qualquer ponto de um vídeo é imediato',
  },
  items: [
    {
      product: 'rec',
      en: 'When a recording finishes uploading, Rec prepares a copy for playback with its index at the start and a keyframe every 2 seconds, and the player switches to it. Before, the recorded file had no index, so jumping ahead made the browser read the whole video up to that point: in our test with a 2 minute 1080p video, a jump took 3.7 to 4.9 seconds and read 15 to 21 MB. With the new copy it takes 0.2 to 0.4 seconds and reads less than 1 MB. Videos recorded before this get their copy the first time someone plays them.',
      es: 'Cuando una grabación termina de subir, Rec arma una copia para reproducir con el índice al principio y un keyframe cada 2 segundos, y el reproductor pasa a usarla. Antes el archivo grabado no tenía índice, así que para saltar el navegador leía todo el video hasta ese punto: en nuestra prueba con un video de 2 minutos en 1080p, un salto tardaba de 3,7 a 4,9 segundos y leía de 15 a 21 MB. Con la copia nueva tarda de 0,2 a 0,4 segundos y lee menos de 1 MB. Los videos grabados antes reciben su copia la primera vez que alguien los mira.',
      pt: 'Quando uma gravação termina de subir, o Rec prepara uma cópia para reprodução com o índice no começo e um keyframe a cada 2 segundos, e o player passa a usá-la. Antes o arquivo gravado não tinha índice, então para pular o navegador lia todo o vídeo até aquele ponto: no nosso teste com um vídeo de 2 minutos em 1080p, um pulo levava de 3,7 a 4,9 segundos e lia de 15 a 21 MB. Com a cópia nova leva de 0,2 a 0,4 segundo e lê menos de 1 MB. Os vídeos gravados antes recebem a cópia na primeira vez que alguém os assiste.',
    },
  ],
} satisfies ChangelogEntry;
