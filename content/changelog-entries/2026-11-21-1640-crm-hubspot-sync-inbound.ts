import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-21-1640-crm-hubspot-sync-inbound',
  date: '2026-11-21',
  title: {
    en: 'CRM: bring HubSpot into the CRM and keep it up to date',
    es: 'CRM: traé HubSpot al CRM y mantenelo al día',
    pt: 'CRM: traga o HubSpot para o CRM e mantenha em dia',
  },
  items: [
    {
      product: 'crm',
      en: 'In CRM settings › Integrations, after connecting HubSpot, an admin can start the sync from HubSpot to the CRM. It brings companies, contacts and deals with their pipelines and stages, which contact belongs to which company and deal, your own HubSpot properties as custom fields, and notes, calls, meetings, tasks and emails as activity. Then it checks HubSpot for changes every minute.',
      es: 'En Ajustes del CRM › Integraciones, después de conectar HubSpot, un admin puede arrancar el sync de HubSpot al CRM. Trae empresas, contactos y deals con sus pipelines y etapas, qué contacto es de qué empresa y deal, las propiedades propias de HubSpot como campos personalizados, y notas, llamadas, reuniones, tareas y emails como actividad. Después revisa los cambios en HubSpot cada minuto.',
      pt: 'Em Ajustes do CRM › Integrações, depois de conectar o HubSpot, um admin pode iniciar a sincronização do HubSpot para o CRM. Ela traz empresas, contatos e negócios com seus pipelines e etapas, qual contato é de qual empresa e negócio, as propriedades próprias do HubSpot como campos personalizados, e notas, ligações, reuniões, tarefas e emails como atividade. Depois confere as mudanças no HubSpot a cada minuto.',
    },
    {
      product: 'crm',
      en: 'Nothing is duplicated: records imported before or already in the CRM are linked, contacts by email and companies by domain. Owners match people in the workspace by email. If a field was changed here since the last sync the value here stays, and records changed on both sides are counted as conflicts. Records archived in HubSpot stay in the CRM.',
      es: 'No se duplica nada: lo importado antes o lo que ya estaba en el CRM se vincula, los contactos por email y las empresas por dominio. Los dueños se emparejan por email con las personas del workspace. Si un campo se cambió acá desde el último sync, queda el valor de acá, y los registros que cambiaron de los dos lados cuentan como conflictos. Lo archivado en HubSpot sigue en el CRM.',
      pt: 'Nada é duplicado: o que foi importado antes ou já estava no CRM é vinculado, contatos por email e empresas por domínio. Os responsáveis são pareados por email com as pessoas do workspace. Se um campo mudou aqui desde a última sincronização, fica o valor daqui, e os registros que mudaram dos dois lados contam como conflitos. O que foi arquivado no HubSpot continua no CRM.',
    },
    {
      product: 'crm',
      en: 'The sync is off until an admin starts it. The screen shows progress, the last sync, counts per object and recent problems, and lets you pause, resume and choose what to bring. Nothing is written to HubSpot yet.',
      es: 'El sync está apagado hasta que un admin lo arranca. La pantalla muestra el avance, el último sync, conteos por objeto y los problemas recientes, y deja pausar, retomar y elegir qué traer. Todavía no se escribe nada en HubSpot.',
      pt: 'A sincronização fica desligada até um admin iniciá-la. A tela mostra o andamento, a última sincronização, contagens por objeto e problemas recentes, e permite pausar, retomar e escolher o que trazer. Ainda não se escreve nada no HubSpot.',
    },
  ],
} satisfies ChangelogEntry;
