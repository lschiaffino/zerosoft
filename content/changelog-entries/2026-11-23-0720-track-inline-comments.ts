import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-23-track-inline-comments',
  date: '2026-11-23',
  title: {
    en: 'Track: comment on part of an issue description',
    es: 'Track: comentá una parte de la descripción de un issue',
    pt: 'Track: comente uma parte da descrição de um issue',
  },
  items: [
    {
      product: 'track',
      en: 'Select text in an issue description and choose Comment in the toolbar that appears. The comment keeps the quote, the text stays highlighted until the thread is resolved, and clicking the highlight takes you to the thread. Replies, @mentions and reactions work as in any comment.',
      es: 'Elegí texto de la descripción de un issue y tocá Comentar en la barra que aparece. El comentario guarda la cita, el texto queda resaltado hasta que se resuelve el hilo y un clic en el resaltado te lleva al hilo. Las respuestas, @menciones y reacciones funcionan como en cualquier comentario.',
      pt: 'Selecione um texto da descrição de um issue e toque em Comentar na barra que aparece. O comentário guarda a citação, o texto fica destacado até a thread ser resolvida e um clique no destaque leva você à thread. Respostas, @menções e reações funcionam como em qualquer comentário.',
    },
  ],
} satisfies ChangelogEntry;
