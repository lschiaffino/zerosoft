import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-lines-hubspot-workflow-send',
  date: '2026-11-20',
  title: {
    en: 'Lines: send WhatsApp from a HubSpot workflow',
    es: 'Lines: mandar WhatsApp desde un workflow de HubSpot',
    pt: 'Lines: enviar WhatsApp a partir de um workflow do HubSpot',
  },
  items: [
    {
      product: 'groups',
      en: 'A "Send a webhook" action in a HubSpot workflow can now send a WhatsApp message through Lines: POST to /api/v1/groups/hubspot/send with a zerosoft API key. The message goes to the chats and groups linked to that HubSpot company, deal or contact, or to the one-to-one chat with the contact\'s phone, and can include the record\'s properties. If HubSpot retries the webhook, the message is not sent twice.',
      es: 'Una acción "Send a webhook" en un workflow de HubSpot ahora puede mandar un WhatsApp por Lines: POST a /api/v1/groups/hubspot/send con una API key de zerosoft. El mensaje va a los chats y grupos vinculados a esa empresa, negocio o contacto de HubSpot, o al chat 1:1 con el teléfono del contacto, y puede llevar las propiedades del registro. Si HubSpot reintenta el webhook, el mensaje no sale dos veces.',
      pt: 'Uma ação "Send a webhook" num workflow do HubSpot agora pode enviar um WhatsApp pelo Lines: POST em /api/v1/groups/hubspot/send com uma API key do zerosoft. A mensagem vai para os chats e grupos vinculados àquela empresa, negócio ou contato do HubSpot, ou para o chat 1:1 com o telefone do contato, e pode levar as propriedades do registro. Se o HubSpot repetir o webhook, a mensagem não sai duas vezes.',
    },
  ],
} satisfies ChangelogEntry;
