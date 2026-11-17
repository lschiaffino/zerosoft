import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-17-analytics-no-message-text',
  date: '2026-11-17',
  title: {
    en: 'Analytics no longer reads the text of Lines messages',
    es: 'Analytics ya no lee el texto de los mensajes de Lines',
    pt: 'O Analytics não lê mais o texto das mensagens do Lines',
  },
  items: [
    {
      product: 'analytics',
      en: 'The messages table in Analytics keeps the chat, direction, sender, type, status and date of each Lines message, without its text. Questions that used the body column need to drop it.',
      es: 'La tabla messages de Analytics sigue teniendo el chat, la dirección, quién lo mandó, el tipo, el estado y la fecha de cada mensaje de Lines, sin el texto. Las preguntas que usaban la columna body tienen que sacarla.',
      pt: 'A tabela messages do Analytics continua com a conversa, a direção, quem enviou, o tipo, o status e a data de cada mensagem do Lines, sem o texto. As perguntas que usavam a coluna body precisam removê-la.',
    },
  ],
} satisfies ChangelogEntry;
