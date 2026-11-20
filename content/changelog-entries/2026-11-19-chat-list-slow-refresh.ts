import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-19-chat-list-slow-refresh',
  date: '2026-11-19',
  title: {
    en: 'Inbox and Lines: the chat list keeps up on a slow connection',
    es: 'Inbox y Lines: la lista de chats se mantiene al día con una conexión lenta',
    pt: 'Inbox e Lines: a lista de conversas se mantém em dia com uma conexão lenta',
  },
  items: [
    {
      product: 'inbox',
      en: 'The chat list reads itself again every few seconds and on every live update, and each read used to cancel the one still on its way. When the server or the connection was slow, no read ever finished, so new chats, unread counts and the import notice stopped arriving. A read of the same list now waits for the one in progress, and reads once more when it ends if something changed meanwhile. Switching folder, filter or search still cancels the previous read.',
      es: 'La lista de chats se vuelve a leer cada pocos segundos y con cada aviso en vivo, y cada lectura cortaba a la que todavía venía en camino. Con el servidor o la conexión lentos ninguna terminaba, así que dejaban de llegar los chats nuevos, los no leídos y el aviso de importación. Ahora una lectura de la misma lista espera a la que está en curso, y al terminar lee una vez más si algo cambió mientras tanto. Cambiar de carpeta, filtro o búsqueda sigue cortando la lectura anterior.',
      pt: 'A lista de conversas é lida de novo a cada poucos segundos e a cada aviso ao vivo, e cada leitura cancelava a que ainda estava a caminho. Com o servidor ou a conexão lentos nenhuma terminava, então pararam de chegar as conversas novas, as não lidas e o aviso de importação. Agora uma leitura da mesma lista espera a que está em andamento e, ao terminar, lê mais uma vez se algo mudou nesse meio-tempo. Trocar de pasta, filtro ou busca continua cancelando a leitura anterior.',
    },
  ],
} satisfies ChangelogEntry;
