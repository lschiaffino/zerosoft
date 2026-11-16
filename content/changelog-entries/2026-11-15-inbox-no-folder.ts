import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-inbox-no-folder',
  date: '2026-11-15',
  title: {
    en: 'Inbox and Lines: "No folder" at the top of your folders',
    es: 'Inbox y Lines: "Sin carpeta" arriba de tus carpetas',
    pt: 'Inbox e Lines: "Sem pasta" no topo das suas pastas',
  },
  items: [
    {
      product: 'inbox',
      en: 'The sidebar has a "No folder" entry right under Inbox, before your first folder. It lists the chats that are in no folder, with its unread count, so you can file them while you see the folder tree: press V, use the row menu or drop a chat on a folder, and it leaves the list with Undo. The link works on its own (/app/inbox/v/nofolder).',
      es: 'El lateral tiene "Sin carpeta" justo debajo de Bandeja, antes de tu primera carpeta. Lista los chats que no están en ninguna carpeta, con sus no leídos, para ordenarlos mirando el árbol: apretá V, usá el menú de la fila o soltá un chat sobre una carpeta, y sale de la lista con Deshacer. El link funciona solo (/app/inbox/v/nofolder).',
      pt: 'A lateral tem "Sem pasta" logo abaixo da Caixa de entrada, antes da sua primeira pasta. Lista as conversas que não estão em nenhuma pasta, com as não lidas, para organizá-las vendo a árvore: aperte V, use o menu da linha ou solte uma conversa numa pasta, e ela sai da lista com Desfazer. O link funciona sozinho (/app/inbox/v/nofolder).',
    },
    {
      product: 'groups',
      en: '"No folder" moved from the bottom of the folder tree to the top, with a folder icon. Moving a chat to a folder from there takes it off the list right away.',
      es: '"Sin carpeta" pasó del final del árbol de carpetas al principio, con un ícono de carpeta. Mover un chat a una carpeta desde ahí lo saca de la lista enseguida.',
      pt: '"Sem pasta" passou do fim da árvore de pastas para o começo, com um ícone de pasta. Mover uma conversa para uma pasta a partir dali a tira da lista na hora.',
    },
  ],
} satisfies ChangelogEntry;
