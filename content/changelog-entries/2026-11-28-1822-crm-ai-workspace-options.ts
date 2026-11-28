import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-28-1822-crm-ai-workspace-options',
  date: '2026-11-28',
  title: {
    en: 'CRM: the AI uses your own lifecycle and lead status options',
    es: 'CRM: la IA usa tus propias opciones de lifecycle y lead status',
    pt: 'CRM: a IA usa as suas próprias opções de lifecycle e lead status',
  },
  items: [
    {
      product: 'crm',
      en: 'The CRM assistant and the suggestions after a call now offer the lifecycle stages and lead statuses you set up in Settings › Data, with the names you gave them. Ask for "Trial user" and the assistant proposes it; archived options are no longer proposed.',
      es: 'El asistente del CRM y las sugerencias después de una llamada ahora ofrecen las etapas de lifecycle y los estados de lead que configuraste en Ajustes › Datos, con los nombres que les pusiste. Pedí "Trial user" y el asistente lo propone; las opciones archivadas ya no se proponen.',
      pt: 'O assistente do CRM e as sugestões depois de uma ligação agora oferecem os estágios de lifecycle e os status de lead que você configurou em Ajustes › Dados, com os nomes que você deu. Peça "Trial user" e o assistente propõe; as opções arquivadas não são mais propostas.',
    },
  ],
} satisfies ChangelogEntry;
