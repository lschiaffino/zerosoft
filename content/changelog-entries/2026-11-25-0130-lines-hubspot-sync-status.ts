import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-25-0130-lines-hubspot-sync-status',
  date: '2026-11-25',
  title: {
    en: 'Lines: HubSpot sync status and a Sync now button',
    es: 'Lines: estado de la sincronización con HubSpot y botón para sincronizar ahora',
    pt: 'Lines: status da sincronização com o HubSpot e botão para sincronizar agora',
  },
  items: [
    {
      product: 'groups',
      en: 'Settings › Integrations now shows when HubSpot last synced and what needs attention: companies that were deleted or merged in HubSpot, notes that could not be left, and an automatic sync that keeps failing, with the next retry time. "Sync now" re-reads the key permissions, every linked company and the notes that failed. When HubSpot rejects a request for a missing permission, the error names the permission. Notes and searches wait and retry when HubSpot limits requests instead of failing on the first one, notes are no longer left behind when many chats are linked, and switching to another HubSpot account clears the contact and deal properties of the previous one.',
      es: 'Ajustes › Integraciones ahora muestra cuándo se sincronizó HubSpot por última vez y qué hay que revisar: empresas que se borraron o fusionaron en HubSpot, notas que no se pudieron dejar y una sincronización automática que sigue fallando, con la hora del próximo intento. "Sincronizar ahora" vuelve a leer los permisos de la clave, todas las empresas vinculadas y las notas que fallaron. Cuando HubSpot rechaza un pedido por falta de un permiso, el error dice cuál es. Las notas y las búsquedas esperan y reintentan cuando HubSpot limita los pedidos, en vez de fallar al primero, las notas ya no quedan sin enviar cuando hay muchos chats vinculados y al cambiar a otra cuenta de HubSpot se borran las propiedades de contactos y negocios de la anterior.',
      pt: 'Ajustes › Integrações agora mostra quando o HubSpot sincronizou pela última vez e o que precisa de atenção: empresas apagadas ou mescladas no HubSpot, notas que não puderam ser deixadas e uma sincronização automática que continua falhando, com o horário da próxima tentativa. "Sincronizar agora" lê de novo as permissões da chave, todas as empresas vinculadas e as notas que falharam. Quando o HubSpot recusa um pedido por falta de uma permissão, o erro diz qual é. As notas e as buscas esperam e tentam de novo quando o HubSpot limita as requisições, em vez de falhar na primeira, as notas não ficam mais sem enviar quando há muitos chats vinculados e, ao trocar para outra conta do HubSpot, as propriedades de contatos e negócios da anterior são apagadas.',
    },
  ],
} satisfies ChangelogEntry;
