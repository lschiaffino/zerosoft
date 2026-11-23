import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-23-track-group-reorder',
  date: '2026-11-23',
  title: {
    en: 'Track: reorder groups and board columns',
    es: 'Track: reordenar grupos y columnas del tablero',
    pt: 'Track: reordenar grupos e colunas do quadro',
  },
  items: [
    {
      product: 'track',
      en: 'In lists and boards grouped by status, assignee, priority, project, cycle, label or milestone, drag a group header or a board column by its handle to put it where you want, as in Linear. It also works with a finger on the phone. From the keyboard, focus the handle and use the arrow keys, or open the group menu for Move up, Move down, Move to top, Move to bottom and Reset order. The order is remembered per view, saved with saved views (so shared views share it), and ⌘Z puts it back.',
      es: 'En listas y tableros agrupados por estado, asignado, prioridad, project, cycle, label o milestone, arrastrá el encabezado de un grupo o una columna del tablero desde su asa para ponerlo donde quieras, como en Linear. También anda con el dedo en el teléfono. Con el teclado, enfocá el asa y usá las flechas, o abrí el menú del grupo para Mover arriba, Mover abajo, Mover al principio, Mover al final y Restablecer orden. El orden queda recordado en cada vista, se guarda con las vistas guardadas (las compartidas lo comparten) y ⌘Z lo deja como estaba.',
      pt: 'Em listas e quadros agrupados por status, responsável, prioridade, project, cycle, label ou milestone, arraste o cabeçalho de um grupo ou uma coluna do quadro pela alça para colocá-lo onde quiser, como no Linear. Também funciona com o dedo no celular. Pelo teclado, foque a alça e use as setas, ou abra o menu do grupo para Mover para cima, Mover para baixo, Mover para o início, Mover para o fim e Restaurar ordem. A ordem fica lembrada em cada visualização, é salva com as visualizações salvas (as compartilhadas a compartilham) e ⌘Z desfaz.',
    },
  ],
} satisfies ChangelogEntry;
