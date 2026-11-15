import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-assistant-one-scroll',
  date: '2026-11-15',
  title: {
    en: 'Assistant: one scroll for the whole chat',
    es: 'Asistente: un solo scroll para toda la charla',
    pt: 'Assistente: uma só rolagem para toda a conversa',
  },
  items: [
    {
      product: 'platform',
      en: 'The Assistant page now fills the window like Inbox and Lines: a compact header above the chat history, the conversation as the only scroll and the message box always at the bottom. Long lists and tables in a reply, like the new folders or the chats it could not find in a folders plan, show the first 8 rows and a Show all button that opens them in place, with no inner scroll. Confirm and Cancel stay visible at the bottom while you read a long card. If you scroll up while a reply is arriving, the chat stays put and a Jump to latest button takes you back. On a phone, a Chats button switches between the history and the chat.',
      es: 'La página del Asistente ahora ocupa la ventana como Inbox y Lines: una cabecera compacta arriba del historial, la charla como único scroll y el campo para escribir siempre abajo. Las listas y tablas largas de una respuesta, como las carpetas nuevas o los chats que no encontró en un plan de carpetas, muestran los primeros 8 renglones y un botón Mostrar las N que las abre en el lugar, sin scroll interno. Confirmar y Cancelar quedan a la vista abajo mientras leés una tarjeta larga. Si subís mientras llega una respuesta, la charla no se mueve y un botón Ir al final te lleva de vuelta. En el teléfono, un botón Charlas pasa del historial a la charla.',
      pt: 'A página do Assistente agora ocupa a janela como o Inbox e o Lines: um cabeçalho compacto acima do histórico, a conversa como única rolagem e o campo de mensagem sempre embaixo. Listas e tabelas longas de uma resposta, como as pastas novas ou as conversas que ele não encontrou num plano de pastas, mostram as primeiras 8 linhas e um botão Mostrar todas que as abre no lugar, sem rolagem interna. Confirmar e Cancelar ficam visíveis embaixo enquanto você lê um cartão longo. Se você sobe enquanto chega uma resposta, a conversa não se mexe e um botão Ir para o fim leva você de volta. No celular, um botão Conversas alterna entre o histórico e a conversa.',
    },
  ],
} satisfies ChangelogEntry;
