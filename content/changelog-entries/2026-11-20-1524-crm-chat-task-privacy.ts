import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-1524-crm-chat-task-privacy',
  date: '2026-11-20',
  title: {
    en: 'CRM: tasks created from a Lines chat show their text only to people who can see that chat',
    es: 'CRM: las tareas creadas desde un chat de Lines muestran su texto solo a quien ve ese chat',
    pt: 'CRM: tarefas criadas a partir de um chat do Lines mostram o texto só para quem vê esse chat',
  },
  items: [
    {
      product: 'crm',
      en: 'A task created from a Lines chat could carry the chat name or the message text in its title and notes, and anyone with access to the CRM could read them. Now someone who cannot see that chat sees "Task from a Lines chat" with no notes, in the task list, the timeline, the task page, the overview, dashboards, search, exports, the API and the assistant. They can still complete it, reschedule it or reassign it, but they cannot rewrite text they cannot see. Nothing is deleted: people who can see the chat read the task as before.',
      es: 'Una tarea creada desde un chat de Lines podía llevar el nombre del chat o el texto del mensaje en su título y sus notas, y cualquiera con acceso al CRM los leía. Ahora quien no ve ese chat ve "Tarea de un chat de Lines" sin notas, en la lista de tareas, el timeline, la página de la tarea, el resumen, los dashboards, la búsqueda, los exports, la API y el asistente. Puede completarla, moverla o reasignarla, pero no reescribir un texto que no ve. No se borra nada: quien ve el chat lee la tarea como antes.',
      pt: 'Uma tarefa criada a partir de um chat do Lines podia levar o nome do chat ou o texto da mensagem no título e nas notas, e qualquer pessoa com acesso ao CRM os lia. Agora quem não vê esse chat vê "Tarefa de um chat do Lines" sem notas, na lista de tarefas, na linha do tempo, na página da tarefa, no resumo, nos dashboards, na busca, nas exportações, na API e no assistente. Pode concluí-la, reagendá-la ou reatribuí-la, mas não reescrever um texto que não vê. Nada é apagado: quem vê o chat lê a tarefa como antes.',
    },
  ],
} satisfies ChangelogEntry;
