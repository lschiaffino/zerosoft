import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-21-1840-crm-property-groups-unique',
  date: '2026-11-21',
  title: {
    en: 'CRM: property groups, descriptions, unique values, and deal type, next step and closed won reason',
    es: 'CRM: grupos de propiedades, descripciones, valores únicos, y tipo de deal, próximo paso y motivo de ganado',
    pt: 'CRM: grupos de propriedades, descrições, valores únicos, e tipo de negócio, próximo passo e motivo de ganho',
  },
  items: [
    {
      product: 'crm',
      en: 'In Settings › Data each custom property of contacts, companies and deals now takes a group and a description. The record shows one card per group, and the description appears under the property name. Owners and admins can mark a text, number, URL or phone property as unique: two records can no longer share its value, and the message does not say which record has it. Deals get three built-in properties from HubSpot: deal type (new or existing business), next step and closed won reason, editable on the record and usable in filters.',
      es: 'En Ajustes › Datos cada propiedad propia de contactos, empresas y deals ahora lleva un grupo y una descripción. La ficha muestra una tarjeta por grupo, y la descripción aparece debajo del nombre de la propiedad. Los owners y admins pueden marcar como única una propiedad de texto, número, URL o teléfono: dos registros ya no pueden compartir su valor, y el aviso no dice qué registro lo tiene. Los deals suman tres propiedades de fábrica de HubSpot: tipo de deal (negocio nuevo o existente), próximo paso y motivo de ganado, editables en la ficha y usables en los filtros.',
      pt: 'Em Configurações › Dados cada propriedade própria de contatos, empresas e negócios agora leva um grupo e uma descrição. O registro mostra um cartão por grupo, e a descrição aparece abaixo do nome da propriedade. Os owners e admins podem marcar como única uma propriedade de texto, número, URL ou telefone: dois registros não podem mais compartilhar o valor, e o aviso não diz qual registro o tem. Os negócios ganham três propriedades padrão do HubSpot: tipo de negócio (novo ou existente), próximo passo e motivo de ganho, editáveis no registro e usáveis nos filtros.',
    },
  ],
} satisfies ChangelogEntry;
