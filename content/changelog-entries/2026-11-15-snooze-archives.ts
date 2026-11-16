import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-snooze-archives',
  date: '2026-11-15',
  title: {
    en: 'Inbox and Lines: a snoozed chat waits in Archived',
    es: 'Inbox y Lines: un chat pospuesto espera en Archivados',
    pt: 'Inbox e Lines: uma conversa adiada espera em Arquivadas',
  },
  items: [
    {
      product: 'inbox',
      en: 'Snoozing a chat now archives it, here and on the phone, so it shows in Archived and in Snoozed instead of disappearing from both lists. When the time is up, a new message arrives or you cancel the snooze, it is unarchived and goes back to the inbox. A chat that was already archived before you snoozed it stays archived if you cancel. Unarchiving a snoozed chat or sending a message in it ends the snooze. Chats that were already snoozed now show in Archived too.',
      es: 'Posponer un chat ahora lo archiva, acá y en el teléfono, así aparece en Archivados y en Pospuestos en vez de desaparecer de las dos listas. Cuando llega la hora, entra un mensaje o cancelás el pospuesto, se desarchiva y vuelve a la bandeja. Un chat que ya estaba archivado antes de posponerlo sigue archivado si cancelás. Desarchivar un chat pospuesto o mandar un mensaje en él termina el pospuesto. Los chats que ya estaban pospuestos ahora también aparecen en Archivados.',
      pt: 'Adiar uma conversa agora a arquiva, aqui e no celular, e ela aparece em Arquivadas e em Adiadas em vez de sumir das duas listas. Quando chega a hora, entra uma mensagem ou você cancela o adiamento, ela é desarquivada e volta para a caixa. Uma conversa que já estava arquivada antes de adiar continua arquivada se você cancelar. Desarquivar uma conversa adiada ou enviar uma mensagem nela encerra o adiamento. As conversas que já estavam adiadas agora também aparecem em Arquivadas.',
    },
    {
      product: 'groups',
      en: 'Lines can snooze a chat too, from the chat menu or with a right click. The chat waits in Archived with a clock icon until the time you pick, then comes back to the list marked unread. A new message brings it back early, even if your workspace keeps archived chats archived.',
      es: 'Lines también puede posponer un chat, desde el menú del chat o con clic derecho. El chat espera en Archivados con un reloj hasta la hora que elegís y después vuelve a la lista marcado como no leído. Un mensaje nuevo lo trae antes, aunque el workspace mantenga archivados los chats archivados.',
      pt: 'O Lines também pode adiar uma conversa, pelo menu da conversa ou com o botão direito. A conversa espera em Arquivadas com um relógio até a hora escolhida e depois volta para a lista marcada como não lida. Uma mensagem nova traz de volta antes, mesmo se o workspace mantém arquivadas as conversas arquivadas.',
    },
  ],
} satisfies ChangelogEntry;
