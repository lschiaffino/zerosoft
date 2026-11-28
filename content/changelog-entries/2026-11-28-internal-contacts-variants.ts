import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-28-internal-contacts-variants',
  date: '2026-11-28',
  title: {
    en: 'Internal contacts: the same number in any form, and WhatsApp private ids',
    es: 'Contactos internos: el mismo número de cualquier forma, y los ids privados de WhatsApp',
    pt: 'Contatos internos: o mesmo número de qualquer forma, e os ids privados do WhatsApp',
  },
  items: [
    {
      product: 'groups',
      en: 'A teammate marked as internal counts as internal whether the number was saved with or without the 9 (Argentina) or the 1 (Mexico), and also when WhatsApp shows them by their private id (lid) and the line\'s contacts tie it to their number. Marking the other form of a number replaces the earlier mark.',
      es: 'Una persona del equipo marcada como interna cuenta como interna aunque el número se haya guardado con o sin el 9 (Argentina) o el 1 (México), y también cuando WhatsApp la muestra con su id privado (lid) y los contactos de la línea lo unen a su número. Marcar la otra forma de un número reemplaza la marca anterior.',
      pt: 'Uma pessoa da equipe marcada como interna conta como interna mesmo que o número tenha sido salvo com ou sem o 9 (Argentina) ou o 1 (México), e também quando o WhatsApp a mostra pelo id privado (lid) e os contatos da linha o ligam ao número dela. Marcar a outra forma de um número substitui a marca anterior.',
    },
    {
      product: 'inbox',
      en: 'The same in Inbox, and the assistant no longer lists chats with internal contacts as waiting for your reply.',
      es: 'Lo mismo en Inbox, y el asistente ya no cuenta los chats con contactos internos como esperando tu respuesta.',
      pt: 'O mesmo no Inbox, e o assistente não conta mais as conversas com contatos internos como esperando sua resposta.',
    },
  ],
} satisfies ChangelogEntry;
