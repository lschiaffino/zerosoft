import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-23-0600-crm-lifecycle-options',
  date: '2026-11-23',
  title: {
    en: 'CRM: your own lifecycle stages and lead statuses, and a lifecycle that moves with deals',
    es: 'CRM: etapas del ciclo de vida y estados de lead propios, y un ciclo de vida que avanza con los deals',
    pt: 'CRM: estágios do ciclo de vida e status de lead próprios, e um ciclo de vida que avança com os negócios',
  },
  items: [
    {
      product: 'crm',
      en: 'In Settings › Data, admins add, rename, reorder and archive the options of Lifecycle stage and Lead status. A new name shows on every record, filter and report; an archived option stays on the records that have it and stops being offered. Imports match an option by its name, and a custom option syncs to HubSpot when the portal has one with the same name. Like HubSpot, the contacts and companies of a new deal move to Opportunity, and to Customer when the deal is won: only forward, with a switch to turn it off. Each automatic change shows as one line on the record timeline.',
      es: 'En Ajustes › Datos, los admins suman, renombran, ordenan y archivan las opciones de Etapa del ciclo de vida y Estado del lead. Un nombre nuevo se ve en cada registro, filtro y reporte; una opción archivada queda en los registros que la tienen y deja de ofrecerse. Los importadores reconocen una opción por su nombre, y una propia se sincroniza con HubSpot cuando el portal tiene una con el mismo nombre. Como en HubSpot, los contactos y empresas de un deal nuevo pasan a Oportunidad, y a Cliente cuando se gana el deal: solo hacia adelante, con un interruptor para apagarlo. Cada cambio automático se ve como una línea en el timeline del registro.',
      pt: 'Em Ajustes › Dados, os admins criam, renomeiam, ordenam e arquivam as opções de Estágio do ciclo de vida e Status do lead. Um nome novo aparece em cada registro, filtro e relatório; uma opção arquivada fica nos registros que a têm e deixa de ser oferecida. Os importadores reconhecem uma opção pelo nome, e uma própria sincroniza com o HubSpot quando o portal tem uma com o mesmo nome. Como no HubSpot, os contatos e empresas de um negócio novo passam para Oportunidade, e para Cliente quando o negócio é ganho: só para frente, com uma chave para desligar. Cada mudança automática aparece como uma linha na linha do tempo do registro.',
    },
  ],
} satisfies ChangelogEntry;
