import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-19-crm-advanced-filters',
  date: '2026-11-19',
  title: {
    en: 'CRM: advanced filters with AND and OR groups on contacts, companies and deals',
    es: 'CRM: filtros avanzados con grupos Y y O en contactos, empresas y deals',
    pt: 'CRM: filtros avançados com grupos E e OU em contatos, empresas e negócios',
  },
  items: [
    {
      product: 'crm',
      en: 'The contacts, companies and deals tables have an Advanced filters button that opens a side panel (a full-screen sheet on the phone). You add a filter by searching for a property, choosing an operator and giving a value. Filters inside a group all have to match, and you can add up to 5 groups joined with OR. The active filters show as chips above the table, each with its own remove button, next to Clear all.',
      es: 'Las tablas de contactos, empresas y deals tienen un botón Filtros avanzados que abre un panel lateral (una hoja a pantalla completa en el teléfono). Agregás un filtro buscando una propiedad, eligiendo un operador y dándole un valor. Los filtros de un grupo se tienen que cumplir todos, y podés sumar hasta 5 grupos unidos con O. Los filtros activos se ven como chips sobre la tabla, cada uno con su botón para quitarlo, al lado de Limpiar todo.',
      pt: 'As tabelas de contatos, empresas e negócios têm um botão Filtros avançados que abre um painel lateral (uma folha em tela cheia no telefone). Você adiciona um filtro buscando uma propriedade, escolhendo um operador e informando um valor. Os filtros de um grupo precisam ser todos cumpridos, e dá para somar até 5 grupos unidos com OU. Os filtros ativos aparecem como chips acima da tabela, cada um com seu botão de remover, ao lado de Limpar tudo.',
    },
    {
      product: 'crm',
      en: 'The operators depend on the type of the property. Text: is or is not equal to any of several values, contains, does not contain, starts with, ends with. Number: equal, not equal, greater or less than (or equal), between. Date: a day, before, after, between, less or more than N days ago, in the last or next N days, and today, yesterday, this, last or next week, month, quarter and year, counted in your time zone. Dropdowns, owner, stage and tags: is any of, is none of. Owner includes Me and Unassigned. Every property can be filtered by is known or is unknown, and an empty text counts as unknown.',
      es: 'Los operadores dependen del tipo de la propiedad. Texto: es o no es igual a alguno de varios valores, contiene, no contiene, empieza con, termina con. Número: igual, distinto, mayor o menor (o igual), entre. Fecha: un día, antes, después, entre, hace menos o más de N días, en los últimos o próximos N días, y hoy, ayer, esta, la pasada o la próxima semana, mes, trimestre y año, contados en tu zona horaria. Selecciones, owner, etapa y tags: es alguno de, no es ninguno de. Owner incluye Yo y Sin asignar. Toda propiedad se puede filtrar por con valor o sin valor, y un texto vacío cuenta como sin valor.',
      pt: 'Os operadores dependem do tipo da propriedade. Texto: é ou não é igual a algum de vários valores, contém, não contém, começa com, termina com. Número: igual, diferente, maior ou menor (ou igual), entre. Data: um dia, antes, depois, entre, há menos ou mais de N dias, nos últimos ou próximos N dias, e hoje, ontem, esta, a passada ou a próxima semana, mês, trimestre e ano, contados no seu fuso horário. Seleções, owner, etapa e tags: é algum de, não é nenhum de. Owner inclui Eu e Sem responsável. Toda propriedade pode ser filtrada por com valor ou sem valor, e um texto vazio conta como sem valor.',
    },
    {
      product: 'crm',
      en: 'The filter is part of the address of the page, so you can share the link or reload and get the same list. Links and saved views made with the old filter builder keep working. A filter never shows more than your visibility allows: a member who only sees their own records gets only those, whatever the groups say. The same filters work in the `filters` parameter of the contact, company and deal lists of API v1.',
      es: 'El filtro es parte de la dirección de la página: podés compartir el link o recargar y ves la misma lista. Los links y las vistas guardadas hechos con el constructor de filtros anterior siguen funcionando. Un filtro nunca muestra más de lo que tu visibilidad permite: un member que solo ve sus registros recibe solo esos, digan lo que digan los grupos. Los mismos filtros funcionan en el parámetro `filters` de los listados de contactos, empresas y deals de la API v1.',
      pt: 'O filtro faz parte do endereço da página: dá para compartilhar o link ou recarregar e ver a mesma lista. Os links e as visualizações salvas feitos com o construtor de filtros anterior continuam funcionando. Um filtro nunca mostra mais do que a sua visibilidade permite: um member que só vê os próprios registros recebe só esses, digam o que disserem os grupos. Os mesmos filtros funcionam no parâmetro `filters` das listagens de contatos, empresas e negócios da API v1.',
    },
  ],
} satisfies ChangelogEntry;
