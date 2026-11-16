import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-16-hubspot-contacts-panel',
  date: '2026-11-16',
  title: {
    en: 'Lines and Inbox: create HubSpot contacts from the chat, your own properties and a pinned panel',
    es: 'Lines e Inbox: crear contactos de HubSpot desde el chat, tus propiedades y un panel fijo',
    pt: 'Lines e Inbox: criar contatos do HubSpot pela conversa, suas propriedades e um painel fixo',
  },
  items: [
    {
      product: 'groups',
      en: 'A 1:1 chat creates its HubSpot contact with one button, in the chat details and in Contacts. The phone is looked up in HubSpot first, so a person who is already there gets linked instead of duplicated.',
      es: 'Un chat 1:1 crea su contacto en HubSpot con un botón, en los detalles del chat y en Contactos. Antes se busca el teléfono en HubSpot, así una persona que ya está se vincula en lugar de duplicarse.',
      pt: 'Uma conversa 1:1 cria o contato no HubSpot com um botão, nos detalhes da conversa e em Contatos. Antes o telefone é buscado no HubSpot, então uma pessoa que já está lá é vinculada em vez de duplicada.',
    },
    {
      product: 'groups',
      en: 'New setting in the HubSpot integration: create the contact when a new 1:1 chat comes in. It is off by default and covers chats that start after you turn it on.',
      es: 'Ajuste nuevo en la integración con HubSpot: crear el contacto cuando entra un chat 1:1 nuevo. Viene apagado y vale para los chats que empiezan después de prenderlo.',
      pt: 'Ajuste novo na integração com o HubSpot: criar o contato quando chega uma conversa 1:1 nova. Vem desligado e vale para as conversas que começam depois de ligar.',
    },
    {
      product: 'groups',
      en: 'Each person chooses which company properties they see in the chat details and at the top of the HubSpot panel. The panel can be pinned next to the conversation and follows the chat you open.',
      es: 'Cada persona elige qué propiedades de la empresa ve en los detalles del chat y arriba del panel de HubSpot. El panel se puede fijar al costado de la conversación y sigue al chat que abras.',
      pt: 'Cada pessoa escolhe quais propriedades da empresa vê nos detalhes da conversa e no topo do painel do HubSpot. O painel pode ficar fixo ao lado da conversa e acompanha a conversa que você abrir.',
    },
    {
      product: 'inbox',
      en: 'The same in Inbox: the info of a WhatsApp 1:1 chat shows its HubSpot contact and company, with a button to create the contact, your chosen properties and the HubSpot panel, which can stay pinned. In Inbox settings you can have new 1:1 chats create their contact.',
      es: 'Lo mismo en Inbox: la info de un chat 1:1 de WhatsApp muestra su contacto y su empresa de HubSpot, con un botón para crear el contacto, tus propiedades elegidas y el panel de HubSpot, que puede quedar fijo. En los ajustes de Inbox podés hacer que los chats 1:1 nuevos creen su contacto.',
      pt: 'O mesmo no Inbox: as informações de uma conversa 1:1 de WhatsApp mostram o contato e a empresa no HubSpot, com um botão para criar o contato, as propriedades que você escolheu e o painel do HubSpot, que pode ficar fixo. Nos ajustes do Inbox dá para fazer as conversas 1:1 novas criarem o contato.',
    },
  ],
} satisfies ChangelogEntry;
