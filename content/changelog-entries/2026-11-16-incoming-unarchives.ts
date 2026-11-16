import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-16-incoming-unarchives',
  date: '2026-11-16',
  title: {
    en: 'Inbox and Lines: a new message unarchives the chat',
    es: 'Inbox y Lines: un mensaje nuevo desarchiva el chat',
    pt: 'Inbox e Lines: uma mensagem nova desarquiva a conversa',
  },
  items: [
    {
      product: 'inbox',
      en: 'A message that arrives in an archived WhatsApp chat brings it back to the list, also when the chat is muted, like WhatsApp with Keep chats archived turned off. Chats set to Keep archived stay in Archived.',
      es: 'Un mensaje que llega a un chat de WhatsApp archivado lo devuelve a la lista, también si el chat está silenciado, como WhatsApp con Mantener chats archivados apagado. Los chats con Mantener archivado se quedan en Archivados.',
      pt: 'Uma mensagem que chega a uma conversa de WhatsApp arquivada a devolve para a lista, também se a conversa estiver silenciada, como o WhatsApp com Manter conversas arquivadas desativado. As conversas com Manter arquivada ficam em Arquivadas.',
    },
    {
      product: 'groups',
      en: 'Lines does the same. The workspace setting that keeps archived chats in Archived when a message arrives is now off for every workspace; you can turn it back on in Settings. Chats set to Keep archived stay in Archived either way.',
      es: 'Lines hace lo mismo. El ajuste del workspace que deja los chats archivados en Archivados cuando llega un mensaje ahora está apagado en todos los workspaces; se puede volver a prender en Ajustes. Los chats con Mantener archivado se quedan en Archivados igual.',
      pt: 'O Lines faz o mesmo. O ajuste do workspace que deixa as conversas arquivadas em Arquivadas quando chega uma mensagem agora está desativado em todos os workspaces; dá para ativar de novo em Ajustes. As conversas com Manter arquivada ficam em Arquivadas de qualquer forma.',
    },
  ],
} satisfies ChangelogEntry;
