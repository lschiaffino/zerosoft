import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-18-lines-line-colors',
  date: '2026-11-18',
  title: {
    en: 'Lines: a color for each line',
    es: 'Lines: un color para cada línea',
    pt: 'Lines: uma cor para cada linha',
  },
  items: [
    {
      product: 'groups',
      en: 'In Settings › Numbers you can give each line a color. The chat list shows a dot in that color next to the chat name, one per line when a chat is on several of your lines, so you see where a chat came in without opening it. The line selector and Reply from show the same dot.',
      es: 'En Ajustes › Números podés darle un color a cada línea. La lista de chats muestra un punto de ese color al lado del nombre del chat, uno por línea cuando el chat está en varias de tus líneas, así ves por dónde entró sin abrirlo. El selector de línea y Responder desde muestran el mismo punto.',
      pt: 'Em Configurações › Números você pode dar uma cor a cada linha. A lista de conversas mostra um ponto dessa cor ao lado do nome da conversa, um por linha quando a conversa está em várias das suas linhas, assim você vê por onde ela chegou sem abrir. O seletor de linha e Responder de mostram o mesmo ponto.',
    },
  ],
} satisfies ChangelogEntry;
