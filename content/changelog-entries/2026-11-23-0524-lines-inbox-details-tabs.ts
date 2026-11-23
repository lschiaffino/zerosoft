import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-23-lines-inbox-details-tabs',
  date: '2026-11-23',
  title: {
    en: 'Lines and Inbox: chat details in tabs',
    es: 'Lines e Inbox: los detalles del chat en pestañas',
    pt: 'Lines e Inbox: os detalhes da conversa em abas',
  },
  items: [
    {
      product: 'groups',
      en: 'The panel next to a chat now has tabs, like Periskope: Info, Members (groups), Files, Notes, Tasks and CRM. Files has the photos, videos, documents and links of the chat and its starred messages. Notes lists the internal notes of the chat, newest first; a click takes you to the note. Tasks has the tasks, tickets and scheduled messages. CRM has the linked CRM contact and company, their deals with stage and amount (only the ones you can see in the CRM) and HubSpot. Your last tab stays open next time. Move between tabs with the arrow keys, Home and End. On a phone the panel takes the whole screen.',
      es: 'El panel al lado de un chat ahora tiene pestañas, como Periskope: Info, Miembros (grupos), Archivos, Notas, Tareas y CRM. Archivos tiene las fotos, videos, documentos y links del chat y sus destacados. Notas muestra las notas internas del chat, las últimas primero; un toque te lleva a la nota. Tareas tiene las tareas, los tickets y los mensajes programados. CRM tiene el contacto y la empresa del CRM vinculados, sus negocios con etapa y monto (solo los que ves en el CRM) y HubSpot. La última pestaña que usaste queda abierta la próxima vez. Pasá de una a otra con las flechas, Inicio y Fin. En el teléfono el panel ocupa toda la pantalla.',
      pt: 'O painel ao lado de uma conversa agora tem abas, como o Periskope: Info, Membros (grupos), Arquivos, Notas, Tarefas e CRM. Arquivos tem as fotos, vídeos, documentos e links da conversa e as mensagens favoritas. Notas mostra as notas internas da conversa, as mais novas primeiro; um toque leva à nota. Tarefas tem as tarefas, os tickets e as mensagens agendadas. CRM tem o contato e a empresa do CRM vinculados, seus negócios com etapa e valor (só os que você vê no CRM) e o HubSpot. A última aba usada fica aberta na próxima vez. Passe de uma a outra com as setas, Home e End. No celular o painel ocupa a tela inteira.',
    },
    {
      product: 'inbox',
      en: 'The contact and group info has the same tabs: Info, Members (groups), Files, Notes and CRM (HubSpot, one on one chats). Notes is where your notes about the chat live now (only you see them); the Notes button in the chat header opens that tab.',
      es: 'La info del contacto y del grupo tiene las mismas pestañas: Info, Miembros (grupos), Archivos, Notas y CRM (HubSpot, chats 1:1). Tus notas del chat (solo las ves vos) ahora están en Notas; el botón Notas del encabezado del chat abre esa pestaña.',
      pt: 'Os dados do contato e do grupo têm as mesmas abas: Info, Membros (grupos), Arquivos, Notas e CRM (HubSpot, conversas 1:1). Suas notas da conversa (só você vê) agora ficam em Notas; o botão Notas no cabeçalho da conversa abre essa aba.',
    },
  ],
} satisfies ChangelogEntry;
