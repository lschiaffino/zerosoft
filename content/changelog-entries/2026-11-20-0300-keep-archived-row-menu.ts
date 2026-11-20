import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-keep-archived-row-menu',
  date: '2026-11-20',
  title: {
    en: 'Inbox and Lines: "Keep archived" from the right-click menu',
    es: 'Inbox y Lines: "Mantener archivado" desde el clic derecho',
    pt: 'Inbox e Lines: "Manter arquivada" pelo clique direito',
  },
  items: [
    {
      product: 'inbox',
      en: 'Right-clicking an archived chat in the list now offers "Keep archived" (or "Stop keeping archived"), the same switch as in the chat\'s info panel, without opening the chat.',
      es: 'El clic derecho sobre un chat archivado de la lista ahora ofrece "Mantener archivado" (o "Dejar de mantener archivado"), la misma llave del panel de info del chat, sin abrirlo.',
      pt: 'O clique direito numa conversa arquivada da lista agora oferece "Manter arquivada" (ou "Deixar de manter arquivada"), a mesma chave do painel de dados da conversa, sem abri-la.',
    },
  ],
} satisfies ChangelogEntry;
