import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-23-0419-crm-notes-comments',
  date: '2026-11-23',
  title: {
    en: 'CRM: formatted notes and comments on every activity',
    es: 'CRM: notas con formato y comentarios en cada actividad',
    pt: 'CRM: notas com formatação e comentários em cada atividade',
  },
  items: [
    {
      product: 'crm',
      en: 'Notes on contacts, companies and deals now have a formatting bar: bold, italic, strikethrough, bulleted and numbered lists, links and @mentions, in the timeline and in the preview. Older notes read the same as before. Every note, email, call, meeting and task has a comment thread with its count, where you comment with formatting and @mentions and edit or delete your own comments. Comments follow the activity: whoever cannot see it cannot see its comments, and a mention only notifies teammates who can see it. Select all in this view and Export view now use the same filters the list shows, Export view keeps the view order, and it tells you when a view has more than 10,000 records.',
      es: 'Las notas de contactos, empresas y deals ahora tienen una barra de formato: negrita, cursiva, tachado, listas con viñetas y numeradas, links y @menciones, en el timeline y en la vista previa. Las notas de antes se leen igual que siempre. Cada nota, email, llamada, reunión y tarea tiene un hilo de comentarios con su contador, donde comentás con formato y @menciones y editás o borrás tus comentarios. Los comentarios siguen a la actividad: quien no la ve no ve sus comentarios, y una mención solo avisa a quien del equipo la puede ver. Elegir todos los de esta vista y Exportar vista ahora usan los mismos filtros que muestra la lista, Exportar vista respeta el orden de la vista y te avisa cuando la vista tiene más de 10.000 registros.',
      pt: 'As notas de contatos, empresas e negócios agora têm uma barra de formatação: negrito, itálico, tachado, listas com marcadores e numeradas, links e @menções, no timeline e na prévia. As notas antigas são lidas como antes. Cada nota, email, chamada, reunião e tarefa tem um fio de comentários com contador, onde você comenta com formatação e @menções e edita ou exclui seus comentários. Os comentários seguem a atividade: quem não a vê não vê seus comentários, e uma menção só avisa quem da equipe pode vê-la. Selecionar todos desta visualização e Exportar visualização agora usam os mesmos filtros que a lista mostra, Exportar visualização mantém a ordem da visualização e avisa quando ela tem mais de 10.000 registros.',
    },
  ],
} satisfies ChangelogEntry;
