import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-wa-archive-stale',
  date: '2026-11-15',
  title: {
    en: 'Inbox and Lines: archived chats stay archived when the line cannot sync with the phone',
    es: 'Inbox y Lines: lo archivado queda archivado aunque la línea no sincronice con el teléfono',
    pt: 'Inbox e Lines: o que foi arquivado continua arquivado mesmo se a linha não sincroniza com o telefone',
  },
  items: [
    {
      product: 'inbox',
      en: 'When a line shows the "link again" notice, the phone never learns what you archive in Inbox, and kept sending chats back to the inbox. Now a chat you archive stays archived until you link the line again.',
      es: 'Cuando una línea muestra el aviso de volver a vincular, el teléfono no se entera de lo que archivás en Inbox y devolvía los chats a la bandeja. Ahora un chat que archivás queda archivado hasta que vuelvas a vincular la línea.',
      pt: 'Quando uma linha mostra o aviso de vincular de novo, o telefone não fica sabendo do que você arquiva no Inbox e devolvia os chats para a caixa de entrada. Agora um chat que você arquiva continua arquivado até você vincular a linha de novo.',
    },
    {
      product: 'groups',
      en: 'The same in Lines, line by line.',
      es: 'Lo mismo en Lines, línea por línea.',
      pt: 'O mesmo no Lines, linha por linha.',
    },
  ],
} satisfies ChangelogEntry;
