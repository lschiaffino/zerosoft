import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-19-time-project-team',
  date: '2026-11-19',
  title: {
    en: 'Time: a team and tasks for each project',
    es: 'Time: equipo y tareas en cada proyecto',
    pt: 'Time: equipe e tarefas em cada projeto',
  },
  items: [
    {
      product: 'time',
      en: 'Each project has a Team and Tasks, like in Harvest. Leave it open to everyone with Time or pick the people who track hours on it: the rest no longer see it. Pick the tasks for the project and whether each one is billable there, and the timesheet and the week grid offer only those. Existing projects stay open to everyone with all tasks. Time is still in internal preview.',
      es: 'Cada proyecto tiene Equipo y Tareas, como en Harvest. Dejalo abierto a todas las personas con Time o elegí quiénes cargan horas en él: el resto deja de verlo. Elegí las tareas del proyecto y si cada una se factura ahí, y la hoja y la grilla semanal ofrecen solo esas. Los proyectos que ya existían quedan abiertos a todos y con todas las tareas. Time sigue en vista previa interna.',
      pt: 'Cada projeto tem Equipe e Tarefas, como no Harvest. Deixe aberto a todas as pessoas com Time ou escolha quem registra horas nele: o resto deixa de vê-lo. Escolha as tarefas do projeto e se cada uma é faturável ali, e a folha e a grade semanal oferecem só essas. Os projetos que já existiam ficam abertos a todos e com todas as tarefas. O Time continua em prévia interna.',
    },
  ],
} satisfies ChangelogEntry;
