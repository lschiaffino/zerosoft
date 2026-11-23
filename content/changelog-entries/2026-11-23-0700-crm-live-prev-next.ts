import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-23-0700-crm-live-prev-next',
  date: '2026-11-23',
  title: {
    en: 'CRM: live lists and records, and previous / next record',
    es: 'CRM: listas y fichas en vivo, y registro anterior / siguiente',
    pt: 'CRM: listas e registros ao vivo, e registro anterior / próximo',
  },
  items: [
    {
      product: 'crm',
      en: 'Contacts, companies and deals tables, the deal board, the record page and the preview now refresh on their own within a few seconds when a teammate changes a record you can see. Records outside your visibility and hidden properties never cause a refresh. On the record page and the preview, ‹ › (or J and K) step through the list you opened it from, in its order and with its filters, and Back returns to that list.',
      es: 'Las tablas de contactos, empresas y deals, el board de deals, la ficha y la vista previa ahora se refrescan solos en unos segundos cuando un compañero cambia un registro que ves. Los registros fuera de tu visibilidad y las propiedades ocultas nunca provocan un refresco. En la ficha y en la vista previa, ‹ › (o J y K) recorren la lista desde la que la abriste, en su orden y con sus filtros, y Volver te lleva a esa lista.',
      pt: 'As tabelas de contatos, empresas e negócios, o quadro de negócios, o registro e a prévia agora se atualizam sozinhos em poucos segundos quando um colega muda um registro que você vê. Registros fora da sua visibilidade e propriedades ocultas nunca causam uma atualização. No registro e na prévia, ‹ › (ou J e K) percorrem a lista de onde você abriu, na sua ordem e com seus filtros, e Voltar leva a essa lista.',
    },
  ],
} satisfies ChangelogEntry;
