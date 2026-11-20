import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-lines-block-contact',
  date: '2026-11-20',
  title: {
    en: 'Lines: block a contact on WhatsApp',
    es: 'Lines: bloquear un contacto en WhatsApp',
    pt: 'Lines: bloquear um contato no WhatsApp',
  },
  items: [
    {
      product: 'groups',
      en: 'The info panel of a one-to-one chat and the contact card of a group member now have "Block" and "Unblock", like WhatsApp. It blocks the person on the line\'s WhatsApp, after a confirmation. Lines numbers connected through Evolution support it.',
      es: 'El panel de info de un chat 1:1 y la ficha de una persona de un grupo ahora tienen "Bloquear" y "Desbloquear", como WhatsApp. Bloquea a la persona en el WhatsApp de la línea, después de confirmar. Lo permiten las líneas conectadas con Evolution.',
      pt: 'O painel de dados de uma conversa 1:1 e a ficha de uma pessoa de um grupo agora têm "Bloquear" e "Desbloquear", como o WhatsApp. Bloqueia a pessoa no WhatsApp da linha, depois de confirmar. As linhas conectadas pelo Evolution permitem isso.',
    },
  ],
} satisfies ChangelogEntry;
