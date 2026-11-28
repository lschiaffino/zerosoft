import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-28-1156-crm-c6-leftovers',
  date: '2026-11-28',
  title: {
    en: 'CRM: lead preview and board cards, longer association search, report tiles as tables',
    es: 'CRM: vista previa y tarjetas de leads, búsqueda de asociaciones más larga, reportes como tabla',
    pt: 'CRM: prévia e cartões de leads, busca de associações mais longa, relatórios como tabela',
  },
  items: [
    {
      product: 'crm',
      en: 'Clicking a lead in the table or on the board opens it in the side preview, like contacts, companies and deals: edit its stage, owner and source, set its contact and company, and log a note, call or task. Admins choose what the lead preview shows and which properties the lead board cards show, in Settings.',
      es: 'Un clic en un lead de la tabla o del board lo abre en la vista previa lateral, como contactos, empresas y deals: editás su etapa, owner y origen, le ponés contacto y empresa, y registrás una nota, una llamada o una tarea. Los admins eligen qué muestra la vista previa del lead y qué propiedades llevan las tarjetas del board de leads, en Ajustes.',
      pt: 'Um clique num lead da tabela ou do quadro abre a prévia lateral, como contatos, empresas e negócios: você edita a etapa, o responsável e a origem, define contato e empresa, e registra uma nota, uma ligação ou uma tarefa. Os admins escolhem o que a prévia do lead mostra e quais propriedades os cartões do quadro de leads levam, nos Ajustes.',
    },
    {
      product: 'crm',
      en: 'Searching for a record to associate from the preview or the timeline now lists up to 20 matches instead of 5.',
      es: 'Buscar un registro para asociar desde la vista previa o el timeline ahora muestra hasta 20 resultados en vez de 5.',
      pt: 'Buscar um registro para associar na prévia ou na timeline agora mostra até 20 resultados em vez de 5.',
    },
    {
      product: 'crm',
      en: 'Custom report tiles on a dashboard can be viewed as a table, and when you open the records behind a bar you can switch to an associated object the report uses, for example from the deals to their companies.',
      es: 'Los tiles de reportes propios en un dashboard se pueden ver como tabla, y al abrir los registros detrás de una barra podés pasar a un objeto asociado que usa el reporte, por ejemplo de los deals a sus empresas.',
      pt: 'Os blocos de relatórios próprios num dashboard podem ser vistos como tabela, e ao abrir os registros por trás de uma barra você pode passar para um objeto associado que o relatório usa, por exemplo dos negócios para as empresas.',
    },
    {
      product: 'crm',
      en: 'In the Liquid look with the dark theme, secondary buttons have a visible fill and border again.',
      es: 'En el aspecto Líquido con el tema oscuro, los botones secundarios vuelven a tener relleno y borde visibles.',
      pt: 'No visual Líquido com o tema escuro, os botões secundários voltam a ter preenchimento e borda visíveis.',
    },
  ],
} satisfies ChangelogEntry;
