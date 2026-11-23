import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-23-time-day-shortcuts',
  date: '2026-11-23',
  title: {
    en: 'Time: keyboard shortcuts in the day view',
    es: 'Time: atajos de teclado en la vista del día',
    pt: 'Time: atalhos de teclado na visão do dia',
  },
  items: [
    {
      product: 'time',
      en: 'In the day view of the timesheet, N opens a new entry, the left and right arrows move to the previous or next day, and T jumps to today. The keys do nothing while you are typing in a field or have a dialog open.',
      es: 'En la vista del día de la hoja de horas, N abre una entrada nueva, las flechas izquierda y derecha pasan al día anterior o siguiente, y T vuelve a hoy. Las teclas no hacen nada mientras escribís en un campo o tenés un diálogo abierto.',
      pt: 'Na visão do dia da folha de horas, N abre um novo registro, as setas esquerda e direita vão para o dia anterior ou seguinte, e T volta para hoje. As teclas não fazem nada enquanto você digita em um campo ou tem um diálogo aberto.',
    },
  ],
} satisfies ChangelogEntry;
