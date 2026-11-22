import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-21-2001-crm-hubspot-sync-outbound',
  date: '2026-11-21',
  title: {
    en: 'CRM: write changes back to HubSpot',
    es: 'CRM: los cambios de acá vuelven a HubSpot',
    pt: 'CRM: as mudanças daqui voltam para o HubSpot',
  },
  items: [
    {
      product: 'crm',
      en: 'In CRM settings › Integrations, next to bringing HubSpot into the CRM, there is a separate switch to write to HubSpot. When it is on, what changes here in synced companies, contacts and deals goes to HubSpot every minute: properties, owner, pipeline and stage. Records created here are created there, or linked to the HubSpot contact with the same email or the company with the same domain, and associations added here are added there.',
      es: 'En Ajustes del CRM › Integraciones, al lado de traer HubSpot al CRM, hay un interruptor aparte para escribir en HubSpot. Prendido, lo que cambia acá en empresas, contactos y deals sincronizados va a HubSpot cada minuto: propiedades, dueño, pipeline y etapa. Lo que se crea acá se crea allá, o se vincula al contacto de HubSpot con el mismo email o a la empresa con el mismo dominio, y las asociaciones que se agregan acá se agregan allá.',
      pt: 'Em Ajustes do CRM › Integrações, ao lado de trazer o HubSpot para o CRM, há um interruptor separado para escrever no HubSpot. Ligado, o que muda aqui em empresas, contatos e negócios sincronizados vai para o HubSpot a cada minuto: propriedades, proprietário, pipeline e etapa. O que é criado aqui é criado lá, ou vinculado ao contato do HubSpot com o mesmo email ou à empresa com o mesmo domínio, e as associações adicionadas aqui são adicionadas lá.',
    },
    {
      product: 'crm',
      en: 'It is off by default. A preview shows which fields and how many records would go out before an admin turns it on. A field that changed on both sides is not sent and counts as a conflict, what came from HubSpot is not sent back, and nothing is ever deleted in HubSpot: deleting here only marks the link. Pausing the sync pauses both directions.',
      es: 'Arranca apagado. Una vista previa muestra qué campos y cuántos registros saldrían antes de que un admin lo prenda. Un campo que cambió de los dos lados no se manda y cuenta como conflicto, lo que vino de HubSpot no vuelve a salir y en HubSpot nunca se borra nada: borrar acá solo marca el vínculo. Pausar el sync pausa las dos direcciones.',
      pt: 'Começa desligado. Uma prévia mostra quais campos e quantos registros sairiam antes de um admin ligar. Um campo que mudou dos dois lados não é enviado e conta como conflito, o que veio do HubSpot não volta a sair e nada é apagado no HubSpot: apagar aqui só marca o vínculo. Pausar a sincronização pausa as duas direções.',
    },
  ],
} satisfies ChangelogEntry;
