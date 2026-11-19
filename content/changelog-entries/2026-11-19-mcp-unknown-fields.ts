import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-19-mcp-unknown-fields',
  date: '2026-11-19',
  title: {
    en: 'The MCP connector says which field it did not understand',
    es: 'El conector MCP dice qué campo no entendió',
    pt: 'O conector MCP diz qual campo não entendeu',
  },
  items: [
    {
      product: 'platform',
      en: 'When Claude sends a field an operation does not have, like name instead of firstName on a contact, the call now fails with the list of accepted fields. Before, the field was dropped and the contact or note was created empty. A missing required field is named too.',
      es: 'Cuando Claude manda un campo que la operación no tiene, como name en vez de firstName en un contacto, la llamada ahora falla con la lista de campos que acepta. Antes el campo se descartaba y el contacto o la nota se creaba vacío. Un campo obligatorio que falta también se nombra.',
      pt: 'Quando o Claude envia um campo que a operação não tem, como name em vez de firstName num contato, a chamada agora falha com a lista de campos aceitos. Antes o campo era descartado e o contato ou a nota era criado vazio. Um campo obrigatório que falta também é nomeado.',
    },
    {
      product: 'platform',
      en: 'An expired connector token always gets a 401 so the client renews it. Connectors like claude.ai call from a few shared addresses, and before, many expired tokens at once could rate limit everyone on that address.',
      es: 'Un token vencido de un conector siempre recibe un 401 para que el cliente lo renueve. Conectores como claude.ai llaman desde pocas direcciones compartidas, y antes muchos tokens vencidos a la vez podían frenar a todos los de esa dirección.',
      pt: 'Um token vencido de um conector sempre recebe um 401 para que o cliente o renove. Conectores como o claude.ai chamam de poucos endereços compartilhados, e antes muitos tokens vencidos ao mesmo tempo podiam bloquear todos nesse endereço.',
    },
  ],
} satisfies ChangelogEntry;
