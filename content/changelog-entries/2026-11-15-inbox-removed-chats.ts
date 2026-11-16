import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-inbox-removed-chats',
  date: '2026-11-15',
  title: {
    en: 'Inbox and Lines: get back a chat you removed',
    es: 'Inbox y Lines: recuperar un chat que sacaste',
    pt: 'Inbox e Lines: recuperar uma conversa que você removeu',
  },
  items: [
    {
      product: 'inbox',
      en: '"Remove from Inbox" no longer deletes the chat. It waits 30 days in Archived › Removed from Inbox, where Restore puts it back where it was (folders, archived, pinned) with any messages that arrived meanwhile, and Delete for good erases it sooner. Right after removing, Undo in the notice brings it back. Chats removed before this change were already deleted and cannot be restored.',
      es: '"Sacar de Inbox" ya no borra el chat. Queda 30 días en Archivados › Sacados de Inbox, donde Recuperar lo devuelve a donde estaba (carpetas, archivado, fijado) con lo que llegó mientras tanto, y Borrar definitivamente lo borra antes. Justo después de sacarlo, Deshacer en el aviso lo trae de vuelta. Los chats sacados antes de este cambio ya se habían borrado y no se pueden recuperar.',
      pt: '"Remover do Inbox" não apaga mais a conversa. Ela fica 30 dias em Arquivadas › Removidos do Inbox, onde Recuperar a devolve para onde estava (pastas, arquivada, fixada) com o que chegou nesse meio-tempo, e Apagar de vez a apaga antes. Logo depois de remover, Desfazer no aviso a traz de volta. As conversas removidas antes desta mudança já tinham sido apagadas e não podem ser recuperadas.',
    },
    {
      product: 'groups',
      en: 'Chats deleted with "Delete chat" now show up in Archived › Deleted, where anyone who can see them can restore them, and the notice after deleting has Undo.',
      es: 'Los chats eliminados con "Eliminar chat" ahora aparecen en Archivados › Eliminados, donde quien puede verlos los recupera, y el aviso después de eliminar tiene Deshacer.',
      pt: 'As conversas apagadas com "Apagar conversa" agora aparecem em Arquivadas › Apagadas, onde quem pode vê-las consegue recuperá-las, e o aviso depois de apagar tem Desfazer.',
    },
  ],
} satisfies ChangelogEntry;
