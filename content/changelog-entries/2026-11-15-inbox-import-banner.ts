import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-inbox-import-banner',
  date: '2026-11-15',
  title: {
    en: 'Inbox: see how the import is going from the chat list',
    es: 'Inbox: el avance de la importación, arriba de la lista de chats',
    pt: 'Inbox: o andamento da importação, em cima da lista de chats',
  },
  items: [
    {
      product: 'inbox',
      en: 'While Inbox brings in your WhatsApp or Gmail history, the list shows how many chats are done with a progress bar, like in Lines. When it finishes you see the total and can close the notice. Before, this was only in Settings.',
      es: 'Mientras Inbox trae tu historial de WhatsApp o Gmail, la lista muestra cuántos chats van con una barra de avance, como en Lines. Al terminar ves el total y podés cerrar el aviso. Antes solo estaba en Ajustes.',
      pt: 'Enquanto o Inbox traz seu histórico do WhatsApp ou Gmail, a lista mostra quantos chats já foram com uma barra de progresso, como no Lines. Ao terminar você vê o total e pode fechar o aviso. Antes isso ficava só nas Configurações.',
    },
  ],
} satisfies ChangelogEntry;
