import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-wa-linkify-email',
  date: '2026-11-15',
  title: {
    en: 'Inbox and Lines: emails in messages are links',
    es: 'Inbox y Lines: los mails en los mensajes son links',
    pt: 'Inbox e Lines: e-mails nas mensagens viram links',
  },
  items: [
    {
      product: 'inbox',
      en: 'An email address in a WhatsApp message is highlighted and opens your mail app, as in WhatsApp. Links that start with www. work too.',
      es: 'Un mail en un mensaje de WhatsApp se ve resaltado y abre tu programa de correo, como en WhatsApp. Los links que empiezan con www. también.',
      pt: 'Um e-mail numa mensagem do WhatsApp fica destacado e abre seu app de e-mail, como no WhatsApp. Links que começam com www. também.',
    },
    { product: 'groups', en: 'The same in Lines.', es: 'Lo mismo en Lines.', pt: 'O mesmo no Lines.' },
  ],
} satisfies ChangelogEntry;
