import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-28-lines-inbox-ai-ask',
  date: '2026-11-28',
  title: {
    en: 'Lines and Inbox: ask the AI about a chat and approve proposed follow-ups',
    es: 'Lines e Inbox: preguntale a la IA sobre un chat y aprobá los seguimientos propuestos',
    pt: 'Lines e Inbox: pergunte à IA sobre uma conversa e aprove os acompanhamentos propostos',
  },
  items: [
    {
      product: 'groups',
      en: 'The AI tab of the chat panel lets you ask about the chat ("what did the customer ask for?", "what is still pending?"), with three suggested questions. The answer uses only the latest messages you can see, with hidden phones kept hidden, and is not saved. Each summary also proposes follow-ups, without phone numbers: edit the title (and a task\'s notes), pick task or ticket and press Create, or dismiss it. Nothing is created until you approve it. Tasks show in the chat\'s Tasks tab and in CRM › Tasks; tickets in Tickets.',
      es: 'La pestaña IA del panel del chat te deja preguntar sobre el chat ("¿qué pidió el cliente?", "¿qué quedó pendiente?"), con tres preguntas sugeridas. La respuesta usa solo los últimos mensajes que ves, con los teléfonos ocultos si los ves ocultos, y no se guarda. Cada resumen también propone seguimientos, sin teléfonos: editá el título (y las notas de una tarea), elegí tarea o ticket y tocá Crear, o descartalo. No se crea nada hasta que lo aprobás. Las tareas aparecen en la pestaña Tareas del chat y en CRM › Tareas; los tickets, en Tickets.',
      pt: 'A aba IA do painel da conversa deixa você perguntar sobre a conversa ("o que o cliente pediu?", "o que ficou pendente?"), com três perguntas sugeridas. A resposta usa só as últimas mensagens que você vê, com os telefones ocultos se você os vê ocultos, e não é salva. Cada resumo também propõe acompanhamentos, sem telefones: edite o título (e as notas de uma tarefa), escolha tarefa ou ticket e toque em Criar, ou descarte. Nada é criado até você aprovar. As tarefas aparecem na aba Tarefas da conversa e em CRM › Tarefas; os tickets, em Tickets.',
    },
    {
      product: 'inbox',
      en: 'WhatsApp chats get the same questions and proposed follow-ups in the AI tab. You can edit the title and notes first; an approved follow-up goes to CRM › Tasks, assigned to you, and is seen by whoever can see your CRM tasks. If you don\'t use the CRM, the tab says so and offers nothing to create.',
      es: 'Los chats de WhatsApp tienen las mismas preguntas y seguimientos propuestos en la pestaña IA. Podés editar el título y las notas antes; un seguimiento aprobado va a CRM › Tareas, a tu nombre, y lo ve quien pueda ver tus tareas del CRM. Si no usás el CRM, la pestaña lo dice y no ofrece crear nada.',
      pt: 'As conversas do WhatsApp têm as mesmas perguntas e acompanhamentos propostos na aba IA. Você pode editar o título e as notas antes; um acompanhamento aprovado vai para CRM › Tarefas, atribuído a você, e quem pode ver as suas tarefas do CRM o vê. Se você não usa o CRM, a aba avisa e não oferece criar nada.',
    },
  ],
} satisfies ChangelogEntry;
