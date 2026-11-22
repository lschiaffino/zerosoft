import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-22-wa-leave-group',
  date: '2026-11-22',
  title: {
    en: 'Inbox: exit a WhatsApp group, and a read-only chat after leaving in Inbox and Lines',
    es: 'Inbox: salir de un grupo de WhatsApp, y el chat de solo lectura después de salir en Inbox y Lines',
    pt: 'Inbox: sair de um grupo do WhatsApp, e a conversa somente leitura depois de sair no Inbox e no Lines',
  },
  items: [
    {
      product: 'inbox',
      en: 'Exit group at the bottom of the group info leaves the group on WhatsApp after a confirmation. The chat stays as history with "You left", and the message field is replaced by the notice that you are no longer a member, as on WhatsApp. The same happens when someone removes you from the phone, and being added back opens the chat again.',
      es: 'Salir del grupo, al pie de la info del grupo, sale del grupo en WhatsApp después de confirmar. El chat queda como historial con "Saliste" y el campo de mensaje se cambia por el aviso de que ya no sos miembro, como en WhatsApp. Lo mismo pasa si alguien te saca desde el teléfono, y si te vuelven a agregar el chat se abre otra vez.',
      pt: 'Sair do grupo, no fim dos dados do grupo, sai do grupo no WhatsApp depois de confirmar. A conversa fica como histórico com "Você saiu" e o campo de mensagem é trocado pelo aviso de que você não é mais membro, como no WhatsApp. O mesmo acontece se alguém remover você pelo celular, e se você for adicionado de novo a conversa reabre.',
    },
    {
      product: 'groups',
      en: 'A group the line left shows "You left" and the same notice in place of the WhatsApp field; the Internal note tab still works. Being removed from the phone does the same.',
      es: 'Un grupo del que salió la línea muestra "Saliste" y el mismo aviso en lugar del campo de WhatsApp; la solapa Nota interna sigue andando. Que te saquen desde el teléfono hace lo mismo.',
      pt: 'Um grupo de que a linha saiu mostra "Você saiu" e o mesmo aviso no lugar do campo do WhatsApp; a aba Nota interna continua funcionando. Ser removido pelo celular faz o mesmo.',
    },
  ],
} satisfies ChangelogEntry;
