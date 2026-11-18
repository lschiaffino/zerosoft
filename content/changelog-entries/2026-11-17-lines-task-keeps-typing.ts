import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-17-lines-task-keeps-typing',
  date: '2026-11-17',
  title: {
    en: 'Lines: a task you are writing stays when the chat updates',
    es: 'Lines: la tarea que estás escribiendo queda aunque el chat se actualice',
    pt: 'Lines: a tarefa que você está escrevendo fica mesmo quando o chat atualiza',
  },
  items: [
    {
      product: 'groups',
      en: 'Creating a task from a message reset the title, date and notes when a new message arrived or the chat refreshed. Now the form only starts over when you open it or pick another message. Editing a task in Tasks works the same way.',
      es: 'Crear una tarea desde un mensaje volvía atrás el título, la fecha y las notas cuando llegaba otro mensaje o el chat se actualizaba. Ahora el formulario empieza de cero solo al abrirlo o al elegir otro mensaje. Editar una tarea en Tareas funciona igual.',
      pt: 'Criar uma tarefa a partir de uma mensagem voltava o título, a data e as notas quando chegava outra mensagem ou o chat atualizava. Agora o formulário só recomeça quando você o abre ou escolhe outra mensagem. Editar uma tarefa em Tarefas funciona igual.',
    },
  ],
} satisfies ChangelogEntry;
