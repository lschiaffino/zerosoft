import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-23-lines-refresh-members-row',
  date: '2026-11-23',
  title: {
    en: 'Lines: Refresh in group info lines up with the other actions',
    es: 'Lines: Actualizar en la info del grupo se alinea con las otras acciones',
    pt: 'Lines: Atualizar nas informações do grupo se alinha com as outras ações',
  },
  items: [
    {
      product: 'groups',
      en: 'In a group\'s info, Refresh (which asks WhatsApp for the member list again) was a loose, indented button under the members. It is now a row like Add members and Invite via link, with its own icon, in every look.',
      es: 'En la info de un grupo, Actualizar (que le vuelve a pedir la lista de miembros a WhatsApp) era un botón suelto y corrido debajo de los miembros. Ahora es una fila como Agregar miembros e Invitar con link, con su ícono, en todos los aspectos.',
      pt: 'Nas informações de um grupo, Atualizar (que pede de novo a lista de membros ao WhatsApp) era um botão solto e deslocado embaixo dos membros. Agora é uma linha como Adicionar membros e Convidar por link, com seu ícone, em todos os visuais.',
    },
  ],
} satisfies ChangelogEntry;
