import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-17-hubspot-contact-deal-props',
  date: '2026-11-17',
  title: {
    en: 'Lines and Inbox: HubSpot contact and deal properties',
    es: 'Lines e Inbox: propiedades del contacto y del negocio de HubSpot',
    pt: 'Lines e Inbox: propriedades do contato e do negócio do HubSpot',
  },
  items: [
    {
      product: 'groups',
      en: '"Choose properties" now has a tab for the company, the contact and the deal. Each person picks up to 12 of each to show in the chat details and at the top of the HubSpot panel, and admins set the workspace defaults in Settings > Integrations > HubSpot.',
      es: '"Elegir propiedades" ahora tiene una pestaña para la empresa, el contacto y el negocio. Cada persona elige hasta 12 de cada uno para ver en los detalles del chat y arriba del panel de HubSpot, y los admins eligen las del workspace en Ajustes > Integraciones > HubSpot.',
      pt: '"Escolher propriedades" agora tem uma aba para a empresa, o contato e o negócio. Cada pessoa escolhe até 12 de cada um para ver nos detalhes da conversa e no topo do painel do HubSpot, e os admins escolhem as do workspace em Ajustes > Integrações > HubSpot.',
    },
    {
      product: 'groups',
      en: 'The HubSpot panel of a chat shows every property of its linked contact and deal, custom ones too, and you can edit them there. The change goes to HubSpot right away. Editing needs the contacts or deals write scope on the private app.',
      es: 'El panel de HubSpot de un chat muestra todas las propiedades del contacto y del negocio vinculados, también las propias, y se pueden editar ahí. El cambio va a HubSpot en el momento. Para editar, la private app necesita el permiso de escritura de contactos o de negocios.',
      pt: 'O painel do HubSpot de uma conversa mostra todas as propriedades do contato e do negócio vinculados, também as personalizadas, e dá para editá-las ali. A mudança vai para o HubSpot na hora. Para editar, o private app precisa da permissão de escrita de contatos ou de negócios.',
    },
    {
      product: 'inbox',
      en: 'In Inbox, a WhatsApp 1:1 chat shows the HubSpot contact, its company and its deal with the properties you picked for each, and the HubSpot panel has a tab for each one.',
      es: 'En Inbox, un chat 1:1 de WhatsApp muestra el contacto de HubSpot, su empresa y su negocio con las propiedades que elegiste para cada uno, y el panel de HubSpot tiene una pestaña para cada uno.',
      pt: 'No Inbox, uma conversa 1:1 de WhatsApp mostra o contato do HubSpot, a empresa e o negócio dele com as propriedades que você escolheu para cada um, e o painel do HubSpot tem uma aba para cada um.',
    },
  ],
} satisfies ChangelogEntry;
