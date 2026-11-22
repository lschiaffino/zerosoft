import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-22-crm-task-check-ring',
  date: '2026-11-22',
  title: {
    en: 'CRM: the task check keeps its size',
    es: 'CRM: el check de las tareas mantiene su tamaño',
    pt: 'CRM: o check das tarefas mantém o tamanho',
  },
  items: [
    {
      product: 'crm',
      en: 'On the Tasks page, the round check next to each task is the same small circle on the phone as on the computer, and you can still tap it anywhere in a 40px area. On the computer, a task title that wraps to several lines no longer squeezes the check into an oval.',
      es: 'En la página de Tareas, el check redondo de cada tarea es el mismo círculo chico en el teléfono que en la compu, y se sigue tocando en un área de 40px. En la compu, un título que ocupa varias líneas ya no aplasta el check en un óvalo.',
      pt: 'Na página de Tarefas, o check redondo de cada tarefa é o mesmo círculo pequeno no celular e no computador, e continua dando para tocar numa área de 40px. No computador, um título que ocupa várias linhas não achata mais o check num oval.',
    },
  ],
} satisfies ChangelogEntry;
