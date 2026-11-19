import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-19-lines-owner-picker',
  date: '2026-11-19',
  title: {
    en: 'Lines: pick the owner of a line in its row, and see what the owner is for',
    es: 'Lines: el dueño de una línea se elige en su fila, y se explica para qué sirve',
    pt: 'Lines: o dono de uma linha é escolhido na própria linha, com a explicação de para que serve',
  },
  items: [
    {
      product: 'groups',
      en: 'Settings › Numbers has an Owner column. An admin clicks it, searches a person by name or email and the change is saved right there. The screen says what the owner is: the person in charge of the line, who always sees its chats even when the line is restricted and, with permission to connect numbers, can also reconnect, rename, share and delete it. Chats are not assigned to the owner. The Access dialog is now only about who sees the line.',
      es: 'Ajustes › Números tiene una columna Dueño. Un admin hace clic, busca a una persona por nombre o email y el cambio se guarda ahí mismo. La pantalla dice qué es el dueño: la persona a cargo de la línea, que siempre ve sus chats aunque la línea esté restringida y que, con permiso para conectar números, también la puede reconectar, renombrar, compartir y borrar. Los chats no se le asignan al dueño. El diálogo Acceso ahora trata solo de quién ve la línea.',
      pt: 'Configurações › Números tem uma coluna Dono. Um admin clica, busca uma pessoa por nome ou email e a mudança é salva ali mesmo. A tela diz o que é o dono: a pessoa responsável pela linha, que sempre vê as conversas dela mesmo quando a linha está restrita e que, com permissão para conectar números, também pode reconectar, renomear, compartilhar e excluir a linha. As conversas não são atribuídas ao dono. O diálogo Acesso agora trata só de quem vê a linha.',
    },
  ],
} satisfies ChangelogEntry;
