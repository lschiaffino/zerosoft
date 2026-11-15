import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-wa-archive-relink-notice',
  date: '2026-11-15',
  title: {
    en: 'Inbox and Lines: a clear notice when archiving stops syncing with WhatsApp',
    es: 'Inbox y Lines: un aviso claro cuando el archivado deja de sincronizarse con WhatsApp',
    pt: 'Inbox e Lines: um aviso claro quando o arquivamento para de sincronizar com o WhatsApp',
  },
  items: [
    {
      product: 'inbox',
      en: 'Sometimes a linked WhatsApp loses the keys it needs to sync archived chats. Before, archiving looked like it worked but never reached the phone. Now Inbox stops trying, and the WhatsApp settings say archiving is not syncing and that Sync again links the number again to fix it.',
      es: 'A veces un WhatsApp vinculado pierde las claves que necesita para sincronizar los chats archivados. Antes, archivar parecía funcionar pero nunca llegaba al teléfono. Ahora Inbox deja de intentarlo, y la configuración de WhatsApp avisa que el archivado no se sincroniza y que Volver a sincronizar vincula el número de nuevo para arreglarlo.',
      pt: 'Às vezes um WhatsApp vinculado perde as chaves de que precisa para sincronizar os chats arquivados. Antes, arquivar parecia funcionar mas nunca chegava ao celular. Agora o Inbox para de tentar, e as configurações do WhatsApp avisam que o arquivamento não está sincronizando e que Sincronizar de novo vincula o número outra vez para corrigir.',
    },
    {
      product: 'groups',
      en: 'Lines does the same for each line: the number settings show the notice until the line is disconnected and linked again, or until an archive goes through.',
      es: 'Lines hace lo mismo con cada línea: la configuración de números muestra el aviso hasta que la línea se desconecta y se vuelve a vincular, o hasta que un archivado sale bien.',
      pt: 'O Lines faz o mesmo com cada linha: as configurações de números mostram o aviso até a linha ser desconectada e vinculada de novo, ou até um arquivamento dar certo.',
    },
  ],
} satisfies ChangelogEntry;
