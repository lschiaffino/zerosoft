import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-21-chat-search',
  date: '2026-11-21',
  title: {
    en: 'Lines and Inbox: search messages inside a chat',
    es: 'Lines e Inbox: buscar mensajes dentro de un chat',
    pt: 'Lines e Inbox: pesquisar mensagens dentro de uma conversa',
  },
  items: [
    {
      product: 'groups',
      en: 'The magnifier in the chat header (or Ctrl+Shift+F) opens Search messages, like in WhatsApp Web. It searches that chat on every line it is on, newest first, with the date, who wrote it and the match marked. A click takes you to the message, also when it is older than what is loaded. Esc closes it.',
      es: 'La lupa de la cabecera del chat (o Ctrl+Mayús+F) abre Buscar mensajes, como en WhatsApp Web. Busca en ese chat en todas las líneas donde está, lo más nuevo primero, con la fecha, quién lo escribió y lo encontrado marcado. Un clic te lleva al mensaje, también cuando es más viejo que lo cargado. Esc lo cierra.',
      pt: 'A lupa do cabeçalho da conversa (ou Ctrl+Shift+F) abre Pesquisar mensagens, como no WhatsApp Web. Pesquisa nessa conversa em todas as linhas onde ela está, das mais novas às mais antigas, com a data, quem escreveu e o trecho encontrado marcado. Um clique leva à mensagem, também quando ela é mais antiga do que o que está carregado. Esc fecha.',
    },
    {
      product: 'inbox',
      en: 'Search messages inside a WhatsApp chat from the magnifier in its header, the same panel as in Lines, including the same chat on your other accounts.',
      es: 'Buscá mensajes dentro de un chat de WhatsApp con la lupa de su cabecera, el mismo panel que en Lines, también en el mismo chat de tus otras cuentas.',
      pt: 'Pesquise mensagens dentro de uma conversa do WhatsApp pela lupa do cabeçalho, o mesmo painel do Lines, também na mesma conversa das suas outras contas.',
    },
  ],
} satisfies ChangelogEntry;
