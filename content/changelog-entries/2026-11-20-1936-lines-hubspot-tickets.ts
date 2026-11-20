import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-lines-hubspot-tickets',
  date: '2026-11-20',
  title: {
    en: 'Lines: create HubSpot tickets from a chat',
    es: 'Lines: crear tickets de HubSpot desde un chat',
    pt: 'Lines: criar tickets do HubSpot a partir de uma conversa',
  },
  items: [
    {
      product: 'groups',
      en: 'The HubSpot section of a chat has "Create HubSpot ticket": pick a subject, description, priority, pipeline and stage, and the ticket is created in HubSpot associated with the company, contact and deal linked to the chat. In Tickets, each Lines ticket has "Send to HubSpot", which fills in its title, message and priority and keeps the link to the HubSpot ticket. The HubSpot key needs the tickets scope.',
      es: 'La sección HubSpot de un chat tiene "Crear ticket en HubSpot": elegís asunto, descripción, prioridad, pipeline y etapa, y el ticket se crea en HubSpot asociado a la empresa, el contacto y el negocio vinculados al chat. En Tickets, cada ticket de Lines tiene "Mandar a HubSpot", que completa su título, mensaje y prioridad y guarda el link al ticket de HubSpot. La clave de HubSpot necesita el permiso tickets.',
      pt: 'A seção HubSpot de uma conversa tem "Criar ticket no HubSpot": escolha assunto, descrição, prioridade, pipeline e etapa, e o ticket é criado no HubSpot associado à empresa, ao contato e ao negócio vinculados à conversa. Em Tickets, cada ticket do Lines tem "Enviar ao HubSpot", que preenche título, mensagem e prioridade e guarda o link do ticket do HubSpot. A chave do HubSpot precisa da permissão tickets.',
    },
  ],
} satisfies ChangelogEntry;
