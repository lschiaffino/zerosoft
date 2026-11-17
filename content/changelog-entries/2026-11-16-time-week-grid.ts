import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-16-time-week-grid',
  date: '2026-11-16',
  title: {
    en: 'Time: a week timesheet you type into',
    es: 'Time: hoja semanal para escribir las horas',
    pt: 'Time: folha semanal para digitar as horas',
  },
  items: [
    {
      product: 'time',
      en: 'The timesheet has a Week view, like Harvest: one row per project and task, a cell per day, and totals per row, per day and for the week. Type 1:30, 1.5 or 90m in a cell and it saves when you press Enter or move on; clearing a cell deletes that entry. Add row picks a project and a task, and an empty week can copy the rows of your last timesheet. A cell with several entries or a running timer opens that day, where notes and the timer live. Time is still in internal preview.',
      es: 'La hoja de horas tiene una vista Semana, como Harvest: una fila por proyecto y tarea, una celda por día y totales por fila, por día y de la semana. Escribí 1:30, 1,5 o 90m en una celda y se guarda con Enter o al pasar a otra; vaciarla borra esa entrada. Agregar fila elige proyecto y tarea, y una semana vacía puede copiar las filas de tu última hoja. Una celda con varias entradas o con un cronómetro corriendo abre ese día, donde están las notas y el cronómetro. Time sigue en vista previa interna.',
      pt: 'A folha de horas tem uma visão Semana, como o Harvest: uma linha por projeto e tarefa, uma célula por dia e totais por linha, por dia e da semana. Digite 1:30, 1,5 ou 90m numa célula e ela salva com Enter ou ao passar para outra; esvaziar a célula apaga esse registro. Adicionar linha escolhe projeto e tarefa, e uma semana vazia pode copiar as linhas da sua última folha. Uma célula com vários registros ou com um cronômetro rodando abre esse dia, onde ficam as notas e o cronômetro. O Time continua em prévia interna.',
    },
  ],
} satisfies ChangelogEntry;
