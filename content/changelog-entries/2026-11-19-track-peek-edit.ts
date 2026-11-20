import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-19-track-peek-edit',
  date: '2026-11-19',
  title: {
    en: 'Track: edit an issue from the peek',
    es: 'Track: editar un issue desde la vista rápida',
    pt: 'Track: editar um issue na visualização rápida',
  },
  items: [
    {
      product: 'track',
      en: 'The peek (Space on a row) showed status, priority and assignee as plain text, so changing them meant opening the issue. They are now the same chips as the issue page: status, priority, assignee, labels, project, cycle, estimate and dates open the same menus, and S, P, A, L and the other shortcuts work while the peek is open. The row behind it changes at once, goes back with a notice if the save fails, and can be undone with ⌘Z. The activity in the peek lists these changes next to the comments. Esc closes an open menu first and the peek on a second press.',
      es: 'La vista rápida (Espacio sobre una fila) mostraba estado, prioridad y asignado como texto, así que para cambiarlos había que abrir el issue. Ahora son los mismos chips que en la página del issue: estado, prioridad, asignado, labels, project, cycle, estimación y fechas abren los mismos menús, y S, P, A, L y los demás atajos funcionan con la vista rápida abierta. La fila de atrás cambia al instante, vuelve atrás con un aviso si no se pudo guardar y se deshace con ⌘Z. La actividad de la vista rápida muestra estos cambios junto a los comentarios. Esc cierra primero el menú abierto y con otro Esc la vista rápida.',
      pt: 'A visualização rápida (Espaço sobre uma linha) mostrava status, prioridade e responsável como texto, então para mudá-los era preciso abrir o issue. Agora são os mesmos chips da página do issue: status, prioridade, responsável, labels, project, cycle, estimativa e datas abrem os mesmos menus, e S, P, A, L e os outros atalhos funcionam com a visualização rápida aberta. A linha de trás muda na hora, volta com um aviso se não foi possível salvar e se desfaz com ⌘Z. A atividade da visualização rápida mostra essas mudanças junto aos comentários. Esc fecha primeiro o menu aberto e, com outro Esc, a visualização rápida.',
    },
  ],
} satisfies ChangelogEntry;
