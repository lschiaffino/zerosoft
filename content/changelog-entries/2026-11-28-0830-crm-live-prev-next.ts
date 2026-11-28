import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-28-0830-crm-live-prev-next',
  date: '2026-11-28',
  title: {
    en: 'CRM: live lists and records, and previous / next record',
    es: 'CRM: listas y fichas en vivo, y registro anterior / siguiente',
    pt: 'CRM: listas e registros ao vivo, e registro anterior / próximo',
  },
  items: [
    {
      product: 'crm',
      en: 'Contacts, companies, deals and leads tables, the deal and lead boards, the record page and the preview now refresh on their own within a few seconds when a teammate changes a record you can see. Records outside your visibility and hidden properties never cause a refresh. If someone deletes the record you have open, you see a notice with a way back to the list instead of an error page.',
      es: 'Las tablas de contactos, empresas, deals y leads, los boards de deals y leads, la ficha y la vista previa ahora se refrescan solos en unos segundos cuando un compañero cambia un registro que ves. Los registros fuera de tu visibilidad y las propiedades ocultas nunca provocan un refresco. Si alguien borra el registro que tenés abierto, ves un aviso con la vuelta a la lista en vez de una página de error.',
      pt: 'As tabelas de contatos, empresas, negócios e leads, os quadros de negócios e leads, o registro e a prévia agora se atualizam sozinhos em poucos segundos quando um colega muda um registro que você vê. Registros fora da sua visibilidade e propriedades ocultas nunca causam uma atualização. Se alguém excluir o registro que você tem aberto, aparece um aviso com o caminho de volta para a lista em vez de uma página de erro.',
    },
    {
      product: 'crm',
      en: 'On the record page and the preview, ‹ › (or J and K) step through the list you opened it from, in its order and with its filters. From a table, the record page walks the whole view (up to 2,000 records), not just the page on screen. Back returns to that list.',
      es: 'En la ficha y en la vista previa, ‹ › (o J y K) recorren la lista desde la que la abriste, en su orden y con sus filtros. Desde una tabla, la ficha recorre la vista entera (hasta 2.000 registros), no solo la página en pantalla. Volver te lleva a esa lista.',
      pt: 'No registro e na prévia, ‹ › (ou J e K) percorrem a lista de onde você abriu, na sua ordem e com seus filtros. A partir de uma tabela, o registro percorre a visualização inteira (até 2.000 registros), não só a página na tela. Voltar leva a essa lista.',
    },
  ],
} satisfies ChangelogEntry;
