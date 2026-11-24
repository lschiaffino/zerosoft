import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-23-track-project-comments',
  date: '2026-11-23',
  title: {
    en: 'Track: comments on projects and initiatives',
    es: 'Track: comentarios en projects e iniciativas',
    pt: 'Track: comentários em projetos e iniciativas',
  },
  items: [
    {
      product: 'track',
      en: 'Projects and initiatives have a Comments section on their overview, with the same comments as issues: @mentions, replies, resolve, reactions, and edit or delete your own. The lead, members and followers of a project, or the lead of an initiative, get the new comments in their inbox. Track guests do not see these threads.',
      es: 'Los projects y las iniciativas tienen una sección Comentarios en su resumen, con los mismos comentarios que los issues: @menciones, respuestas, resolver, reacciones, y editar o borrar los tuyos. El lead, los miembros y los seguidores de un project, o el lead de una iniciativa, reciben los comentarios nuevos en su inbox. Los invitados de Track no ven estos hilos.',
      pt: 'Projetos e iniciativas têm uma seção Comentários no resumo, com os mesmos comentários dos issues: @menções, respostas, resolver, reações, e editar ou excluir os seus. O lead, os membros e os seguidores de um projeto, ou o lead de uma iniciativa, recebem os comentários novos no inbox. Convidados do Track não veem essas threads.',
    },
  ],
} satisfies ChangelogEntry;
