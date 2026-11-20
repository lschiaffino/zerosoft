import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-0026-group-members-admins',
  date: '2026-11-20',
  title: {
    en: 'Inbox and Lines: add members and change group admins from the group info',
    es: 'Inbox y Lines: agregar miembros y cambiar admins desde la info del grupo',
    pt: 'Inbox e Lines: adicionar membros e mudar admins pelos dados do grupo',
  },
  items: [
    {
      product: 'groups',
      en: 'In Lines the members of a group were at the bottom of the chat details, under labels, CRM and the agent, and adding someone was a bare phone field. Members now sits right under the description, like in WhatsApp: Add members opens a picker where you search the line contacts or type numbers and add several people at once, Invite via link copies the link, and each member has a visible menu to make or dismiss a group admin, remove them or message them. When the line is not an admin of the group, these actions show disabled with the reason. If WhatsApp refuses someone, for example because of their privacy settings, the reason shows next to their name and you can send them the invite link.',
      es: 'En Lines los miembros de un grupo estaban al final de los detalles del chat, debajo de etiquetas, CRM y el agente, y agregar a alguien era un campo de teléfono suelto. Ahora Miembros está justo debajo de la descripción, como en WhatsApp: Agregar miembros abre un buscador de los contactos de la línea donde también podés escribir números y sumar a varias personas a la vez, Invitar con link copia el link, y cada miembro tiene un menú visible para hacerlo admin o quitarle el admin, sacarlo del grupo o mandarle un mensaje. Si la línea no es admin del grupo, esas acciones se ven deshabilitadas con el motivo. Si WhatsApp rechaza a alguien, por ejemplo por su privacidad, el motivo aparece junto a su nombre y le podés mandar el link de invitación.',
      pt: 'No Lines os membros de um grupo ficavam no fim dos detalhes da conversa, abaixo de etiquetas, CRM e o agente, e adicionar alguém era um campo de telefone solto. Agora Membros fica logo abaixo da descrição, como no WhatsApp: Adicionar membros abre uma busca nos contatos da linha onde você também pode digitar números e adicionar várias pessoas de uma vez, Convidar via link copia o link, e cada membro tem um menu visível para torná-lo admin ou tirar o admin, removê-lo do grupo ou mandar mensagem. Se a linha não é admin do grupo, essas ações aparecem desabilitadas com o motivo. Se o WhatsApp recusa alguém, por exemplo pela privacidade, o motivo aparece ao lado do nome e você pode enviar o link de convite.',
    },
    {
      product: 'inbox',
      en: 'The info of a WhatsApp group in Inbox only listed its members. It now has the same Add members, Invite via link and member menu (make or dismiss admin, remove, message), using your linked WhatsApp. If your number is not an admin of the group, the actions show disabled with the reason.',
      es: 'La info de un grupo de WhatsApp en Inbox solo listaba a sus integrantes. Ahora tiene el mismo Agregar miembros, Invitar con link y el menú de cada miembro (hacerlo admin o quitarle el admin, sacarlo, mandarle un mensaje), con tu WhatsApp vinculado. Si tu número no es admin del grupo, las acciones se ven deshabilitadas con el motivo.',
      pt: 'Os dados de um grupo de WhatsApp no Inbox só listavam os membros. Agora têm o mesmo Adicionar membros, Convidar via link e o menu de cada membro (tornar ou tirar admin, remover, mandar mensagem), com o seu WhatsApp vinculado. Se o seu número não é admin do grupo, as ações aparecem desabilitadas com o motivo.',
    },
  ],
} satisfies ChangelogEntry;
