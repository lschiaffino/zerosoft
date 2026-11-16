import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-wa-contacts',
  date: '2026-11-15',
  title: {
    en: 'Lines and Inbox: Contacts, each person once',
    es: 'Lines e Inbox: Contactos, cada persona una sola vez',
    pt: 'Lines e Inbox: Contatos, cada pessoa uma vez só',
  },
  items: [
    {
      product: 'groups',
      en: 'Lines has a Contacts section. Each person shows up once, even when they are on several lines, in groups and in a 1:1 chat, or write from their WhatsApp id instead of their phone. You see which lines and groups they are in and when they last wrote, and filter by line, by chat and by HubSpot.',
      es: 'Lines tiene una sección Contactos. Cada persona aparece una sola vez, aunque esté en varias líneas, en grupos y en un chat 1:1, o escriba con su id de WhatsApp en lugar del teléfono. Se ve en qué líneas y grupos está y cuándo escribió por última vez, con filtros por línea, por chat y por HubSpot.',
      pt: 'O Lines tem uma seção Contatos. Cada pessoa aparece uma vez só, mesmo estando em várias linhas, em grupos e num chat 1:1, ou escrevendo com o id do WhatsApp em vez do telefone. Dá para ver em quais linhas e grupos ela está e quando escreveu pela última vez, com filtros por linha, por chat e por HubSpot.',
    },
    {
      product: 'groups',
      en: 'Each contact links to its HubSpot contact and company. Before creating one, the phone is looked up in HubSpot so it is never duplicated, and a new contact is added to the company of their groups when there is one. The link is the same for the whole workspace and for the 1:1 chats.',
      es: 'Cada contacto se vincula a su contacto y su empresa de HubSpot. Antes de crear uno se busca el teléfono en HubSpot para no duplicarlo, y el contacto nuevo se suma a la empresa de sus grupos si la hay. El vínculo es uno para todo el workspace y para los chats 1:1.',
      pt: 'Cada contato se vincula ao contato e à empresa no HubSpot. Antes de criar um, o telefone é buscado no HubSpot para não duplicar, e o contato novo entra na empresa dos grupos dele quando houver uma. O vínculo é um só para todo o workspace e para os chats 1:1.',
    },
    {
      product: 'inbox',
      en: 'Inbox has the same Contacts section for your WhatsApp accounts, with their groups, their last message and the HubSpot contact from your workspace.',
      es: 'Inbox tiene la misma sección Contactos para tus cuentas de WhatsApp, con sus grupos, su último mensaje y el contacto de HubSpot de tu workspace.',
      pt: 'O Inbox tem a mesma seção Contatos para as suas contas de WhatsApp, com grupos, última mensagem e o contato no HubSpot do seu workspace.',
    },
  ],
} satisfies ChangelogEntry;
