import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-0749-move-folder-dialog',
  date: '2026-11-20',
  title: {
    en: 'Lines and Inbox: one Move to folder dialog',
    es: 'Lines e Inbox: un solo diálogo de Mover a carpeta',
    pt: 'Lines e Inbox: um só diálogo de Mover para pasta',
  },
  items: [
    {
      product: 'groups',
      en: 'Move to folder in Lines now uses the same compact dialog as Inbox. Type to search, use the arrow keys and press Enter to move the chat to the highlighted folder. Each row shows its place in the folder tree, the folder the chat is in now is marked, and "No folder" comes first. "+ New folder" creates the folder right there and moves the chat into it. Team folders and your own folders keep their own headings. On a phone it opens as a sheet from the bottom.',
      es: 'Mover a carpeta en Lines ahora usa el mismo diálogo compacto que Inbox. Escribí para buscar, usá las flechas y Enter para mover el chat a la carpeta marcada. Cada fila muestra su lugar en el árbol de carpetas, la carpeta donde está el chat va marcada y "Sin carpeta" va primero. "+ Carpeta nueva" la crea ahí mismo y mueve el chat adentro. Las carpetas del equipo y las tuyas tienen cada una su título. En el teléfono se abre como una hoja desde abajo.',
      pt: 'Mover para pasta no Lines agora usa o mesmo diálogo compacto do Inbox. Digite para buscar, use as setas e Enter para mover a conversa para a pasta marcada. Cada linha mostra seu lugar na árvore de pastas, a pasta onde a conversa está fica marcada e "Sem pasta" vem primeiro. "+ Nova pasta" cria a pasta ali mesmo e move a conversa para ela. As pastas da equipe e as suas têm cada uma seu título. No celular abre como uma folha de baixo.',
    },
    {
      product: 'inbox',
      en: 'Add to folder in Inbox gains "No folder", which takes the chat out of all its folders, arrow-key navigation, and "+ New folder", which creates the folder and adds the chat in one step.',
      es: 'Sumar a carpeta en Inbox suma "Sin carpeta", que saca el chat de todas sus carpetas, navegación con flechas y "+ Carpeta nueva", que crea la carpeta y suma el chat en un paso.',
      pt: 'Adicionar à pasta no Inbox ganha "Sem pasta", que tira a conversa de todas as pastas, navegação com as setas e "+ Nova pasta", que cria a pasta e adiciona a conversa num passo só.',
    },
  ],
} satisfies ChangelogEntry;
