import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-1950-social-qa-polish',
  date: '2026-11-20',
  title: {
    en: 'Social: clearer week view, post page and accounts',
    es: 'Social: semana, publicación y cuentas más claras',
    pt: 'Social: semana, publicação e contas mais claras',
  },
  items: [
    {
      product: 'social',
      en: 'The week view of the calendar shows the whole range of days in its title, and in the 12-hour format post times read 4:09 PM instead of 04:09 PM. On a post page the text comes first and the new date and time below it. In Accounts, Who posts here and Queue times are smaller toggles under each account.',
      es: 'La vista de semana del calendario muestra en el título el rango entero de días, y en el formato de 12 horas las horas de las publicaciones van sin el cero de adelante. En la página de una publicación primero va el texto y abajo la nueva fecha y hora. En Cuentas, Quién publica acá y Horarios de cola son desplegables más chicos debajo de cada cuenta.',
      pt: 'A visão de semana do calendário mostra no título o intervalo inteiro de dias, e no formato de 12 horas os horários das publicações aparecem sem o zero na frente. Na página de uma publicação o texto vem primeiro e a nova data e hora embaixo. Em Contas, Quem publica aqui e Horários da fila são opções menores embaixo de cada conta.',
    },
  ],
} satisfies ChangelogEntry;
