import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-22-1740-crm-contacts-companies-lists',
  date: '2026-11-22',
  title: {
    en: 'CRM: contacts and companies laid out like HubSpot',
    es: 'CRM: contactos y empresas ordenados como en HubSpot',
    pt: 'CRM: contatos e empresas organizados como no HubSpot',
  },
  items: [
    {
      product: 'crm',
      en: 'The contacts and companies lists now follow HubSpot: search and sort on top, then a row of quick filters for owner, create date, last activity date, lead status, lifecycle stage and, for companies, industry, with ranges such as last 7 days, this month or no activity, next to More filters and Advanced filters. The name column shows an avatar or the company logo and stays fixed while the table scrolls; a click on the name opens the preview and Open goes to the record. Selected rows get Assign, Edit, Add to list, Tags, Enroll in sequence, Export and Delete, each in its own panel. Pick 25, 50 or 100 rows per page. On the record page, Search properties finds a property in every card and blank ones can be hidden.',
      es: 'Los listados de contactos y empresas ahora siguen a HubSpot: búsqueda y orden arriba, y abajo una fila de filtros rápidos por responsable, fecha de creación, fecha de última actividad, estado del lead, etapa del ciclo de vida y, en empresas, industria, con rangos como últimos 7 días, este mes o sin actividad, al lado de Más filtros y Filtros avanzados. La columna del nombre muestra un avatar o el logo de la empresa y queda fija al desplazar la tabla; un clic en el nombre abre la vista previa y Abrir te lleva a la ficha. Las filas elegidas tienen Asignar, Editar, Agregar a lista, Tags, Inscribir en secuencia, Exportar y Eliminar, cada una en su panel. Elegí 25, 50 o 100 filas por página. En la ficha, Buscar propiedades encuentra una propiedad en todas las tarjetas y podés ocultar las vacías.',
      pt: 'As listagens de contatos e empresas agora seguem o HubSpot: busca e ordem no topo, e embaixo uma linha de filtros rápidos por responsável, data de criação, data da última atividade, status do lead, estágio do ciclo de vida e, em empresas, setor, com períodos como últimos 7 dias, este mês ou sem atividade, ao lado de Mais filtros e Filtros avançados. A coluna do nome mostra um avatar ou o logo da empresa e fica fixa ao rolar a tabela; um clique no nome abre a prévia e Abrir leva ao registro. As linhas escolhidas têm Atribuir, Editar, Adicionar à lista, Tags, Inscrever em sequência, Exportar e Excluir, cada uma no seu painel. Escolha 25, 50 ou 100 linhas por página. No registro, Buscar propriedades encontra uma propriedade em todos os cartões e as vazias podem ser ocultadas.',
    },
  ],
} satisfies ChangelogEntry;
