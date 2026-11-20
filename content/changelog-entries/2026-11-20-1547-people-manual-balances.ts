import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-1547-people-manual-balances',
  date: '2026-11-20',
  title: {
    en: 'People: manual time off policies and a history of balance adjustments',
    es: 'People: políticas de licencia manuales e historial de ajustes de saldo',
    pt: 'People: políticas de folga manuais e histórico de ajustes de saldo',
  },
  items: [
    {
      product: 'people',
      en: 'A time off policy can now be updated manually by HR: it starts at zero, HR adds or removes days, and requests are checked against that balance. Adjusting a balance takes a date and a note, and the profile lists every adjustment with who made it. The person and their managers see the history; HR can delete an adjustment made by mistake.',
      es: 'Una política de licencia ahora puede actualizarla HR a mano: arranca en cero, HR suma o resta días y los pedidos se controlan contra ese saldo. Ajustar un saldo lleva fecha y nota, y la ficha lista cada ajuste con quién lo hizo. La persona y sus managers ven el historial; HR puede borrar un ajuste cargado por error.',
      pt: 'Uma política de folga agora pode ser atualizada manualmente pelo RH: começa em zero, o RH soma ou tira dias e os pedidos são verificados contra esse saldo. Ajustar um saldo pede data e nota, e o perfil lista cada ajuste com quem fez. A pessoa e os gestores veem o histórico; o RH pode excluir um ajuste feito por engano.',
    },
  ],
} satisfies ChangelogEntry;
