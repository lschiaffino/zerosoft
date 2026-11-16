import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-16-wa-archive-sync',
  date: '2026-11-16',
  title: {
    en: 'Inbox and Lines: archiving syncs with the phone again, and search marks archived chats',
    es: 'Inbox y Lines: el archivado vuelve a sincronizar con el teléfono, y la búsqueda marca los chats archivados',
    pt: 'Inbox e Lines: o arquivamento volta a sincronizar com o telefone, e a busca marca os chats arquivados',
  },
  items: [
    {
      product: 'inbox',
      en: 'A chat you archive in Inbox is archived on the phone too: one-to-one chats now go to WhatsApp with the id WhatsApp uses for them. Unarchiving on the phone a chat you archived here brings it back to the inbox.',
      es: 'Un chat que archivás en Inbox se archiva también en el teléfono: los chats 1:1 ahora van a WhatsApp con el id que WhatsApp usa para ellos. Desarchivar en el teléfono un chat que archivaste acá lo devuelve a la bandeja.',
      pt: 'Um chat que você arquiva no Inbox também fica arquivado no telefone: os chats 1:1 agora vão para o WhatsApp com o id que o WhatsApp usa para eles. Desarquivar no telefone um chat que você arquivou aqui o devolve para a caixa de entrada.',
    },
    {
      product: 'inbox',
      en: 'In search results, an archived chat shows "Archived" on the right of its row, like WhatsApp.',
      es: 'En los resultados de búsqueda, un chat archivado muestra "Archivado" a la derecha de su fila, como WhatsApp.',
      pt: 'Nos resultados da busca, um chat arquivado mostra "Arquivado" à direita da linha, como no WhatsApp.',
    },
    {
      product: 'groups',
      en: 'The same in Lines: archiving goes to the phone with the right id, and search marks archived chats.',
      es: 'Lo mismo en Lines: el archivado va al teléfono con el id correcto y la búsqueda marca los chats archivados.',
      pt: 'O mesmo no Lines: o arquivamento vai para o telefone com o id certo e a busca marca os chats arquivados.',
    },
  ],
} satisfies ChangelogEntry;
