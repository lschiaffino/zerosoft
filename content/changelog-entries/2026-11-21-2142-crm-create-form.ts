import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-21-2142-crm-create-form',
  date: '2026-11-21',
  title: {
    en: 'CRM: choose the fields of the create form',
    es: 'CRM: elegí los campos del formulario de alta',
    pt: 'CRM: escolha os campos do formulário de criação',
  },
  items: [
    {
      product: 'crm',
      en: 'Owners and admins can now choose, in Settings › Data, which properties appear when someone creates a contact, company or deal, in what order and which are required. Custom properties count too. The quick create window and the full forms follow it, and a create that leaves a required field empty is refused. Members only see the custom properties they are allowed to edit. Deal type, next step and closed won reason can also be set in bulk edit and mapped in the CSV import.',
      es: 'Los owners y admins ahora pueden elegir, en Ajustes › Datos, qué propiedades aparecen al crear un contacto, una empresa o un deal, en qué orden y cuáles son obligatorias. Las propiedades personalizadas también cuentan. La ventana de alta rápida y los formularios completos lo siguen, y un alta que deja vacía una obligatoria se rechaza. Los miembros solo ven las propiedades personalizadas que pueden editar. Tipo de deal, próximo paso y motivo de ganado también se cargan en la edición en masa y se mapean en el import CSV.',
      pt: 'Os owners e admins agora podem escolher, em Configurações › Dados, quais propriedades aparecem ao criar um contato, uma empresa ou um negócio, em que ordem e quais são obrigatórias. As propriedades personalizadas também contam. A janela de criação rápida e os formulários completos seguem isso, e uma criação que deixa uma obrigatória vazia é recusada. Os membros só veem as propriedades personalizadas que podem editar. Tipo de negócio, próximo passo e motivo de ganho também podem ser definidos na edição em massa e mapeados na importação CSV.',
    },
  ],
} satisfies ChangelogEntry;
