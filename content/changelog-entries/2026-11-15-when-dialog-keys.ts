import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-when-dialog-keys',
  date: '2026-11-15',
  title: {
    en: 'Snooze and schedule: move with the arrow keys',
    es: 'Posponer y programar: moverse con las flechas',
    pt: 'Adiar e agendar: navegar com as setas',
  },
  items: [
    {
      product: 'inbox',
      en: 'In "Snooze until", "Remind me" and "Send later", the up and down arrows move between the times and Enter picks one, so you never need the mouse. When two options land on the same time (on a Sunday, "Tomorrow morning" and "Next week"), it is shown once; the number shortcuts stay the same.',
      es: 'En "Posponer hasta", "Recordarme" y "Enviar más tarde", las flechas arriba y abajo recorren los horarios y Enter elige, sin tocar el mouse. Cuando dos opciones caen en la misma hora (un domingo, "Mañana a la mañana" y "La semana que viene"), se ve una sola; los atajos con números no cambian.',
      pt: 'Em "Adiar até", "Lembrar" e "Enviar mais tarde", as setas para cima e para baixo percorrem os horários e Enter escolhe, sem usar o mouse. Quando duas opções caem no mesmo horário (num domingo, "Amanhã de manhã" e "Semana que vem"), aparece uma só; os atalhos com números não mudam.',
    },
    {
      product: 'groups',
      en: 'The same in Lines when you schedule a message.',
      es: 'Lo mismo en Lines al programar un mensaje.',
      pt: 'O mesmo no Lines ao agendar uma mensagem.',
    },
  ],
} satisfies ChangelogEntry;
