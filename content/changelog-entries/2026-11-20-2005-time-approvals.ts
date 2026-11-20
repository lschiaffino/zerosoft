import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-time-approvals',
  date: '2026-11-20',
  title: {
    en: 'Time: submit your week for approval',
    es: 'Time: enviá tu semana para aprobar',
    pt: 'Time: envie sua semana para aprovação',
  },
  items: [
    {
      product: 'time',
      en: 'Submit a week from the timesheet, like in Harvest: its hours lock while it waits, and you can withdraw it until someone decides. Owners and admins get a notice and find the week in the new Approvals page, where they look at its entries and approve it or return it with a note. An approved week stays locked until an admin reopens it. Time is still in internal preview.',
      es: 'Enviá una semana desde la hoja de horas, como en Harvest: sus horas quedan trabadas mientras espera, y la podés retirar hasta que alguien decida. Dueños y admins reciben un aviso y la encuentran en la nueva página Aprobaciones, donde miran sus entradas y la aprueban o la devuelven con una nota. Una semana aprobada sigue trabada hasta que un admin la reabre. Time sigue en vista previa interna.',
      pt: 'Envie uma semana pela folha de horas, como no Harvest: as horas ficam travadas enquanto ela espera, e você pode retirá-la até que alguém decida. Donos e admins recebem um aviso e a encontram na nova página Aprovações, onde veem os registros e aprovam ou devolvem com uma nota. Uma semana aprovada continua travada até que um admin a reabra. O Time continua em prévia interna.',
    },
  ],
} satisfies ChangelogEntry;
