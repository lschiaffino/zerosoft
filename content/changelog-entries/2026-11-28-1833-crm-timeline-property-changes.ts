import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-28-1833-crm-timeline-property-changes',
  date: '2026-11-28',
  title: {
    en: 'CRM: property changes in the timeline',
    es: 'CRM: los cambios de propiedades en el timeline',
    pt: 'CRM: as mudanças de propriedades no timeline',
  },
  items: [
    {
      product: 'crm',
      en: 'The timeline of a contact, company or deal now shows each property change as one line with who made it: lifecycle stage, lead status, owner, deal stage, amount, custom properties and more. They do not count as activity, and you can hide them with Property changes in Filter activity.',
      es: 'El timeline de un contacto, una empresa o un deal ahora muestra cada cambio de una propiedad como una línea con quién lo hizo: lifecycle stage, lead status, owner, etapa del deal, monto, campos propios y más. No cuentan como actividad y los podés esconder con Cambios de propiedades en Filtrar actividad.',
      pt: 'O timeline de um contato, uma empresa ou um negócio agora mostra cada mudança de uma propriedade como uma linha com quem fez: lifecycle stage, lead status, owner, etapa do negócio, valor, campos personalizados e mais. Elas não contam como atividade e você pode escondê-las com Mudanças de propriedades em Filtrar atividade.',
    },
  ],
} satisfies ChangelogEntry;
