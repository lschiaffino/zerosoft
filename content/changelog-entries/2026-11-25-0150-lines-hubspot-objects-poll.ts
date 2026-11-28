import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-25-0150-lines-hubspot-objects-poll',
  date: '2026-11-25',
  title: {
    en: 'Lines: HubSpot contacts and deals stay up to date, and merged companies relink themselves',
    es: 'Lines: los contactos y negocios de HubSpot se mantienen al día y las empresas fusionadas se vinculan solas',
    pt: 'Lines: contatos e negócios do HubSpot ficam em dia e empresas mescladas se vinculam sozinhas',
  },
  items: [
    {
      product: 'groups',
      en: 'The linked HubSpot contact and deal of each chat (name, owner, deal stage, amount) now refresh in the background when they change in HubSpot, so the lists no longer show an old stage until someone opens the chat. Records deleted in HubSpot are marked within the hour. When a company is merged in HubSpot and only one company took its place, the groups linked to it move to the surviving company on their own. If HubSpot does not make it clear which one survived, the group keeps the notice asking you to link it by hand.',
      es: 'El contacto y el negocio de HubSpot vinculados a cada chat (nombre, dueño, etapa del negocio, monto) ahora se actualizan solos cuando cambian en HubSpot, así que las listas ya no muestran una etapa vieja hasta que alguien abre el chat. Los registros borrados en HubSpot se marcan dentro de la hora. Cuando una empresa se fusiona en HubSpot y una sola ocupó su lugar, los grupos vinculados pasan solos a la que quedó. Si HubSpot no deja claro cuál quedó, el grupo mantiene el aviso para vincularlo a mano.',
      pt: 'O contato e o negócio do HubSpot vinculados a cada chat (nome, responsável, etapa do negócio, valor) agora se atualizam sozinhos quando mudam no HubSpot, então as listas não mostram mais uma etapa antiga até alguém abrir o chat. Registros apagados no HubSpot são marcados em até uma hora. Quando uma empresa é mesclada no HubSpot e só uma ocupou o lugar dela, os grupos vinculados passam sozinhos para a que ficou. Se o HubSpot não deixar claro qual ficou, o grupo mantém o aviso para vincular manualmente.',
    },
  ],
} satisfies ChangelogEntry;
