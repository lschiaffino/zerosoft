import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-fleet-inbox-lines',
  date: '2026-11-15',
  title: {
    en: 'Fleet in Inbox and Lines, and a WhatsApp message when an agent needs you',
    es: 'Fleet en Inbox y Lines, y un WhatsApp cuando un agente te necesita',
    pt: 'Fleet no Inbox e no Lines, e um WhatsApp quando um agente precisa de você',
  },
  items: [
    {
      product: 'fleet',
      en: 'In Fleet settings you can add an Agents row at the top of the chat list in Inbox and in Lines, with unread messages and agents waiting for you. It opens your agent conversations inside that app.',
      es: 'En los ajustes de Fleet podés sumar una fila Agentes arriba de la lista de chats de Inbox y de Lines, con los mensajes sin leer y los agentes que te esperan. Abre las conversaciones con tus agentes dentro de esa app.',
      pt: 'Nas configurações do Fleet você pode adicionar uma linha Agentes no topo da lista de conversas do Inbox e do Lines, com as mensagens não lidas e os agentes que esperam você. Ela abre as conversas com seus agentes dentro desse app.',
    },
    {
      product: 'fleet',
      en: 'Fleet can send a WhatsApp message to yourself, through the WhatsApp you connected in Inbox, when an agent finishes, waits for you or fails. It only goes to your own chat. Reply quoting it and your answer goes to that agent\'s queue.',
      es: 'Fleet puede mandarte un WhatsApp a vos mismo, con el WhatsApp que conectaste en Inbox, cuando un agente termina, te espera o falla. Va solo a tu propio chat. Respondelo citándolo y tu respuesta va a la cola de ese agente.',
      pt: 'O Fleet pode mandar um WhatsApp para você mesmo, com o WhatsApp que você conectou no Inbox, quando um agente termina, espera você ou falha. Ele vai só para a sua própria conversa. Responda citando e sua resposta vai para a fila desse agente.',
    },
  ],
} satisfies ChangelogEntry;
