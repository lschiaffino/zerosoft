import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-23-assistant-chat-actions',
  date: '2026-11-23',
  title: {
    en: 'Assistant: act on Lines and Inbox chats with your approval',
    es: 'Asistente: actuar sobre los chats de Lines e Inbox con tu aprobación',
    pt: 'Assistente: agir nas conversas do Lines e do Inbox com a sua aprovação',
  },
  items: [
    {
      product: 'groups',
      en: 'Ask the assistant (⌘J) to find a Lines chat, draft a reply, assign it, add a label, close or archive it, add an internal note, create a task or a ticket, or schedule a WhatsApp message. Each change comes as a card that shows what, where and the text, and nothing happens until you click Confirm. A draft goes to the message field of the chat and is never sent. A scheduled message needs the red button and never goes out right away. It only finds and changes chats you can see.',
      es: 'Pedile al asistente (⌘J) que encuentre un chat de Lines, escriba un borrador, lo asigne, le sume una etiqueta, lo cierre o lo archive, deje una nota interna, cree una tarea o un ticket, o programe un mensaje de WhatsApp. Cada cambio llega en una tarjeta que dice qué, dónde y el texto, y no pasa nada hasta que hacés clic en Confirmar. Un borrador va al campo del mensaje del chat y nunca se manda. Un programado se confirma con el botón rojo y nunca sale en el acto. Solo encuentra y cambia chats que ves.',
      pt: 'Peça ao assistente (⌘J) para encontrar uma conversa do Lines, escrever um rascunho, atribuí-la, adicionar uma etiqueta, fechá-la ou arquivá-la, deixar uma nota interna, criar uma tarefa ou um ticket, ou agendar uma mensagem de WhatsApp. Cada mudança chega num cartão que mostra o quê, onde e o texto, e nada acontece até você clicar em Confirmar. Um rascunho vai para o campo da mensagem da conversa e nunca é enviado. Uma mensagem agendada pede o botão vermelho e nunca sai na hora. Ele só encontra e muda conversas que você vê.',
    },
    {
      product: 'inbox',
      en: 'In Inbox the assistant can also find a chat, add a note to it and schedule a message, with the same card and Confirm.',
      es: 'En Inbox el asistente también puede encontrar un chat, sumarle una nota y programar un mensaje, con la misma tarjeta y Confirmar.',
      pt: 'No Inbox o assistente também pode encontrar uma conversa, adicionar uma nota e agendar uma mensagem, com o mesmo cartão e Confirmar.',
    },
    {
      product: 'groups',
      en: 'Fix: a chat waiting for a reply past your workspace\'s limit now always shows up as overdue, even when many chats in other workspaces are waiting under a longer limit.',
      es: 'Arreglo: un chat que espera respuesta más que el límite de tu workspace ahora siempre aparece como vencido, aunque haya muchos chats esperando en otros workspaces con un límite más largo.',
      pt: 'Correção: uma conversa esperando resposta além do limite do seu workspace agora sempre aparece como atrasada, mesmo quando muitas conversas de outros workspaces esperam com um limite maior.',
    },
  ],
} satisfies ChangelogEntry;
