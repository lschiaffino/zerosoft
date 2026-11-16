import type { Localized, ParityRow, ParityStatus, ProductParity } from './types';

type L = [en: string, es: string, pt: string];
const loc = ([en, es, pt]: L): Localized => ({ en, es, pt });

function row(id: string, area: string, label: L, status: ParityStatus, opts: { detail?: L; competitorHas?: boolean; weight?: 1 | 2 } = {}): ParityRow {
  return {
    id,
    area,
    label: loc(label),
    ...(opts.detail ? { detail: loc(opts.detail) } : {}),
    status,
    competitorHas: opts.competitorHas ?? true,
    ...(opts.weight ? { weight: opts.weight } : {}),
  };
}

/**
 * Time contra Harvest. Fuente: docs/benchmark/time.md (centro de ayuda y API de
 * Harvest por búsqueda; getharvest.com no se pudo abrir desde el sandbox el
 * 2026-11-15). Los ids son estables.
 */
const parity: ProductParity = {
  competitor: 'Harvest',
  alsoCompared: ['Toggl Track', 'Clockify'],
  lastReviewed: '2026-11-15',
  areas: [
    { id: 'tracking', label: loc(['Tracking time', 'Registrar horas', 'Registrar horas']) },
    { id: 'projects', label: loc(['Projects, clients and tasks', 'Proyectos, clientes y tareas', 'Projetos, clientes e tarefas']) },
    { id: 'team', label: loc(['Team', 'Equipo', 'Equipe']) },
    { id: 'reports', label: loc(['Reports', 'Reportes', 'Relatórios']) },
    { id: 'invoicing', label: loc(['Invoices and expenses', 'Facturas y gastos', 'Faturas e despesas']) },
    { id: 'platform', label: loc(['Apps and integrations', 'Apps e integraciones', 'Apps e integrações']) },
  ],
  rows: [
    // Registrar horas
    row('timer', 'tracking', ['Start and stop a timer', 'Arrancar y parar un cronómetro', 'Iniciar e parar um cronômetro'], 'have', {
      weight: 2,
      detail: [
        'One timer per person: starting another stops the first. Counts up to 24 hours',
        'Un cronómetro por persona: arrancar otro para el primero. Cuenta hasta 24 horas',
        'Um cronômetro por pessoa: iniciar outro para o primeiro. Conta até 24 horas',
      ],
    }),
    row('manual-entry', 'tracking', ['Type the duration', 'Escribir la duración', 'Digitar a duração'], 'have', {
      weight: 2,
      detail: ['1:30, 1.5, 1,5, 90m or 1h 30m', '1:30, 1.5, 1,5, 90m o 1h 30m', '1:30, 1.5, 1,5, 90m ou 1h 30m'],
    }),
    row('day-view', 'tracking', ['Day view', 'Vista del día', 'Visão do dia'], 'have', { weight: 2 }),
    row('week-view', 'tracking', ['Week timesheet', 'Hoja de horas semanal', 'Folha de horas semanal'], 'partial', {
      detail: [
        'Totals per day and for the week; hours are edited in the day, not in a week grid',
        'Totales por día y de la semana; las horas se editan en el día, sin grilla semanal',
        'Totais por dia e da semana; as horas são editadas no dia, sem grade semanal',
      ],
    }),
    row('notes', 'tracking', ['Notes on an entry', 'Notas en una entrada', 'Notas em um registro'], 'have'),
    row('edit-entry', 'tracking', ['Edit, move and delete entries', 'Editar, mover y borrar entradas', 'Editar, mover e apagar registros'], 'have'),
    row('start-end', 'tracking', ['Start and end times', 'Hora de inicio y de fin', 'Hora de início e de fim'], 'missing'),
    row('copy-rows', 'tracking', ['Copy rows from the last timesheet', 'Copiar filas de la hoja anterior', 'Copiar linhas da folha anterior'], 'missing'),
    row('calendar-pull', 'tracking', ['Pull events from a calendar', 'Traer eventos de un calendario', 'Trazer eventos de uma agenda'], 'missing'),
    row('idle', 'tracking', ['Idle time detection', 'Detectar tiempo inactivo', 'Detectar tempo ocioso'], 'missing'),
    // Proyectos
    row('projects', 'projects', ['Projects', 'Proyectos', 'Projetos'], 'have', { weight: 2 }),
    row('clients', 'projects', ['Clients', 'Clientes', 'Clientes'], 'have'),
    row('tasks', 'projects', ['Tasks', 'Tareas', 'Tarefas'], 'partial', {
      detail: [
        'One list for the workspace, each billable or not; not chosen per project',
        'Una lista para el workspace, cada una facturable o no; no se eligen por proyecto',
        'Uma lista para o workspace, cada uma faturável ou não; não se escolhem por projeto',
      ],
    }),
    row('project-code', 'projects', ['Project codes', 'Códigos de proyecto', 'Códigos de projeto'], 'have'),
    row('billable', 'projects', ['Billable and non-billable', 'Facturable y no facturable', 'Faturável e não faturável'], 'have', { weight: 2 }),
    row('project-rate', 'projects', ['Hourly rate per project', 'Tarifa por hora del proyecto', 'Valor por hora do projeto'], 'have'),
    row('person-task-rates', 'projects', ['Rates per person or task', 'Tarifas por persona o tarea', 'Valores por pessoa ou tarefa'], 'missing'),
    row('budget', 'projects', ['Project budget', 'Presupuesto del proyecto', 'Orçamento do projeto'], 'partial', {
      detail: [
        'Total hours, with how much is used. No budget in money, per task or per month',
        'Horas totales, con cuánto se usó. Sin presupuesto en dinero, por tarea ni por mes',
        'Horas totais, com quanto foi usado. Sem orçamento em dinheiro, por tarefa nem por mês',
      ],
    }),
    row('budget-alerts', 'projects', ['Budget alerts', 'Avisos de presupuesto', 'Avisos de orçamento'], 'missing'),
    row('fixed-fee', 'projects', ['Fixed fee projects', 'Proyectos de precio fijo', 'Projetos de preço fixo'], 'missing'),
    row('archive', 'projects', ['Archive and restore', 'Archivar y restaurar', 'Arquivar e restaurar'], 'have'),
    row('assign-people', 'projects', ['Assign people to projects', 'Asignar personas a proyectos', 'Atribuir pessoas a projetos'], 'missing', {
      detail: ['Every member can track time on every active project', 'Todos los miembros cargan horas en todos los proyectos activos', 'Todos os membros registram horas em todos os projetos ativos'],
    }),
    // Equipo
    row('roles', 'team', ['Member, manager and admin roles', 'Roles de miembro, manager y admin', 'Papéis de membro, gerente e admin'], 'partial', {
      detail: [
        "Admins manage projects and see everyone's hours; members see their own. No manager role",
        'Los admins manejan proyectos y ven las horas de todos; los miembros, las suyas. Sin rol de manager',
        'Os admins gerenciam projetos e veem as horas de todos; os membros, as próprias. Sem papel de gerente',
      ],
    }),
    row('approvals', 'team', ['Timesheet approvals', 'Aprobación de horas', 'Aprovação de horas'], 'missing'),
    row('edit-others', 'team', ["Edit a teammate's time", 'Editar las horas de otra persona', 'Editar as horas de outra pessoa'], 'missing'),
    row('reminders', 'team', ['Reminders to track time', 'Recordatorios para cargar horas', 'Lembretes para registrar horas'], 'missing'),
    row('capacity', 'team', ['Capacity per person', 'Capacidad por persona', 'Capacidade por pessoa'], 'missing'),
    // Reportes
    row(
      'time-report',
      'reports',
      ['Time report by project, client, task or person', 'Reporte de horas por proyecto, cliente, tarea o persona', 'Relatório de horas por projeto, cliente, tarefa ou pessoa'],
      'have',
      { weight: 2 },
    ),
    row('billable-amount', 'reports', ['Billable amount', 'Monto facturable', 'Valor faturável'], 'have', {
      detail: ['In one currency per workspace', 'En una moneda por workspace', 'Em uma moeda por workspace'],
    }),
    row('csv-export', 'reports', ['Export to CSV', 'Exportar a CSV', 'Exportar para CSV'], 'have'),
    row('saved-reports', 'reports', ['Saved and shared reports', 'Reportes guardados y compartidos', 'Relatórios salvos e compartilhados'], 'missing'),
    row('profitability', 'reports', ['Costs and profitability', 'Costos y rentabilidad', 'Custos e rentabilidade'], 'missing'),
    row('uninvoiced', 'reports', ['Uninvoiced hours', 'Horas sin facturar', 'Horas não faturadas'], 'missing'),
    // Facturas y gastos
    row('invoices', 'invoicing', ['Invoices from tracked time', 'Facturas desde las horas', 'Faturas a partir das horas'], 'missing', { weight: 2 }),
    row('expenses', 'invoicing', ['Expenses and receipts', 'Gastos y comprobantes', 'Despesas e comprovantes'], 'missing'),
    row('estimates', 'invoicing', ['Estimates', 'Presupuestos para clientes', 'Orçamentos para clientes'], 'missing'),
    row('payments', 'invoicing', ['Online payments', 'Pagos en línea', 'Pagamentos online'], 'missing'),
    // Plataforma
    row('api', 'platform', ['API', 'API', 'API'], 'missing'),
    row(
      'integrations',
      'platform',
      ['Timer inside other tools (Asana, Trello, Jira)', 'Cronómetro dentro de otras herramientas (Asana, Trello, Jira)', 'Cronômetro dentro de outras ferramentas (Asana, Trello, Jira)'],
      'missing',
    ),
    row('mobile-desktop', 'platform', ['Phone and desktop apps', 'Apps para teléfono y escritorio', 'Apps para celular e desktop'], 'missing'),
    row('import', 'platform', ['Import from Harvest', 'Importar desde Harvest', 'Importar do Harvest'], 'missing'),
    row('mobile-web', 'platform', ['Works on a phone browser', 'Funciona en el navegador del teléfono', 'Funciona no navegador do celular'], 'have'),
    row('search', 'platform', ['Find projects with Cmd+K', 'Encontrar proyectos con Cmd+K', 'Encontrar projetos com Cmd+K'], 'have', { competitorHas: false }),
    row('self-host', 'platform', ['Run it on your own server', 'Correrlo en tu servidor', 'Rodar no seu servidor'], 'have', { competitorHas: false }),
  ],
};

export default parity;
