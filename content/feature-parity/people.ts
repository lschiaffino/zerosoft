import type { Localized, ParityRow, ParityStatus, ProductParity } from './types';

type L = [en: string, es: string, pt: string];
const loc = ([en, es, pt]: L): Localized => ({ en, es, pt });

function row(
  id: string,
  area: string,
  label: L,
  status: ParityStatus,
  opts: { detail?: L; competitorHas?: boolean; weight?: 1 | 2 } = {},
): ParityRow {
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
 * People contra BambooHR. Fuente: la documentación pública de BambooHR
 * (Help Center: employee records, time off, onboarding, offboarding,
 * performance management, e-signatures, reports, payroll y benefits), leída
 * el 2026-10-29, contra el código de esta primera versión. El reclutamiento
 * (ATS de BambooHR) no se compara acá: es la app Hiring, que reemplaza a
 * Workable. Los ids son estables.
 */
const parity: ProductParity = {
  competitor: 'BambooHR',
  alsoCompared: ['Workable (Hiring, app aparte)'],
  lastReviewed: '2026-10-29',
  areas: [
    { id: 'records', label: loc(['Employee records', 'Fichas de personas', 'Perfis de pessoas']) },
    { id: 'org', label: loc(['Directory and org chart', 'Directorio y organigrama', 'Diretório e organograma']) },
    { id: 'timeoff', label: loc(['Time off', 'Licencias', 'Folgas']) },
    { id: 'onboarding', label: loc(['Onboarding and offboarding', 'Onboarding y offboarding', 'Onboarding e desligamento']) },
    { id: 'documents', label: loc(['Documents and signatures', 'Documentos y firmas', 'Documentos e assinaturas']) },
    { id: 'performance', label: loc(['Performance', 'Desempeño', 'Desempenho']) },
    { id: 'comp', label: loc(['Compensation and payroll', 'Sueldos y nómina', 'Salários e folha']) },
    { id: 'reports', label: loc(['Reports', 'Reportes', 'Relatórios']) },
    { id: 'security', label: loc(['Access and privacy', 'Acceso y privacidad', 'Acesso e privacidade']) },
    { id: 'platform', label: loc(['Platform and integrations', 'Plataforma e integraciones', 'Plataforma e integrações']) },
  ],
  rows: [
    // Fichas
    row('profiles', 'records', ['Employee profiles', 'Fichas de personas', 'Perfis de pessoas'], 'have', {
      weight: 2,
      detail: [
        'Job title, department, location, country, manager, start and end date, employment type, pay period, work email, phone, pronouns and a bio. Every workspace member gets one automatically',
        'Puesto, área, ubicación, país, manager, fechas de ingreso y salida, tipo de contratación, período de pago, email laboral, teléfono, pronombres y bio. Cada miembro del workspace tiene la suya automáticamente',
        'Cargo, área, localização, país, gestor, datas de admissão e saída, tipo de contratação, período de pagamento, email de trabalho, telefone, pronomes e bio. Cada membro do workspace ganha a sua automaticamente',
      ],
    }),
    row('personal-data', 'records', ['Personal data and emergency contacts', 'Datos personales y contactos de emergencia', 'Dados pessoais e contatos de emergência'], 'have', {
      detail: [
        'Personal email, home address, date of birth, ID number and up to five emergency contacts, encrypted at rest',
        'Email personal, domicilio, fecha de nacimiento, documento y hasta cinco contactos de emergencia, cifrados en la base',
        'Email pessoal, endereço, data de nascimento, documento e até cinco contatos de emergência, criptografados no banco',
      ],
    }),
    row('custom-fields', 'records', ['Custom fields', 'Campos propios', 'Campos personalizados'], 'partial', {
      detail: [
        'Text, number, date and list fields, each one public or sensitive. No custom tabs or table fields with history',
        'Campos de texto, número, fecha y lista, cada uno público o sensible. Sin pestañas propias ni campos tabla con historial',
        'Campos de texto, número, data e lista, cada um público ou sensível. Sem abas próprias nem campos tabela com histórico',
      ],
    }),
    row('photo', 'records', ['Profile photos', 'Fotos de perfil', 'Fotos de perfil'], 'have', {
      detail: ['Checked by their bytes (PNG, JPEG, GIF, WebP, AVIF) and served privately', 'Verificadas por sus bytes (PNG, JPEG, GIF, WebP, AVIF) y servidas en privado', 'Verificadas pelos bytes (PNG, JPEG, GIF, WebP, AVIF) e servidas em privado'],
    }),
    row('self-service', 'records', ['Employee self-service', 'Autoservicio', 'Autoatendimento'], 'have', {
      weight: 2,
      detail: [
        'Each person edits their contact and personal data, sees their balances, requests time off and reads the documents shared with them',
        'Cada persona edita sus datos de contacto y personales, ve sus saldos, pide días y lee los documentos que le comparten',
        'Cada pessoa edita seus dados de contato e pessoais, vê seus saldos, pede folgas e lê os documentos compartilhados com ela',
      ],
    }),
    row('change-approvals', 'records', ['Approval of profile changes', 'Aprobación de cambios en la ficha', 'Aprovação de mudanças no perfil'], 'missing', {
      detail: ['Self-service edits apply at once; there is no approval step', 'Los cambios del autoservicio se aplican al instante; no hay paso de aprobación', 'As mudanças do autoatendimento valem na hora; não há etapa de aprovação'],
    }),
    row('employee-history', 'records', ['Job and status history', 'Historial de puesto y estado', 'Histórico de cargo e status'], 'partial', {
      detail: ['Salary changes keep their history; job title and department changes do not', 'Los cambios de sueldo quedan en un historial; los de puesto y área no', 'As mudanças de salário ficam no histórico; as de cargo e área não'],
    }),
    // Directorio y organigrama
    row('directory', 'org', ['Employee directory with search and filters', 'Directorio con búsqueda y filtros', 'Diretório com busca e filtros'], 'have', {
      weight: 2,
      detail: ['Search by name, title or team and filter by department, location, type and status', 'Búsqueda por nombre, puesto o área y filtros por área, ubicación, tipo y estado', 'Busca por nome, cargo ou área e filtros por área, localização, tipo e status'],
    }),
    row('org-chart', 'org', ['Org chart', 'Organigrama', 'Organograma'], 'have', {
      weight: 2,
      detail: ['Built from manager links, with zoom, pan, keyboard control and PNG export', 'Se arma con los managers, con zoom, paneo, manejo con teclado y exportación a PNG', 'Montado a partir dos gestores, com zoom, arrastar, controle por teclado e exportação em PNG'],
    }),
    row('directory-visibility', 'org', ['Directory visibility settings', 'Visibilidad del directorio', 'Visibilidade do diretório'], 'have', {
      detail: ['Phone, location, start date, employment type and birthday: everyone, managers or HR only', 'Teléfono, ubicación, fecha de ingreso, tipo de contratación y cumpleaños: todos, managers o solo HR', 'Telefone, localização, data de admissão, tipo de contratação e aniversário: todos, gestores ou só o RH'],
    }),
    row('celebrations', 'org', ['Birthdays and work anniversaries feed', 'Cumpleaños y aniversarios', 'Aniversários e tempo de casa'], 'missing'),
    // Licencias
    row('pto-policies', 'timeoff', ['Time off policies per type', 'Políticas de licencia por tipo', 'Políticas de folga por tipo'], 'have', {
      weight: 2,
      detail: ['Vacation, sick, personal and other policies, each with its own accrual, carryover and cap', 'Vacaciones, enfermedad, personales y otras, cada una con su devengamiento, arrastre y tope', 'Férias, licença médica, pessoais e outras, cada uma com seu acúmulo, transferência e limite'],
    }),
    row('accrual', 'timeoff', ['Accrual rules', 'Reglas de devengamiento', 'Regras de acúmulo'], 'partial', {
      weight: 2,
      detail: [
        'Yearly (prorated the first year), monthly or per pay period (weekly, every two weeks, twice a month, monthly), carryover limit and balance cap. No accrual by tenure levels or per-group policy assignment: every policy applies to everyone',
        'Anual (prorrateado el primer año), mensual o por período de pago (semanal, cada dos semanas, quincenal, mensual), límite de arrastre y tope de saldo. Sin niveles por antigüedad ni asignación de políticas por grupo: cada política aplica a todos',
        'Anual (proporcional no primeiro ano), mensal ou por período de pagamento (semanal, a cada duas semanas, quinzenal, mensal), limite de transferência e de saldo. Sem níveis por tempo de casa nem atribuição de políticas por grupo: cada política vale para todos',
      ],
    }),
    row('pto-requests', 'timeoff', ['Requests and approvals', 'Pedidos y aprobaciones', 'Pedidos e aprovações'], 'have', {
      weight: 2,
      detail: ['The manager chain or HR approves; nobody approves their own request. Overlaps and balance are checked', 'Aprueba la cadena de managers o HR; nadie aprueba lo propio. Se controlan superposiciones y saldo', 'Aprova a cadeia de gestores ou o RH; ninguém aprova o próprio pedido. Sobreposições e saldo são verificados'],
    }),
    row('half-days', 'timeoff', ['Half days and hours', 'Medio día y horas', 'Meio dia e horas'], 'partial', {
      detail: ['Morning or afternoon half days. Balances are in days, not hours', 'Medio día de mañana o de tarde. Los saldos son en días, no en horas', 'Meio dia de manhã ou de tarde. Os saldos são em dias, não em horas'],
    }),
    row('holidays', 'timeoff', ['Holidays per country', 'Feriados por país', 'Feriados por país'], 'have', {
      detail: ['National holidays for Argentina, Brazil, Mexico, the US, Spain and Colombia (2026 and 2027) plus your own; they do not count as days off', 'Feriados nacionales de Argentina, Brasil, México, Estados Unidos, España y Colombia (2026 y 2027) más los propios; no cuentan como días de licencia', 'Feriados nacionais de Argentina, Brasil, México, Estados Unidos, Espanha e Colômbia (2026 e 2027) mais os próprios; não contam como dias de folga'],
    }),
    row('whos-out', 'timeoff', ["Who's out and team calendar", 'Quién está fuera y calendario del equipo', 'Quem está fora e calendário da equipe'], 'have', {
      detail: ['Month view with holidays; the type of leave is shown only to whoever can see it', 'Vista por mes con feriados; el tipo de licencia solo lo ve quien puede', 'Visão mensal com feriados; o tipo de folga só aparece para quem pode ver'],
    }),
    row('balances-history', 'timeoff', ['Balances, history and adjustments', 'Saldos, historial y ajustes', 'Saldos, histórico e ajustes'], 'have'),
    row('calendar-sync', 'timeoff', ['Calendar blocking', 'Bloqueo de calendario', 'Bloqueio de agenda'], 'better', {
      detail: ['Approved days block the person in Cal (no bookings) and set an out-of-office status in Talk', 'Los días aprobados bloquean a la persona en Cal (sin reservas) y ponen "fuera de la oficina" en Talk', 'Os dias aprovados bloqueiam a pessoa no Cal (sem reservas) e colocam "fora do escritório" no Talk'],
    }),
    row('pto-notifications', 'timeoff', ['Time off notifications', 'Avisos de licencias', 'Avisos de folgas'], 'partial', {
      detail: ['In-app notifications to the approver and the requester. No email or Slack digests', 'Avisos dentro de la app a quien aprueba y a quien pide. Sin resúmenes por email o Slack', 'Avisos no app para quem aprova e quem pede. Sem resumos por email ou Slack'],
    }),
    // Onboarding y offboarding
    row('onboarding-templates', 'onboarding', ['Onboarding checklists from templates', 'Checklists de onboarding desde plantillas', 'Checklists de onboarding a partir de modelos'], 'have', {
      weight: 2,
      detail: ['Tasks for the new hire, their manager, IT or HR, due relative to the start date', 'Tareas para la persona, su manager, IT o HR, con vencimiento relativo al ingreso', 'Tarefas para a pessoa, o gestor, TI ou RH, com prazo relativo à admissão'],
    }),
    row('welcome', 'onboarding', ['New hire welcome page', 'Página de bienvenida', 'Página de boas-vindas'], 'have', {
      detail: ['HR message, manager, team, first tasks and documents to read', 'Mensaje de HR, manager, equipo, primeras tareas y documentos para leer', 'Mensagem do RH, gestor, equipe, primeiras tarefas e documentos para ler'],
    }),
    row('preboarding', 'onboarding', ['Pre-boarding before the first day', 'Preingreso antes del primer día', 'Pré-admissão antes do primeiro dia'], 'partial', {
      detail: ['HR adds the person before they join and the profile links when they accept the invite. No separate packet or form to fill', 'HR carga a la persona antes de que entre y la ficha se enlaza al aceptar la invitación. Sin paquete ni formulario aparte', 'O RH cadastra a pessoa antes de entrar e o perfil se vincula ao aceitar o convite. Sem pacote nem formulário à parte'],
    }),
    row('offboarding', 'onboarding', ['Offboarding with access removal', 'Offboarding con corte de accesos', 'Desligamento com remoção de acessos'], 'better', {
      weight: 2,
      detail: ['Checklist with asset return tasks and, optionally, removal from the workspace with the same flow as Settings › Members (API keys, Cal, Chat, Talk, Track, Docs and shares)', 'Checklist con devolución de equipos y, si se elige, salida del workspace con el mismo flujo de Ajustes › Miembros (API keys, Cal, Chat, Talk, Track, Docs y lo compartido)', 'Checklist com devolução de equipamentos e, se escolhido, saída do workspace pelo mesmo fluxo de Configurações › Membros (chaves de API, Cal, Chat, Talk, Track, Docs e compartilhamentos)'],
    }),
    row('exit-interview', 'onboarding', ['Exit interview', 'Entrevista de salida', 'Entrevista de desligamento'], 'have', {
      detail: ['Reason, would-recommend score, rehire eligibility and notes, encrypted and HR only', 'Motivo, puntaje de recomendación, recontratación y notas, cifrado y solo HR', 'Motivo, nota de recomendação, recontratação e notas, criptografado e só RH'],
    }),
    // Documentos
    row('documents', 'documents', ['Employee documents', 'Documentos por persona', 'Documentos por pessoa'], 'have', {
      detail: ['Contracts, IDs and tax forms in a private folder, checked by their bytes, shared with the person or HR only', 'Contratos, documentos y formularios fiscales en una carpeta privada, verificados por sus bytes, compartidos con la persona o solo HR', 'Contratos, documentos e formulários fiscais em pasta privada, verificados pelos bytes, compartilhados com a pessoa ou só com o RH'],
    }),
    row('policy-ack', 'documents', ['Policy acknowledgement', 'Confirmación de lectura de políticas', 'Confirmação de leitura de políticas'], 'have', {
      detail: ['Company policies and the handbook (a Docs page) with "I have read it" and a count per document', 'Políticas y manual (una página de Docs) con "Lo leí" y conteo por documento', 'Políticas e manual (uma página do Docs) com "Li" e contagem por documento'],
    }),
    row('esign', 'documents', ['E-signature', 'Firma electrónica', 'Assinatura eletrônica'], 'missing', {
      weight: 2,
      detail: ['There is no Sign app yet; use read confirmations', 'Todavía no hay app Sign; se usa la confirmación de lectura', 'Ainda não há app Sign; use a confirmação de leitura'],
    }),
    // Desempeño
    row('review-cycles', 'performance', ['Review cycles', 'Ciclos de evaluación', 'Ciclos de avaliação'], 'have', {
      weight: 2,
      detail: ['Self, manager and peer reviews with text and 1 to 5 questions; the person sees the manager review when the cycle closes', 'Autoevaluación, del manager y de pares con preguntas de texto y de 1 a 5; la persona ve la del manager al cerrar el ciclo', 'Autoavaliação, do gestor e de pares com perguntas de texto e de 1 a 5; a pessoa vê a do gestor quando o ciclo fecha'],
    }),
    row('peer-picking', 'performance', ['Choosing peer reviewers', 'Elegir quién evalúa como par', 'Escolher quem avalia como par'], 'partial', {
      detail: ['Peers are picked automatically (up to two who share the manager); they cannot be chosen by hand', 'Los pares se eligen solos (hasta dos que comparten manager); no se eligen a mano', 'Os pares são escolhidos automaticamente (até dois com o mesmo gestor); não dá para escolher à mão'],
    }),
    row('goals', 'performance', ['Goals with progress', 'Objetivos con avance', 'Metas com progresso'], 'have'),
    row('one-on-ones', 'performance', ['1:1 notes', 'Notas 1:1', 'Notas 1:1'], 'have', {
      detail: ['Private to the two people, not even HR', 'Privadas entre las dos personas, ni HR las ve', 'Privadas entre as duas pessoas, nem o RH vê'],
    }),
    row('surveys', 'performance', ['Employee satisfaction surveys (eNPS)', 'Encuestas de satisfacción (eNPS)', 'Pesquisas de satisfação (eNPS)'], 'missing'),
    // Sueldos y nómina
    row('comp-history', 'comp', ['Compensation history', 'Historial de sueldos', 'Histórico salarial'], 'have', {
      weight: 2,
      detail: ['Amount, currency, period and reason per change, encrypted at rest; only HR and the person see it', 'Monto, moneda, período y motivo por cambio, cifrados en la base; solo los ven HR y la persona', 'Valor, moeda, período e motivo por mudança, criptografados no banco; só o RH e a pessoa veem'],
    }),
    row('payroll-export', 'comp', ['Payroll export', 'Export de nómina', 'Exportação da folha'], 'have', {
      detail: ['CSV with each person and their current salary, audited', 'CSV con cada persona y su sueldo vigente, auditado', 'CSV com cada pessoa e o salário vigente, auditado'],
    }),
    row('payroll', 'comp', ['Payroll processing', 'Liquidación de sueldos', 'Processamento da folha'], 'missing', { weight: 2 }),
    row('benefits', 'comp', ['Benefits administration', 'Gestión de beneficios', 'Gestão de benefícios'], 'missing'),
    row('time-tracking', 'comp', ['Time tracking and timesheets', 'Control horario', 'Controle de ponto'], 'missing'),
    // Reportes
    row('reports', 'reports', ['Headcount, turnover, time off and tenure', 'Dotación, rotación, licencias y antigüedad', 'Quadro, rotatividade, folgas e tempo de casa'], 'have', {
      detail: ['Fixed reports with 12 months of hires and exits', 'Reportes fijos con 12 meses de ingresos y salidas', 'Relatórios fixos com 12 meses de admissões e saídas'],
    }),
    row('custom-reports', 'reports', ['Custom report builder', 'Reportes a medida', 'Relatórios personalizados'], 'missing'),
    // Acceso y privacidad
    row('roles', 'security', ['HR, manager and employee roles', 'Roles HR, manager y empleado', 'Papéis RH, gestor e colaborador'], 'have', {
      detail: ['On top of the workspace roles: HR admins, managers by reporting line, employees', 'Encima de los roles del workspace: HR admins, managers por línea de reporte, empleados', 'Acima dos papéis do workspace: admins de RH, gestores pela linha de reporte, colaboradores'],
    }),
    row('custom-access-levels', 'security', ['Custom access levels', 'Niveles de acceso a medida', 'Níveis de acesso personalizados'], 'partial', {
      detail: ['Three fixed roles plus field visibility; no custom permission groups', 'Tres roles fijos más la visibilidad por campo; sin grupos de permisos a medida', 'Três papéis fixos mais a visibilidade por campo; sem grupos de permissão personalizados'],
    }),
    row('audit', 'security', ['Audit log of sensitive data', 'Registro de datos sensibles', 'Registro de dados sensíveis'], 'have', {
      detail: [
        'Views and changes of salaries (and the payroll export), personal data, sensitive custom fields, documents and exit interviews, plus views of someone else\'s reviews and goals, with who, when and from where (app, API or assistant). Time off is not logged',
        'Vistas y cambios de sueldos (y el export de nómina), datos personales, campos propios sensibles, documentos y entrevistas de salida, más las vistas de evaluaciones y objetivos ajenos, con quién, cuándo y desde dónde (app, API o asistente). Las licencias no se registran',
        'Visualizações e mudanças de salários (e a exportação da folha), dados pessoais, campos personalizados sensíveis, documentos e entrevistas de desligamento, além das visualizações de avaliações e metas de outras pessoas, com quem, quando e de onde (app, API ou assistente). As folgas não são registradas',
      ],
    }),
    // Plataforma
    row('api', 'platform', ['API', 'API', 'API'], 'partial', {
      detail: ['Session API for every screen and a read-only v1 directory endpoint (people:read) with public fields only', 'API de sesión para cada pantalla y un endpoint v1 de solo lectura del directorio (people:read) con campos públicos', 'API de sessão para cada tela e um endpoint v1 somente leitura do diretório (people:read) com campos públicos'],
    }),
    row('automations', 'platform', ['Automations on HR events', 'Automatizaciones con eventos de RR. HH.', 'Automações com eventos de RH'], 'have', {
      detail: ['Flow triggers for hire, approved time off and offboarding, only for flows built by HR', 'Disparadores de Flow para ingreso, licencia aprobada y salida, solo en flows armados por HR', 'Gatilhos do Flow para admissão, folga aprovada e desligamento, só em flows criados pelo RH'],
    }),
    row('assistant', 'platform', ['AI assistant', 'Asistente con IA', 'Assistente com IA'], 'have', {
      detail: [
        'Who is out, own balances, pending approvals and the directory (public fields); requests and approvals with confirmation. Salary amounts reach the model only when a person asks for their own: HR asking about someone else gets a link to the profile, and everyone else gets an error',
        'Quién está fuera, saldos propios, pendientes de aprobación y el directorio (campos públicos); pide y aprueba con confirmación. Un monto de sueldo llega al modelo solo cuando una persona pregunta por el suyo: HR que pregunta por otra persona recibe el link a la ficha y el resto, un error',
        'Quem está fora, saldos próprios, aprovações pendentes e o diretório (campos públicos); pede e aprova com confirmação. Um valor de salário só chega ao modelo quando a pessoa pergunta pelo próprio: o RH que pergunta por outra pessoa recebe o link do perfil e os demais, um erro',
      ],
    }),
    row('import', 'platform', ['Import from a spreadsheet or another HRIS', 'Importar de planilla u otro sistema', 'Importar de planilha ou outro sistema'], 'missing'),
    row('mobile', 'platform', ['Mobile app', 'App móvil', 'App móvel'], 'partial', {
      detail: ['Works in the mobile browser at 390px; no native app', 'Funciona en el navegador del celular a 390 px; sin app nativa', 'Funciona no navegador do celular a 390 px; sem app nativo'],
    }),
    row('ats', 'platform', ['Applicant tracking', 'Búsquedas y candidatos', 'Recrutamento'], 'missing', {
      detail: ['Out of People on purpose: Hiring (Workable) is a separate app', 'Afuera de People a propósito: Hiring (Workable) es otra app', 'Fora do People de propósito: Hiring (Workable) é outro app'],
    }),
  ],
};

export default parity;
