import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-23-lines-refresh-members-row',
  date: '2026-11-23',
  title: {
    en: 'Lines and Inbox: Refresh in group info and the date while scrolling',
    es: 'Lines e Inbox: Actualizar en la info del grupo y la fecha al desplazarte',
    pt: 'Lines e Inbox: Atualizar nas informações do grupo e a data ao rolar',
  },
  items: [
    {
      product: 'groups',
      en: 'In a group\'s info, Refresh (which asks WhatsApp for the member list again) was a loose, indented button under the members. It is now a row like Add members and Invite via link, with its own icon. With the zerosoft chat style, the date that stays at the top while you scroll now has a background, so it no longer runs over the text of the messages below it, in Lines and Inbox. The icons of Add members and Invite via link were black on black in light mode with that style; they show now.',
      es: 'En la info de un grupo, Actualizar (que le vuelve a pedir la lista de miembros a WhatsApp) era un botón suelto y corrido debajo de los miembros. Ahora es una fila como Agregar miembros e Invitar con link, con su ícono. Con el estilo de chats zerosoft, la fecha que queda arriba mientras te desplazás ahora tiene fondo y ya no se encima con el texto de los mensajes, en Lines y en Inbox. Los íconos de Agregar miembros e Invitar con link quedaban negros sobre negro en modo claro con ese estilo; ahora se ven.',
      pt: 'Nas informações de um grupo, Atualizar (que pede de novo a lista de membros ao WhatsApp) era um botão solto e deslocado embaixo dos membros. Agora é uma linha como Adicionar membros e Convidar por link, com seu ícone. Com o estilo de conversas zerosoft, a data que fica no topo enquanto você rola agora tem fundo e não se sobrepõe mais ao texto das mensagens, no Lines e no Inbox. Os ícones de Adicionar membros e Convidar por link ficavam pretos sobre preto no modo claro com esse estilo; agora aparecem.',
    },
  ],
} satisfies ChangelogEntry;
