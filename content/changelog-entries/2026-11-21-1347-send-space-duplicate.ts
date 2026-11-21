import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-21-send-space-duplicate',
  date: '2026-11-21',
  title: {
    en: 'Send: duplicate a space',
    es: 'Send: duplicar un espacio',
    pt: 'Send: duplicar um espaço',
  },
  items: [
    {
      product: 'send',
      en: 'A space now has a Duplicate button. The copy keeps the description and the documents with their order and folders, so one room can be the template for the next round or the next client. Links, the access list and visits are not copied: the copy starts unshared and belongs to whoever duplicated it.',
      es: 'Un espacio ahora tiene un botón Duplicar. La copia mantiene la descripción y los documentos con su orden y carpetas, así una sala sirve de plantilla para la próxima ronda o el próximo cliente. Los links, la lista de acceso y las visitas no se copian: la copia arranca sin compartir y es de quien la duplicó.',
      pt: 'Um espaço agora tem um botão Duplicar. A cópia mantém a descrição e os documentos com sua ordem e pastas, então uma sala serve de modelo para a próxima rodada ou o próximo cliente. Os links, a lista de acesso e as visitas não são copiados: a cópia começa sem compartilhar e é de quem a duplicou.',
    },
  ],
} satisfies ChangelogEntry;
