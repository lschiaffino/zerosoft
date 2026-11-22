import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-21-2040-crm-association-labels',
  date: '2026-11-21',
  title: {
    en: 'CRM: your own association labels',
    es: 'CRM: labels de asociación propios',
    pt: 'CRM: rótulos de associação próprios',
  },
  items: [
    {
      product: 'crm',
      en: 'Owners and admins can now create association labels in Settings › Data, like "Billing contact" between a contact and a company or "Decision maker" between a deal and a contact. People pick them on the association cards of the record, and the API accepts them too. Deleting a label removes it from the records that used it. Settings › Data also lists only the custom properties each person has access to.',
      es: 'Los owners y admins ahora pueden crear labels de asociación en Ajustes › Datos, como "Contacto de facturación" entre un contacto y una empresa o "Decisor" entre un deal y un contacto. Se eligen en las tarjetas de asociaciones de la ficha, y la API también los acepta. Borrar un label lo quita de los registros que lo usaban. Ajustes › Datos además lista solo las propiedades propias a las que cada persona tiene acceso.',
      pt: 'Os owners e admins agora podem criar rótulos de associação em Configurações › Dados, como "Contato de cobrança" entre um contato e uma empresa ou "Decisor" entre um negócio e um contato. Eles são escolhidos nos cartões de associações do registro, e a API também os aceita. Excluir um rótulo o remove dos registros que o usavam. Configurações › Dados também lista só as propriedades próprias às quais cada pessoa tem acesso.',
    },
  ],
} satisfies ChangelogEntry;
