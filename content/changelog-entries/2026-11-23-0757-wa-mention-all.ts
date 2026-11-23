import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-23-wa-mention-all',
  date: '2026-11-23',
  title: {
    en: 'Lines and Inbox: @all in WhatsApp groups',
    es: 'Lines e Inbox: @todos en grupos de WhatsApp',
    pt: 'Lines e Inbox: @todos em grupos do WhatsApp',
  },
  items: [
    {
      product: 'groups',
      en: 'Type @ in a WhatsApp group and Everyone comes first in the list. Picking it writes @all, and every member of the group gets the mention notification on their phone. It also works in captions and in scheduled and recurring messages to one group. Lines connected with the Cloud API have no groups, so the option does not show there. Internal notes still mention only teammates.',
      es: 'Escribí @ en un grupo de WhatsApp y Todos aparece primero en la lista. Al elegirlo se escribe @todos (también vale @all) y a cada miembro del grupo le llega el aviso de la mención en el teléfono. También funciona en el pie de fotos, videos y documentos, y en mensajes programados y recurrentes a un solo grupo. Las líneas conectadas con la Cloud API no tienen grupos, así que ahí no aparece. Las notas internas siguen mencionando solo al equipo.',
      pt: 'Digite @ em um grupo do WhatsApp e Todos aparece primeiro na lista. Ao escolher, escreve @todos (@all também vale) e cada membro do grupo recebe o aviso da menção no celular. Também funciona na legenda de fotos, vídeos e documentos, e em mensagens agendadas e recorrentes para um só grupo. As linhas conectadas pela Cloud API não têm grupos, então ali não aparece. As notas internas continuam mencionando só a equipe.',
    },
    {
      product: 'inbox',
      en: 'In your WhatsApp groups, @ also offers Everyone first: it writes @all and notifies every member, in messages, captions and messages sent later.',
      es: 'En tus grupos de WhatsApp, @ también ofrece Todos primero: escribe @todos y le avisa a cada miembro, en mensajes, pies de foto y mensajes programados.',
      pt: 'Nos seus grupos do WhatsApp, @ também oferece Todos primeiro: escreve @todos e avisa cada membro, em mensagens, legendas e mensagens agendadas.',
    },
  ],
} satisfies ChangelogEntry;
