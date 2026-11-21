import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-21-cal-tour',
  date: '2026-11-21',
  title: {
    en: 'A guided tour of Cal the first time you open it',
    es: 'Un tour guiado de Cal la primera vez que lo abrís',
    pt: 'Um tour guiado do Cal na primeira vez que você abre',
  },
  items: [
    {
      product: 'cal',
      en: 'The first time you open Cal after signing up, a short tour highlights the main parts one at a time: creating an event type, sharing its booking link, upcoming bookings, the list of bookings, availability and Cal settings. With a team it also shows routing forms. You can go back, skip a step, leave with Esc or turn off all tours. Take it again from your account menu, and turn tours back on in Settings › Appearance.',
      es: 'La primera vez que abrís Cal después de crear tu cuenta, un tour corto resalta las partes principales de a una: crear un tipo de evento, compartir su link de reserva, las próximas reservas, la lista de reservas, la disponibilidad y los ajustes de Cal. Con un equipo muestra también los formularios de ruteo. Podés volver atrás, saltear un paso, salir con Esc o apagar todos los tours. Lo volvés a ver desde el menú de tu cuenta y los tours se vuelven a prender en Ajustes › Apariencia.',
      pt: 'Na primeira vez que você abre o Cal depois de criar a conta, um tour curto destaca as partes principais uma de cada vez: criar um tipo de evento, compartilhar o link de agendamento, os próximos agendamentos, a lista de agendamentos, a disponibilidade e as configurações do Cal. Com uma equipe mostra também os formulários de roteamento. Dá para voltar, pular uma etapa, sair com Esc ou desligar todos os tours. Refaça pelo menu da sua conta e ligue os tours de novo em Ajustes › Aparência.',
    },
  ],
} satisfies ChangelogEntry;
