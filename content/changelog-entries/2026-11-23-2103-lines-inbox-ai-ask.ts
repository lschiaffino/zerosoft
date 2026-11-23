import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-23-lines-inbox-ai-ask',
  date: '2026-11-23',
  title: {
    en: 'Lines and Inbox: an AI tab in the chat panel',
    es: 'Lines e Inbox: una pestaña IA en el panel del chat',
    pt: 'Lines e Inbox: uma aba IA no painel da conversa',
  },
  items: [
    {
      product: 'groups',
      en: 'The chat panel has an AI tab. Ask about the chat ("what did the customer ask for?", "what is still pending?") and the answer uses only the messages you can see; if you see phone numbers hidden, the AI gets them hidden too. Analyze chat gives the sentiment (positive, neutral or negative) with a short reason and proposes tasks or tickets. You edit the title, choose task or ticket and create each one, or dismiss it. Nothing is created until you approve it. Tasks show in the Tasks tab and in CRM › Tasks; tickets in Tickets.',
      es: 'El panel del chat tiene una pestaña IA. Preguntá sobre el chat ("¿qué pidió el cliente?", "¿qué quedó pendiente?") y la respuesta usa solo los mensajes que ves; si ves los teléfonos ocultos, a la IA también le llegan ocultos. Analizar el chat da el sentimiento (positivo, neutral o negativo) con un motivo corto y propone tareas o tickets. Editás el título, elegís tarea o ticket y creás cada una, o la descartás. No se crea nada hasta que lo aprobás. Las tareas aparecen en la pestaña Tareas y en CRM › Tareas; los tickets, en Tickets.',
      pt: 'O painel da conversa tem uma aba IA. Pergunte sobre a conversa ("o que o cliente pediu?", "o que ficou pendente?") e a resposta usa só as mensagens que você vê; se você vê os telefones ocultos, a IA também os recebe ocultos. Analisar a conversa dá o sentimento (positivo, neutro ou negativo) com um motivo curto e propõe tarefas ou tickets. Você edita o título, escolhe tarefa ou ticket e cria cada uma, ou descarta. Nada é criado até você aprovar. As tarefas aparecem na aba Tarefas e em CRM › Tarefas; os tickets, em Tickets.',
    },
    {
      product: 'inbox',
      en: 'The contact and group info has the same AI tab: questions about the chat, its sentiment and proposed tasks. An approved task goes to CRM › Tasks, assigned to you, when you use the CRM.',
      es: 'La info del contacto y del grupo tiene la misma pestaña IA: preguntas sobre el chat, su sentimiento y tareas propuestas. Una tarea aprobada va a CRM › Tareas, a tu nombre, si usás el CRM.',
      pt: 'Os dados do contato e do grupo têm a mesma aba IA: perguntas sobre a conversa, o sentimento e tarefas propostas. Uma tarefa aprovada vai para CRM › Tarefas, atribuída a você, se você usa o CRM.',
    },
  ],
} satisfies ChangelogEntry;
