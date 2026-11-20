import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-starred-chat-info',
  date: '2026-11-20',
  title: {
    en: 'Lines and Inbox: starred messages in the chat info take you to the message',
    es: 'Lines e Inbox: los destacados de la info del chat llevan al mensaje',
    pt: 'Lines e Inbox: as favoritas nos dados da conversa levam à mensagem',
  },
  items: [
    {
      product: 'groups',
      en: 'The info panel of a chat now lists its starred messages, like WhatsApp. Click one to go to it in the conversation. Star in the selection bar now unstars when every selected message is already starred.',
      es: 'El panel de info de un chat ahora lista sus mensajes destacados, como WhatsApp. Un clic lleva al mensaje en la conversación. Destacar en la barra de selección ahora los saca cuando todos los elegidos ya estaban destacados.',
      pt: 'O painel de dados de uma conversa agora lista as mensagens favoritas, como o WhatsApp. Um clique leva à mensagem na conversa. Favoritar na barra de seleção agora desfaz quando todas as escolhidas já eram favoritas.',
    },
    {
      product: 'inbox',
      en: 'Starred messages in the contact or group info are now clickable: the chat opens around that message and highlights it, even if it is older than what is loaded.',
      es: 'Los mensajes destacados en la info del contacto o del grupo ahora se pueden tocar: el chat se abre alrededor de ese mensaje y lo marca, aunque sea más viejo que lo cargado.',
      pt: 'As mensagens favoritas nos dados do contato ou do grupo agora são clicáveis: a conversa abre em volta dessa mensagem e a destaca, mesmo que seja mais antiga que o carregado.',
    },
  ],
} satisfies ChangelogEntry;
