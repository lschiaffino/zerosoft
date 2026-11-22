import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-22-1500-crm-hubspot-sync-conflicts',
  date: '2026-11-22',
  title: {
    en: 'CRM: choose which side wins in a HubSpot sync conflict',
    es: 'CRM: elegí qué lado gana en un conflicto del sync con HubSpot',
    pt: 'CRM: escolha qual lado vence num conflito do sync com o HubSpot',
  },
  items: [
    {
      product: 'crm',
      en: 'CRM settings › Integrations now lists the records whose fields changed both here and in HubSpot since the last sync. An admin compares the value on each side, read from HubSpot at that moment, and chooses field by field which one stays, or keeps the same side in every conflict at once after a confirmation. Keeping HubSpot updates the record here; keeping zerosoft sends the value to HubSpot through writing to HubSpot, only when it is on. Merges and activities are resolved on the record and can be removed from the list. Changes HubSpot rejected several times can be sent again. Only owners and admins see this, and the conflict list still stores field names only.',
      es: 'Ajustes del CRM › Integraciones ahora lista los registros con campos que cambiaron acá y en HubSpot desde el último sync. Un admin compara el valor de cada lado, leído de HubSpot en ese momento, y elige campo por campo cuál queda, o deja el mismo lado en todos los conflictos de una vez después de confirmar. Dejar HubSpot actualiza el registro acá; dejar zerosoft manda el valor a HubSpot por la escritura en HubSpot, solo si está prendida. Las fusiones y las actividades se resuelven en el registro y se pueden sacar de la lista. Los cambios que HubSpot rechazó varias veces se pueden volver a mandar. Solo lo ven los owners y los admins, y la lista de conflictos sigue guardando solo nombres de campos.',
      pt: 'Ajustes do CRM › Integrações agora lista os registros com campos que mudaram aqui e no HubSpot desde o último sync. Um admin compara o valor de cada lado, lido do HubSpot naquele momento, e escolhe campo por campo qual fica, ou mantém o mesmo lado em todos os conflitos de uma vez depois de confirmar. Manter o HubSpot atualiza o registro aqui; manter o zerosoft envia o valor ao HubSpot pela escrita no HubSpot, só se estiver ligada. Mesclagens e atividades são resolvidas no registro e podem ser tiradas da lista. Mudanças que o HubSpot rejeitou várias vezes podem ser enviadas de novo. Só owners e admins veem isso, e a lista de conflitos continua guardando só nomes de campos.',
    },
  ],
} satisfies ChangelogEntry;
