import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-18-lines-numbers-table',
  date: '2026-11-18',
  title: {
    en: 'Lines: the Numbers table shows how each line is doing',
    es: 'Lines: la tabla de Números muestra cómo está cada línea',
    pt: 'Lines: a tabela de Números mostra como está cada linha',
  },
  items: [
    {
      product: 'groups',
      en: 'Settings › Numbers is now a table with the status of each line and since when it is in that status, when its last message came in or went out, and how many chats it has open. On a phone each line is a stacked card, with no sideways scroll.',
      es: 'Ajustes › Números ahora es una tabla con el estado de cada línea y desde cuándo está así, cuándo entró o salió su último mensaje y cuántos chats tiene abiertos. En el teléfono cada línea es una tarjeta apilada, sin scroll lateral.',
      pt: 'Configurações › Números agora é uma tabela com o status de cada linha e desde quando ela está assim, quando chegou ou saiu a última mensagem e quantas conversas estão abertas. No celular cada linha é um cartão empilhado, sem rolagem lateral.',
    },
  ],
} satisfies ChangelogEntry;
