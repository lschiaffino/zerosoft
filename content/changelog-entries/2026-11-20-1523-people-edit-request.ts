import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-1523-people-edit-request',
  date: '2026-11-20',
  title: {
    en: 'People: edit a time off request',
    es: 'People: editar un pedido de licencia',
    pt: 'People: editar um pedido de folga',
  },
  items: [
    {
      product: 'people',
      en: 'A time off request now has an Edit button for the person who asked and for HR. You can change the type, the dates, the half day and the note while it is pending, or after it was approved as long as it has not started. An approved request goes back to pending, its Cal block is removed, and the manager gets a notice to approve it again.',
      es: 'Un pedido de licencia ahora tiene el botón Editar para quien lo pidió y para HR. Podés cambiar el tipo, las fechas, el medio día y la nota mientras está pendiente, o después de aprobado si todavía no empezó. Un pedido aprobado vuelve a pendiente, se saca su bloqueo de Cal y el manager recibe un aviso para aprobarlo de nuevo.',
      pt: 'Um pedido de folga agora tem o botão Editar para quem pediu e para o RH. Você pode mudar o tipo, as datas, o meio período e a nota enquanto ele está pendente, ou depois de aprovado se ainda não começou. Um pedido aprovado volta a pendente, o bloqueio no Cal é removido e o gestor recebe um aviso para aprovar de novo.',
    },
  ],
} satisfies ChangelogEntry;
