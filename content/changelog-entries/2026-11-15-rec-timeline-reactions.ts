import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-rec-timeline-reactions',
  date: '2026-11-15',
  title: {
    en: 'Rec: reactions float over the video and comments show on the timeline',
    es: 'Rec: las reacciones suben sobre el video y los comentarios se ven en la línea de tiempo',
    pt: 'Rec: as reações sobem sobre o vídeo e os comentários aparecem na linha do tempo',
  },
  items: [
    {
      product: 'rec',
      en: 'When playback reaches the second of a reaction, the emoji floats up over the video, like on Loom, and yours floats up as soon as you react. Hovering a comment mark on the timeline shows who wrote it and what it says, and a click still jumps to that second. The speed menu has a new "Skip silences" option that jumps over gaps of 2 seconds or more without anyone speaking, using the transcript.',
      es: 'Cuando la reproducción llega al segundo de una reacción, el emoji sube sobre el video, como en Loom, y el tuyo sube apenas reaccionás. Al pasar por una marca de comentario en la línea de tiempo se ve quién lo escribió y qué dice, y un clic sigue llevando a ese segundo. El menú de velocidad tiene una opción nueva, "Saltar silencios", que pasa de largo los huecos de 2 segundos o más sin nadie hablando, según la transcripción.',
      pt: 'Quando a reprodução chega ao segundo de uma reação, o emoji sobe sobre o vídeo, como no Loom, e o seu sobe assim que você reage. Ao passar por uma marca de comentário na linha do tempo aparece quem escreveu e o que diz, e um clique continua levando àquele segundo. O menu de velocidade tem uma opção nova, "Pular silêncios", que pula os intervalos de 2 segundos ou mais sem ninguém falando, pela transcrição.',
    },
  ],
} satisfies ChangelogEntry;
