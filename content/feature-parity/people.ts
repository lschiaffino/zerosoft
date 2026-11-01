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
  lastReviewed: '2026-11-01',
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
    row('change-approvals', 'records', ['Approval of profile changes', 'Aprobación de cambios en la ficha', 'Aprovação de mudanças no perfil'], 'have', {
      detail: ['Off by default. When on, changes to your own phone and personal data wait for HR, who sees before and after, approves or declines. Pronouns and bio apply at once. One step, decided by anyone in HR', 'Apagada por defecto. Encendida, los cambios de teléfono y datos personales propios esperan a HR, que ve el antes y el después y aprueba o rechaza. Pronombres y bio se aplican al momento. Un solo paso, lo decide cualquiera de HR', 'Desligada por padrão. Ligada, alterações de telefone e dados pessoais próprios esperam o RH, que vê o antes e o depois e aprova ou recusa. Pronomes e bio se aplicam na hora. Uma só etapa, decidida por qualquer pessoa do RH'],
    }),
    row('employee-history', 'records', ['Job and status history', 'Historial de puesto y estado', 'Histórico de cargo e status'], 'have', {
      detail: ['Salary history, plus a job history tab: job title, department, location, manager, type and status, each with date and author. Changes made before this release are not in it. Future-dated changes are a separate row', 'Historial de sueldo y una pestaña de historial: puesto, área, ubicación, manager, tipo y estado, cada uno con fecha y autor. Lo cambiado antes de esta versión no figura. Los cambios a futuro son otra fila', 'Histórico de salário e uma aba de histórico: cargo, departamento, localização, manager, tipo e status, cada um com data e autor. O que mudou antes desta versão não aparece. Alterações futuras são outra linha'],
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
    row('celebrations', 'org', ['Birthdays and work anniversaries feed', 'Cumpleaños y aniversarios', 'Aniversários e tempo de casa'], 'have', {
      detail: ['Birthdays and work anniversaries of the next 30 days above the directory, following the visibility settings; birth year never shown. No automatic posts or emails', 'Cumpleaños y aniversarios de los próximos 30 días arriba del directorio, según la visibilidad de Ajustes; nunca el año de nacimiento. Sin publicaciones ni emails automáticos', 'Aniversários e tempo de casa dos próximos 30 dias acima do diretório, conforme a visibilidade em Ajustes; nunca o ano de nascimento. Sem publicações nem emails automáticos'],
    }),
    // Licencias
    row('pto-policies', 'timeoff', ['Time off policies per type', 'Políticas de licencia por tipo', 'Políticas de folga por tipo'], 'have', {
      weight: 2,
      detail: ['Vacation, sick, personal and other policies, each with its own accrual, carryover and cap', 'Vacaciones, enfermedad, personales y otras, cada una con su devengamiento, arrastre y tope', 'Férias, licença médica, pessoais e outras, cada uma com seu acúmulo, transferência e limite'],
    }),
    row('accrual', 'timeoff', ['Accrual rules', 'Reglas de devengamiento', 'Regras de acúmulo'], 'have', {
      weight: 2,
      detail: ['Yearly (prorated the first year), monthly or per pay period, carryover limit, balance cap, more days with tenure (years=days per policy) and who each policy applies to by department, location, country and type', 'Anual (prorrateado el primer año), mensual o por período de pago, tope de arrastre, saldo máximo, más días con la antigüedad (años=días por política) y a quién le corresponde cada política por área, ubicación, país y tipo', 'Anual (proporcional no primeiro ano), mensal ou por período de pagamento, limite de transferência, saldo máximo, mais dias com o tempo de casa (anos=dias por política) e para quem vale cada política por departamento, localização, país e tipo'],
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
      detail: ['In-app notifications and a short email to the approver and the requester, with no dates or type in the email. Email delivery checked only against the local capture, not a real inbox. No Slack digests', 'Avisos en la app y un email corto a quien aprueba y a quien pide, sin fechas ni tipo en el email. El envío se probó solo contra la captura local, no con una casilla real. Sin resúmenes en Slack', 'Avisos no app e um email curto a quem aprova e a quem pede, sem datas nem tipo no email. O envio foi testado só com a captura local, não com uma caixa real. Sem resumos no Slack'],
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
      detail: ['HR adds the person before they join, or Hiring adds them on hire, and the profile links when they accept the invite. No separate packet or form to fill', 'HR carga a la persona antes de que entre, o Hiring la carga al contratar, y la ficha se enlaza cuando acepta la invitación. Sin paquete ni formulario aparte', 'O RH adiciona a pessoa antes da entrada, ou o Hiring adiciona ao contratar, e o perfil se vincula quando ela aceita o convite. Sem pacote nem formulário à parte'],
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
    row('esign', 'documents', ['E-signature', 'Firma electrónica', 'Assinatura eletrônica'], 'partial', {
      weight: 2,
      detail: ['With the Sign app: from the Documents tab HR opens a new envelope and sends it. The signed copy stays in Sign, not on the profile, and the document is not prefilled. Without Sign, read confirmations', 'Con la app Sign: desde Documentos, HR abre un sobre nuevo y lo envía. La copia firmada queda en Sign, no en la ficha, y el documento no viene precargado. Sin Sign, confirmación de lectura', 'Com o app Sign: em Documentos, o RH abre um envelope novo e envia. A cópia assinada fica no Sign, não no perfil, e o documento não vem preenchido. Sem Sign, confirmação de leitura'],
    }),
    // Desempeño
    row('review-cycles', 'performance', ['Review cycles', 'Ciclos de evaluación', 'Ciclos de avaliação'], 'have', {
      weight: 2,
      detail: ['Self, manager and peer reviews with text and 1 to 5 questions; the person sees the manager review when the cycle closes', 'Autoevaluación, del manager y de pares con preguntas de texto y de 1 a 5; la persona ve la del manager al cerrar el ciclo', 'Autoavaliação, do gestor e de pares com perguntas de texto e de 1 a 5; a pessoa vê a do gestor quando o ciclo fecha'],
    }),
    row('peer-picking', 'performance', ['Choosing peer reviewers', 'Elegir quién evalúa como par', 'Escolher quem avalia como par'], 'have', {
      detail: ['Up to two peers who share the manager are added on launch, and HR or the manager chain adds or removes others while the cycle is active. People cannot nominate themselves', 'Al lanzar se suman hasta dos pares que comparten manager, y HR o la cadena de managers suman o sacan otros mientras el ciclo está activo. Cada persona no puede proponer los suyos', 'Ao lançar entram até dois pares com o mesmo manager, e o RH ou a cadeia de managers adiciona ou remove outros enquanto o ciclo está ativo. A própria pessoa não indica os seus'],
    }),
    row('goals', 'performance', ['Goals with progress', 'Objetivos con avance', 'Metas com progresso'], 'have'),
    row('one-on-ones', 'performance', ['1:1 notes', 'Notas 1:1', 'Notas 1:1'], 'have', {
      detail: ['Private to the two people, not even HR', 'Privadas entre las dos personas, ni HR las ve', 'Privadas entre as duas pessoas, nem o RH vê'],
    }),
    row('surveys', 'performance', ['Employee satisfaction surveys (eNPS)', 'Encuestas de satisfacción (eNPS)', 'Pesquisas de satisfação (eNPS)'], 'have', {
      detail: ['eNPS opened by HR: a 0 to 10 answer and a comment, once per person. Who answered and what they said are stored apart, the answer has no time, and results show from 3 answers and only to HR. No benchmarks or AI analysis', 'eNPS abierto por HR: una respuesta de 0 a 10 y un comentario, una vez por persona. Quién respondió y qué dijo se guardan por separado, la respuesta no tiene hora y el resultado se ve desde 3 respuestas y solo para HR. Sin comparativas ni análisis con IA', 'eNPS aberto pelo RH: uma resposta de 0 a 10 e um comentário, uma vez por pessoa. Quem respondeu e o que disse ficam separados, a resposta não tem horário e o resultado aparece a partir de 3 respostas e só para o RH. Sem comparativos nem análise com IA'],
    }),
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
    row('custom-reports', 'reports', ['Custom report builder', 'Reportes a medida', 'Relatórios personalizados'], 'partial', {
      detail: ['Pick columns (custom fields too) and filters, see the list, download a CSV and save it. No grouping or charts. Salaries and personal data stay out', 'Elegís columnas (también campos propios) y filtros, ves la lista, bajás un CSV y la guardás. Sin agrupar ni gráficos. Sueldos y datos personales quedan afuera', 'Escolha colunas (inclusive campos próprios) e filtros, veja a lista, baixe um CSV e salve. Sem agrupar nem gráficos. Salários e dados pessoais ficam de fora'],
    }),
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
    row('import', 'platform', ['Import from a spreadsheet or another HRIS', 'Importar de planilla u otro sistema', 'Importar de planilha ou outro sistema'], 'have', {
      detail: ['CSV with a preview and an error per row. A known work email updates that profile, managers are set by email and nobody is invited or notified. Save an Excel sheet as CSV first. No direct import from another HRIS', 'CSV con vista previa y un error por fila. Un email de trabajo conocido actualiza esa ficha, los managers se ponen por email y no se invita ni se avisa a nadie. Un Excel hay que guardarlo como CSV. Sin importar directo de otro HRIS', 'CSV com prévia e um erro por linha. Um email de trabalho conhecido atualiza o perfil, os managers entram por email e ninguém é convidado nem avisado. Um Excel precisa ser salvo como CSV. Sem importar direto de outro HRIS'],
    }),
    row('mobile', 'platform', ['Mobile app', 'App móvil', 'App móvel'], 'partial', {
      detail: ['Works in the mobile browser at 390px; no native app', 'Funciona en el navegador del celular a 390 px; sin app nativa', 'Funciona no navegador do celular a 390 px; sem app nativo'],
    }),
    row('ats', 'platform', ['Applicant tracking', 'Búsquedas y candidatos', 'Recrutamento'], 'missing', {
      detail: ['Out of People on purpose: Hiring (Workable) is a separate app', 'Afuera de People a propósito: Hiring (Workable) es otra app', 'Fora do People de propósito: Hiring (Workable) é outro app'],
    }),
    row('home-inbox', 'platform', ['Home with what is waiting for you', 'Inicio con lo que te espera', 'Início com o que espera por você'], 'have', {
      weight: 2,
      detail: ['Above the directory: time off to approve, profile changes, tasks, reviews, surveys and documents, each counted by its own permissions', 'Arriba del directorio: licencias para aprobar, cambios de datos, tareas, evaluaciones, encuestas y documentos, cada uno contado con sus permisos', 'Acima do diretório: folgas para aprovar, alterações de dados, tarefas, avaliações, pesquisas e documentos, cada um contado com suas permissões'],
    }),
    row('future-dated-changes', 'records', ['Job and pay changes with a future date', 'Cambios de puesto y sueldo con fecha futura', 'Alterações de cargo e salário com data futura'], 'have', {
      weight: 2,
      detail: ['HR schedules job title, department, location, manager or type for a future date and the hourly job applies it. Only HR sees it until then. Salary entries already take a future effective date', 'HR agenda puesto, área, ubicación, manager o tipo para una fecha futura y el proceso de cada hora lo aplica. Hasta entonces lo ve solo HR. Los sueldos ya aceptan una fecha futura', 'O RH agenda cargo, departamento, localização, manager ou tipo para uma data futura e o processo de cada hora aplica. Até lá, só o RH vê. Os salários já aceitam uma data futura'],
    }),
    row('custom-approvals', 'records', ['Custom approval workflows', 'Flujos de aprobación a medida', 'Fluxos de aprovação personalizados'], 'missing'),
    row('bulk-edit', 'records', ['Bulk edit', 'Edición masiva', 'Edição em massa'], 'partial', {
      detail: ['Through the CSV import: a known work email updates that profile. No editing grid', 'Con la importación CSV: un email de trabajo conocido actualiza esa ficha. Sin grilla de edición', 'Pela importação CSV: um email de trabalho conhecido atualiza o perfil. Sem grade de edição'],
    }),
    row('point-in-time-report', 'reports', ['Reports as of a past date', 'Reportes a una fecha pasada', 'Relatórios em uma data passada'], 'missing'),
    row('custom-dashboards', 'reports', ['Custom dashboards and benchmarks', 'Tableros a medida y comparativas', 'Painéis personalizados e comparativos'], 'missing'),
    row('levels-bands', 'comp', ['Job levels and pay bands', 'Niveles de puesto y bandas salariales', 'Níveis de cargo e faixas salariais'], 'missing'),
    row('comp-planning', 'comp', ['Compensation planning cycles', 'Ciclos de planificación salarial', 'Ciclos de planejamento salarial'], 'missing'),
    row('total-rewards', 'comp', ['Total rewards statements', 'Resúmenes de compensación total', 'Demonstrativos de remuneração total'], 'missing'),
    row('recognition-rewards', 'performance', ['Peer recognition and rewards', 'Reconocimientos y premios entre pares', 'Reconhecimento e prêmios entre pares'], 'missing'),
    row('wellbeing-survey', 'performance', ['Well-being survey', 'Encuesta de bienestar', 'Pesquisa de bem-estar'], 'missing'),
    row('feedback-ai-summary', 'performance', ['AI summaries of feedback', 'Resúmenes de feedback con IA', 'Resumos de feedback com IA'], 'missing'),
    row('company-community', 'platform', ['Company announcements hub', 'Centro de anuncios de la empresa', 'Central de comunicados da empresa'], 'missing'),
  ],
};

export default parity;
