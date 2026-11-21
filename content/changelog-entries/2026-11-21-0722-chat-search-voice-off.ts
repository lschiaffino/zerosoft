import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-21-0722-chat-search-voice-off',
  date: '2026-11-21',
  title: {
    en: 'Search messages: the result count is no longer covered',
    es: 'Buscar mensajes: el conteo de resultados ya no queda tapado',
    pt: 'Pesquisar mensagens: a contagem de resultados não fica mais coberta',
  },
  items: [
    {
      product: 'groups',
      en: 'In Search messages inside a chat, the floating dictation microphone of the search field sat on top of the result count (on the phone it hid the number). The panel no longer shows it.',
      es: 'En Buscar mensajes dentro de un chat, el micrófono flotante de dictado del campo de búsqueda quedaba encima del conteo de resultados (en el teléfono tapaba el número). El panel ya no lo muestra.',
      pt: 'Em Pesquisar mensagens dentro de uma conversa, o microfone flutuante de ditado do campo de pesquisa ficava em cima da contagem de resultados (no celular cobria o número). O painel não o mostra mais.',
    },
    {
      product: 'inbox',
      en: 'The same in Inbox, which uses the same panel.',
      es: 'Lo mismo en Inbox, que usa el mismo panel.',
      pt: 'O mesmo no Inbox, que usa o mesmo painel.',
    },
  ],
} satisfies ChangelogEntry;
