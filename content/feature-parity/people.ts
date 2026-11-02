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
  lastReviewed: '2026-11-02',
  percentHidden: { note: loc(['This table lists everything BambooHR documents, feature by feature, including payroll, benefits, time tracking and global employment, so a percentage would not compare with other apps. Rows count as done only after being used end to end in a browser.', 'Esta tabla lista todo lo que BambooHR documenta, función por función, con nómina, beneficios, registro de horas y empleo global, así que un porcentaje no se compara con otras apps. Una fila cuenta como hecha solo después de usarla de punta a punta en el navegador.', 'Esta tabela lista tudo o que o BambooHR documenta, função por função, com folha, benefícios, registro de horas e emprego global, então uma porcentagem não se compara com outros apps. Uma linha conta como pronta só depois de usada de ponta a ponta no navegador.']) },
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
    { id: 'payroll', label: loc(['Payroll', 'Nómina', 'Folha de pagamento']) },
    { id: 'time', label: loc(['Time tracking', 'Registro de horas', 'Registro de horas']) },
    { id: 'benefits', label: loc(['Benefits', 'Beneficios', 'Benefícios']) },
    { id: 'compliance', label: loc(['Compliance', 'Cumplimiento', 'Conformidade']) },
    { id: 'global', label: loc(['Global employment', 'Empleo global', 'Emprego global']) },
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
    row('accrual', 'timeoff', ['Accrual rules', 'Reglas de devengamiento', 'Regras de acúmulo'], 'partial', {
      weight: 2,
      detail: ['Yearly, monthly or per pay period, carryover limit, balance cap, tenure levels and policies by department, location, country and type. Scope was used in a browser; accrual, carryover and tenure balances are tested against the database only', 'Anual, mensual o por período de pago, tope de arrastre, saldo máximo, niveles por antigüedad y políticas por área, ubicación, país y tipo. El alcance se usó en el navegador; devengo, arrastre y antigüedad están probados solo contra la base', 'Anual, mensal ou por período de pagamento, limite de transferência, saldo máximo, níveis por tempo de casa e políticas por departamento, localização, país e tipo. O alcance foi usado no navegador; acúmulo, transferência e tempo de casa estão testados só contra o banco'],
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
    row('future-dated-changes', 'records', ['Job and pay changes with a future date', 'Cambios de puesto y sueldo con fecha futura', 'Alterações de cargo e salário com data futura'], 'partial', {
      weight: 2,
      detail: ['HR schedules job title, department, location, manager or type for a future date from the profile. The hourly job that applies it is tested against the database, not yet watched in a browser on a real date', 'HR agenda puesto, área, ubicación, manager o tipo para una fecha futura desde la ficha. El proceso de cada hora que lo aplica está probado contra la base, todavía no visto en el navegador en una fecha real', 'O RH agenda cargo, departamento, localização, manager ou tipo para uma data futura pelo perfil. O processo de cada hora que aplica está testado contra o banco, ainda não visto no navegador em uma data real'],
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
    // Del benchmark completo: docs/benchmark/people.md
    row('emergency-contacts', 'records', ['Emergency contacts', 'Contactos de emergencia', 'Contatos de emergência'], 'missing'),
    row('custom-tabs', 'records', ['Custom profile tabs', 'Pestañas personalizadas', 'Abas personalizadas no perfil'], 'missing'),
    row('custom-tables', 'records', ['Custom tables with rows', 'Tablas personalizadas', 'Tabelas personalizadas com linhas'], 'missing'),
    row('multi-level-approvals', 'records', ['Multi-level approvals', 'Aprobaciones en varios niveles', 'Aprovações em vários níveis'], 'missing'),
    row('employee-notes', 'records', ['Employee notes', 'Notas sobre el empleado', 'Notas sobre o colaborador'], 'missing'),
    row('training-tracking', 'records', ['Training tracking', 'Seguimiento de capacitaciones', 'Acompanhamento de treinamentos'], 'missing'),
    row('termination-tracking', 'records', ['Termination records', 'Registro de terminaciones', 'Registro de desligamentos'], 'partial', {
      detail: ['Offboarding, end date and exit interview. Built; not yet walked end to end in a browser for each role', 'Offboarding, fecha de salida y entrevista de salida. Construido; falta recorrerlo de punta a punta en el navegador con cada rol', 'Desligamento, data de saída e entrevista de saída. Construído; falta percorrer de ponta a ponta no navegador com cada papel'],
    }),
    row('rehire', 'records', ['Rehire', 'Recontratación', 'Recontratação'], 'partial', {
      detail: ['Rejoining the workspace reactivates the profile. Built; not yet walked end to end in a browser for each role', 'Volver al workspace reactiva la ficha. Construido; falta recorrerlo de punta a punta en el navegador con cada rol', 'Voltar ao workspace reativa o perfil. Construído; falta percorrer de ponta a ponta no navegador com cada papel'],
    }),
    row('data-hygiene', 'records', ['Data hygiene widget', 'Widget de higiene de datos (beta)', 'Widget de qualidade dos dados'], 'missing'),
    row('directory-timezones', 'org', ['Local time zones in the directory', 'Hora local en el directorio', 'Fuso horário local no diretório'], 'missing'),
    row('directory-export', 'org', ['Directory export', 'Exportar directorio', 'Exportar diretório'], 'partial', {
      detail: ['Through a custom report CSV, for HR. Built; not yet walked end to end in a browser for each role', 'Con el CSV de un reporte a medida, para HR. Construido; falta recorrerlo de punta a punta en el navegador con cada rol', 'Pelo CSV de um relatório personalizado, para o RH. Construído; falta percorrer de ponta a ponta no navegador com cada papel'],
    }),
    row('ooo-in-directory', 'org', ['Out of office shown in the directory', 'Ausencia visible en el directorio', 'Ausência visível no diretório'], 'missing'),
    row('birthday-opt-out', 'org', ['Hide your own birthday', 'Ocultar el propio cumpleaños', 'Ocultar o próprio aniversário'], 'missing'),
    row('pto-policy-scope', 'timeoff', ['Policies per segment or person', 'Políticas por segmento o persona', 'Políticas por segmento ou pessoa'], 'have', {
      detail: ['By department, location, country and type, from Settings. Not per individual person', 'Por área, ubicación, país y tipo, desde Ajustes. No por persona individual', 'Por departamento, localização, país e tipo, em Ajustes. Não por pessoa individual'],
    }),
    row('leave-types', 'timeoff', ['Leave types', 'Tipos de licencia', 'Tipos de licença'], 'partial', {
      detail: ['Vacation, sick, personal and other as policy kinds. Built; not yet walked end to end in a browser for each role', 'Vacaciones, enfermedad, personal y otro como tipos de política. Construido; falta recorrerlo de punta a punta en el navegador con cada rol', 'Férias, doença, pessoal e outro como tipos de política. Construído; falta percorrer de ponta a ponta no navegador com cada papel'],
    }),
    row('flexible-policies', 'timeoff', ['Flexible or unlimited policies', 'Políticas flexibles o ilimitadas', 'Políticas flexíveis ou ilimitadas'], 'missing'),
    row('manual-policies', 'timeoff', ['Manually updated policies', 'Políticas de actualización manual', 'Políticas com atualização manual'], 'partial', {
      detail: ['An accrual of none plus manual adjustments. Built; not yet walked end to end in a browser for each role', 'Sin devengo más ajustes manuales. Construido; falta recorrerlo de punta a punta en el navegador con cada rol', 'Sem acúmulo mais ajustes manuais. Construído; falta percorrer de ponta a ponta no navegador com cada papel'],
    }),
    row('accrual-front-load', 'timeoff', ['Front-loaded annual allotment', 'Asignación anticipada anual', 'Concessão anual antecipada'], 'partial', {
      detail: ['Annual accrual credits on January 1. Built; not yet walked end to end in a browser for each role', 'El devengo anual acredita el 1 de enero. Construido; falta recorrerlo de punta a punta en el navegador con cada rol', 'O acúmulo anual credita em 1º de janeiro. Construído; falta percorrer de ponta a ponta no navegador com cada papel'],
    }),
    row('tenure-milestones', 'timeoff', ['Tenure milestones', 'Hitos de antigüedad', 'Marcos de tempo de casa'], 'partial', {
      detail: ['HR sets more days from a given year per policy in Settings. The resulting balance is tested against the database, not yet checked on a long-tenure person in a browser', 'HR pone más días desde un año por política en Ajustes. El saldo resultante está probado contra la base, todavía no visto en el navegador con alguien de mucha antigüedad', 'O RH define mais dias a partir de um ano por política em Ajustes. O saldo resultante está testado contra o banco, ainda não visto no navegador com alguém de muito tempo de casa'],
    }),
    row('carryover', 'timeoff', ['Carryover', 'Arrastre al año siguiente', 'Saldo transferido para o ano seguinte'], 'partial', {
      detail: ['A carryover limit per policy. Built; not yet walked end to end in a browser for each role', 'Tope de arrastre por política. Construido; falta recorrerlo de punta a punta en el navegador con cada rol', 'Limite de transferência por política. Construído; falta percorrer de ponta a ponta no navegador com cada papel'],
    }),
    row('balance-cap', 'timeoff', ['Balance cap', 'Tope de saldo', 'Limite de saldo'], 'partial', {
      detail: ['A balance cap per policy. Built; not yet walked end to end in a browser for each role', 'Saldo máximo por política. Construido; falta recorrerlo de punta a punta en el navegador con cada rol', 'Saldo máximo por política. Construído; falta percorrer de ponta a ponta no navegador com cada papel'],
    }),
    row('pto-cancel', 'timeoff', ['Edit or cancel a request', 'Editar o cancelar un pedido', 'Editar ou cancelar um pedido'], 'partial', {
      detail: ['Cancel, but not edit, a request. Built; not yet walked end to end in a browser for each role', 'Cancelar un pedido, no editarlo. Construido; falta recorrerlo de punta a punta en el navegador con cada rol', 'Cancelar um pedido, não editar. Construído; falta percorrer de ponta a ponta no navegador com cada papel'],
    }),
    row('holidays-by-location', 'timeoff', ['Holidays per location', 'Feriados por ubicación', 'Feriados por local'], 'partial', {
      detail: ['Per country, not per location. Built; not yet walked end to end in a browser for each role', 'Por país, no por ubicación. Construido; falta recorrerlo de punta a punta en el navegador con cada rol', 'Por país, não por localização. Construído; falta percorrer de ponta a ponta no navegador com cada papel'],
    }),
    row('special-leave', 'timeoff', ['Regional leave types', 'Licencias especiales regionales', 'Licenças regionais especiais'], 'missing'),
    row('pto-calendar', 'timeoff', ['Time off calendar', 'Calendario de ausencias', 'Calendário de ausências'], 'partial', {
      detail: ['Team calendar in Time off. Built; not yet walked end to end in a browser for each role', 'Calendario del equipo en Licencias. Construido; falta recorrerlo de punta a punta en el navegador con cada rol', 'Calendário da equipe em Folgas. Construído; falta percorrer de ponta a ponta no navegador com cada papel'],
    }),
    row('balance-adjustments', 'timeoff', ['Manual balance adjustments', 'Ajustes manuales de saldo', 'Ajustes manuais de saldo'], 'partial', {
      detail: ['HR adjusts a balance on the profile. Built; not yet walked end to end in a browser for each role', 'HR ajusta el saldo en la ficha. Construido; falta recorrerlo de punta a punta en el navegador con cada rol', 'O RH ajusta o saldo no perfil. Construído; falta percorrer de ponta a ponta no navegador com cada papel'],
    }),
    row('accrual-calculator', 'timeoff', ['Future balance calculator', 'Calculadora de saldo futuro', 'Calculadora de saldo futuro'], 'missing'),
    row('pto-mobile', 'timeoff', ['Time off in the mobile app', 'Tiempo libre en la app móvil', 'Ausências no app móvel'], 'missing'),
    row('pto-payroll-sync', 'timeoff', ['Time off sync to payroll', 'Sincronización de ausencias con payroll', 'Sincronização de ausências com a folha'], 'missing'),
    row('onboarding-custom-tasks', 'onboarding', ['Custom onboarding tasks', 'Tareas de onboarding propias', 'Tarefas de onboarding personalizadas'], 'partial', {
      detail: ['Tasks in templates. Built; not yet walked end to end in a browser for each role', 'Tareas en plantillas. Construido; falta recorrerlo de punta a punta en el navegador con cada rol', 'Tarefas em modelos. Construído; falta percorrer de ponta a ponta no navegador com cada papel'],
    }),
    row('first-day-details', 'onboarding', ['First-day details', 'Datos del primer día', 'Dados do primeiro dia'], 'partial', {
      detail: ['Welcome page with manager, team and first tasks. Built; not yet walked end to end in a browser for each role', 'Página de bienvenida con manager, equipo y primeras tareas. Construido; falta recorrerlo de punta a punta en el navegador con cada rol', 'Página de boas-vindas com gestor, equipe e primeiras tarefas. Construído; falta percorrer de ponta a ponta no navegador com cada papel'],
    }),
    row('new-hire-packet', 'onboarding', ['New hire packet', 'Paquete de ingreso (New Hire Packet)', 'Pacote de admissão'], 'missing'),
    row('self-onboarding', 'onboarding', ['Self-onboarding', 'Auto-onboarding', 'Auto-onboarding'], 'missing'),
    row('ats-prefill', 'onboarding', ['Prefill from applicant tracking', 'Prellenado desde el ATS', 'Preenchimento a partir do ATS'], 'have', {
      detail: ['A hire in Hiring becomes a profile in onboarding with job, department and start date, if the workspace uses People', 'Una contratación en Hiring queda como ficha en onboarding con puesto, área e inicio, si el workspace usa People', 'Uma contratação no Hiring vira perfil em onboarding com cargo, departamento e início, se o workspace usa o People'],
    }),
    row('onboarding-reminders', 'onboarding', ['Onboarding reminders', 'Recordatorios de onboarding', 'Lembretes de onboarding'], 'missing'),
    row('onboarding-progress', 'onboarding', ['Onboarding progress dashboard', 'Tablero de avance', 'Painel de progresso do onboarding'], 'partial', {
      detail: ['Progress per checklist, no dashboard. Built; not yet walked end to end in a browser for each role', 'Avance por checklist, sin tablero. Construido; falta recorrerlo de punta a punta en el navegador con cada rol', 'Progresso por checklist, sem painel. Construído; falta percorrer de ponta a ponta no navegador com cada papel'],
    }),
    row('i9-everify', 'onboarding', ['I-9 and E-Verify workflows', 'Flujos I-9 y E-Verify', 'Fluxos I-9 e E-Verify'], 'missing'),
    row('onboarding-background-checks', 'onboarding', ['Background checks', 'Verificación de antecedentes', 'Verificação de antecedentes'], 'missing'),
    row('document-folders', 'documents', ['Document folders', 'Carpetas de documentos', 'Pastas de documentos'], 'missing'),
    row('company-files', 'documents', ['Company files', 'Archivos de la empresa', 'Arquivos da empresa'], 'partial', {
      detail: ['Company policies and the handbook. Built; not yet walked end to end in a browser for each role', 'Políticas de la empresa y el manual. Construido; falta recorrerlo de punta a punta en el navegador con cada rol', 'Políticas da empresa e o manual. Construído; falta percorrer de ponta a ponta no navegador com cada papel'],
    }),
    row('file-sharing', 'documents', ['Share a file or make it private', 'Compartir o hacer privado un archivo', 'Compartilhar arquivo ou torná-lo privado'], 'partial', {
      detail: ['Share a document with the person or keep it HR only. Built; not yet walked end to end in a browser for each role', 'Compartir un documento con la persona o dejarlo solo para HR. Construido; falta recorrerlo de punta a punta en el navegador con cada rol', 'Compartilhar um documento com a pessoa ou deixar só para o RH. Construído; falta percorrer de ponta a ponta no navegador com cada papel'],
    }),
    row('employee-document-upload', 'documents', ['Document upload by the employee', 'Subida de documentos por el empleado', 'Envio de documentos pelo colaborador'], 'missing'),
    row('esign-templates', 'documents', ['Signature templates', 'Plantillas de firma', 'Modelos de assinatura'], 'missing'),
    row('esign-reminders', 'documents', ['Signature report and reminders', 'Reporte y recordatorios de firmas', 'Relatório e lembretes de assinatura'], 'missing'),
    row('document-status-report', 'documents', ['Onboarding document status report', 'Estado de documentos de ingreso', 'Relatório de status de documentos'], 'missing'),
    row('tax-documents', 'documents', ['Tax documents', 'Documentos impositivos', 'Documentos fiscais'], 'missing'),
    row('review-self', 'performance', ['Self-assessment', 'Autoevaluación', 'Autoavaliação'], 'partial', {
      detail: ['Self reviews in cycles. Built; not yet walked end to end in a browser for each role', 'Autoevaluaciones en ciclos. Construido; falta recorrerlo de punta a punta en el navegador con cada rol', 'Autoavaliações em ciclos. Construído; falta percorrer de ponta a ponta no navegador com cada papel'],
    }),
    row('review-manager', 'performance', ['Manager assessment', 'Evaluación del manager', 'Avaliação do gestor'], 'partial', {
      detail: ['Manager reviews in cycles. Built; not yet walked end to end in a browser for each role', 'Evaluaciones del manager en ciclos. Construido; falta recorrerlo de punta a punta en el navegador con cada rol', 'Avaliações do gestor em ciclos. Construído; falta percorrer de ponta a ponta no navegador com cada papel'],
    }),
    row('review-skip-level', 'performance', ['Skip-level review', 'Evaluación de skip-level', 'Avaliação skip-level'], 'missing'),
    row('review-segmentation', 'performance', ['Review segmentation', 'Segmentar revisiones', 'Segmentação de avaliações'], 'missing'),
    row('review-reminders', 'performance', ['Review reminders', 'Recordatorios de revisión', 'Lembretes de avaliação'], 'missing'),
    row('review-notifications', 'performance', ['Review completion alerts', 'Avisos de revisión completa', 'Alertas de avaliação concluída'], 'missing'),
    row('review-scheduling', 'performance', ['Review scheduling', 'Programar revisiones', 'Agendamento de avaliações'], 'missing'),
    row('goals-cascading', 'performance', ['Cascading goals', 'Objetivos en cascada', 'Metas em cascata'], 'missing'),
    row('goals-milestones', 'performance', ['Goal milestones and attachments', 'Hitos y adjuntos en objetivos', 'Marcos e anexos em metas'], 'missing'),
    row('goals-ai', 'performance', ['AI goal suggestions', 'Objetivos sugeridos por AI', 'Metas sugeridas por AI'], 'missing'),
    row('goals-report', 'performance', ['Goals status report', 'Reporte de estado de objetivos', 'Relatório de status de metas'], 'missing'),
    row('one-on-one-scheduling', 'performance', ['One-on-one scheduling', 'Agendar 1:1', 'Agendamento de 1:1'], 'missing'),
    row('performance-report', 'performance', ['Performance reports', 'Reportes de desempeño', 'Relatórios de desempenho'], 'missing'),
    row('growth-paths', 'performance', ['Growth paths', 'Trayectorias de crecimiento', 'Trilhas de crescimento'], 'missing'),
    row('enps-trend', 'performance', ['eNPS trend', 'Evolución del eNPS', 'Evolução do eNPS'], 'missing'),
    row('wellbeing-heatmap', 'performance', ['Well-being heatmap', 'Mapa de calor de bienestar', 'Mapa de calor de bem-estar'], 'missing'),
    row('recognition-values', 'performance', ['Recognition tied to company values', 'Reconocimiento por valores', 'Reconhecimento por valores da empresa'], 'missing'),
    row('recognition-private', 'performance', ['Public or private recognition', 'Reconocimiento público o privado', 'Reconhecimento público ou privado'], 'missing'),
    row('recognition-ai', 'performance', ['AI help for recognition', 'Ayuda de AI para reconocer', 'Ajuda de AI para reconhecimento'], 'missing'),
    row('recognition-history', 'performance', ['Recognition history', 'Historial de reconocimientos', 'Histórico de reconhecimentos'], 'missing'),
    row('rewards-points', 'performance', ['Points-based rewards', 'Recompensas por puntos', 'Recompensas por pontos'], 'missing'),
    row('rewards-catalog', 'performance', ['Rewards catalog', 'Catálogo de recompensas', 'Catálogo de recompensas'], 'missing'),
    row('payroll-sync', 'comp', ['Payroll data sync', 'Sincronización con payroll', 'Sincronização com a folha'], 'missing'),
    row('salary-benchmarking', 'comp', ['Salary benchmarking', 'Benchmark salarial', 'Benchmark salarial'], 'missing'),
    row('pay-visualization', 'comp', ['Pay visualization', 'Visualización de pagos', 'Visualização de remuneração'], 'missing'),
    row('comp-budget', 'comp', ['Compensation review budget', 'Presupuesto de revisión salarial', 'Orçamento de revisão salarial'], 'missing'),
    row('comp-worksheets', 'comp', ['Compensation worksheets', 'Planillas de compensación', 'Planilhas de remuneração'], 'missing'),
    row('comp-permissions', 'comp', ['Compensation cycle permissions', 'Permisos del ciclo', 'Permissões do ciclo de remuneração'], 'missing'),
    row('comp-currency', 'comp', ['Currency conversion in reviews', 'Conversión de moneda', 'Conversão de moeda'], 'missing'),
    row('comp-approvals', 'comp', ['Pay change approvals', 'Aprobación de cambios salariales', 'Aprovação de mudanças salariais'], 'missing'),
    row('comp-communications', 'comp', ['Pay change communications', 'Comunicación de cambios salariales', 'Comunicação de mudanças salariais'], 'missing'),
    row('payroll-tax-filing', 'payroll', ['Payroll tax filing', 'Presentación de impuestos', 'Declaração de impostos da folha'], 'missing'),
    row('payroll-direct-deposit', 'payroll', ['Direct deposit', 'Depósito directo', 'Depósito direto'], 'missing'),
    row('payroll-w2', 'payroll', ['W-2 forms', 'Formularios W-2', 'Formulários W-2'], 'missing'),
    row('payroll-paystubs', 'payroll', ['Pay stubs', 'Recibos de sueldo', 'Holerites'], 'missing'),
    row('payroll-self-service', 'payroll', ['Withholding and bank self-service', 'Datos fiscales y bancarios en autoservicio', 'Autosserviço de dados fiscais e bancários'], 'missing'),
    row('payroll-multi-rate', 'payroll', ['Multi-rate payroll', 'Varias tarifas', 'Folha com várias taxas'], 'missing'),
    row('payroll-prorate', 'payroll', ['Prorated pay', 'Pagos prorrateados', 'Pagamentos proporcionais'], 'missing'),
    row('payroll-garnishment', 'payroll', ['Wage garnishments', 'Embargos salariales', 'Penhoras salariais'], 'missing'),
    row('payroll-managed', 'payroll', ['Managed payroll', 'Payroll gestionado', 'Folha gerenciada'], 'missing'),
    row('payroll-reminders', 'payroll', ['Payroll reminders', 'Recordatorios de payroll', 'Lembretes da folha'], 'missing'),
    row('payroll-anomalies', 'payroll', ['Payroll anomaly detection', 'Detección de anomalías', 'Detecção de anomalias na folha'], 'missing'),
    row('payroll-run-compare', 'payroll', ['Payroll run comparison', 'Comparar corridas', 'Comparar execuções da folha'], 'missing'),
    row('payroll-audit', 'payroll', ['Payroll audit trail', 'Auditoría de payroll', 'Auditoria da folha'], 'missing'),
    row('accounting-sync', 'payroll', ['Accounting sync', 'Sincronización contable', 'Sincronização contábil'], 'missing'),
    row('journal-entries', 'payroll', ['Journal entries', 'Asientos contables', 'Lançamentos contábeis'], 'missing'),
    row('employment-verification', 'payroll', ['Employment and income verification', 'Verificación de empleo e ingresos', 'Verificação de emprego e renda'], 'missing'),
    row('on-demand-pay', 'payroll', ['On-demand pay', 'Pago a demanda', 'Pagamento sob demanda'], 'missing'),
    row('clock-in', 'time', ['Clock in and out', 'Marcar entrada y salida', 'Registro de entrada e saída'], 'missing'),
    row('time-geolocation', 'time', ['Geolocation on time records', 'Geolocalización', 'Geolocalização nos registros'], 'missing'),
    row('time-kiosk', 'time', ['Time kiosk and clocks', 'Kiosco y relojes', 'Quiosque e relógios de ponto'], 'missing'),
    row('time-projects', 'time', ['Project time and billable hours', 'Horas por proyecto', 'Horas por projeto e faturáveis'], 'missing'),
    row('timesheet-approvals', 'time', ['Timesheet approvals', 'Aprobación de hojas de horas', 'Aprovação de folhas de ponto'], 'missing'),
    row('timesheet-reminders', 'time', ['Timesheet reminders', 'Recordatorios de horas', 'Lembretes de folha de ponto'], 'missing'),
    row('timesheet-corrections', 'time', ['Timesheet corrections', 'Correcciones de horas', 'Correções de folha de ponto'], 'missing'),
    row('overtime', 'time', ['Overtime calculation', 'Cálculo de horas extra', 'Cálculo de horas extras'], 'missing'),
    row('overtime-custom', 'time', ['Custom overtime rules', 'Reglas de horas extra propias', 'Regras próprias de horas extras'], 'missing'),
    row('shift-differentials', 'time', ['Shift differentials', 'Diferenciales por turno', 'Adicionais por turno'], 'missing'),
    row('shift-scheduling', 'time', ['Shift scheduling', 'Programación de turnos', 'Escala de turnos'], 'missing'),
    row('breaks', 'time', ['Meal and rest breaks', 'Pausas de comida y descanso', 'Pausas de refeição e descanso'], 'missing'),
    row('manager-team-view', 'time', ['Manager team view for time', 'Vista de equipo del manager', 'Visão de equipe do gestor'], 'missing'),
    row('timesheet-export', 'time', ['Timesheet export', 'Exportar hojas de horas', 'Exportar folhas de ponto'], 'missing'),
    row('time-payroll-sync', 'time', ['Time sync to payroll', 'Horas a BambooHR Payroll', 'Sincronização de horas com a folha'], 'missing'),
    row('benefits-tracking', 'benefits', ['Benefits tracking', 'Registro de beneficios', 'Acompanhamento de benefícios'], 'missing'),
    row('benefits-config', 'benefits', ['Guided benefits setup', 'Configuración guiada', 'Configuração guiada de benefícios'], 'missing'),
    row('benefits-self-enrollment', 'benefits', ['Benefits self-enrollment', 'Autoinscripción', 'Autoinscrição em benefícios'], 'missing'),
    row('benefits-open-enrollment', 'benefits', ['Open enrollment', 'Inscripción abierta', 'Inscrição aberta'], 'missing'),
    row('benefits-new-hire', 'benefits', ['New hire benefit elections', 'Elecciones de nuevos ingresos', 'Escolhas de benefícios na admissão'], 'missing'),
    row('benefits-life-events', 'benefits', ['Life events', 'Eventos de vida', 'Eventos de vida'], 'missing'),
    row('benefits-approval', 'benefits', ['Benefit election review and approval', 'Revisión y aprobación de elecciones', 'Revisão e aprovação de escolhas'], 'missing'),
    row('benefits-plan-types', 'benefits', ['Benefit plan types', 'Tipos de plan', 'Tipos de plano de benefício'], 'missing'),
    row('benefits-carriers', 'benefits', ['Carrier connections', 'Conexión con aseguradoras', 'Conexão com seguradoras'], 'missing'),
    row('benefits-broker', 'benefits', ['Broker access', 'Acceso para corredores', 'Acesso para corretores'], 'missing'),
    row('benefits-export', 'benefits', ['Enrollment export', 'Exportar inscripciones', 'Exportar inscrições'], 'missing'),
    row('benefits-deductions', 'benefits', ['Benefit deductions in payroll', 'Deducciones a payroll', 'Deduções de benefícios na folha'], 'missing'),
    row('benefits-notifications', 'benefits', ['Benefits notifications', 'Avisos de beneficios', 'Avisos de benefícios'], 'missing'),
    row('benefits-esign', 'benefits', ['Signatures on enrollment', 'Firma en inscripción', 'Assinatura na inscrição'], 'missing'),
    row('retirement-401k', 'benefits', ['Embedded 401(k)', 'Plan 401(k) integrado', 'Plano 401(k) integrado'], 'missing'),
    row('turnover-report', 'reports', ['Turnover report', 'Reporte de rotación', 'Relatório de rotatividade'], 'partial', {
      detail: ['Turnover over 12 months in Reports. Built; not yet walked end to end in a browser for each role', 'Rotación de 12 meses en Reportes. Construido; falta recorrerlo de punta a punta en el navegador con cada rol', 'Rotatividade de 12 meses em Relatórios. Construído; falta percorrer de ponta a ponta no navegador com cada papel'],
    }),
    row('time-off-report', 'reports', ['Time off report', 'Reporte de ausencias', 'Relatório de ausências'], 'partial', {
      detail: ['Days and requests per policy for the year. Built; not yet walked end to end in a browser for each role', 'Días y pedidos por política en el año. Construido; falta recorrerlo de punta a punta en el navegador con cada rol', 'Dias e pedidos por política no ano. Construído; falta percorrer de ponta a ponta no navegador com cada papel'],
    }),
    row('report-organize', 'reports', ['Report favorites and folders', 'Favoritos y carpetas de reportes', 'Favoritos e pastas de relatórios'], 'partial', {
      detail: ['Saved reports, no favorites or folders. Built; not yet walked end to end in a browser for each role', 'Reportes guardados, sin favoritos ni carpetas. Construido; falta recorrerlo de punta a punta en el navegador con cada rol', 'Relatórios salvos, sem favoritos nem pastas. Construído; falta percorrer de ponta a ponta no navegador com cada papel'],
    }),
    row('report-sharing', 'reports', ['Report sharing', 'Compartir reportes', 'Compartilhar relatórios'], 'missing'),
    row('instant-reporting', 'reports', ['Instant reporting', 'Reportes instantáneos', 'Relatórios instantâneos'], 'missing'),
    row('compliance-reporting', 'reports', ['Compliance reports', 'Reportes de cumplimiento', 'Relatórios de conformidade'], 'missing'),
    row('dashboard-templates', 'reports', ['Dashboard templates', 'Plantillas de dashboards', 'Modelos de painéis'], 'missing'),
    row('dashboard-charts', 'reports', ['Chart types and layout', 'Tipos de gráfico', 'Tipos de gráfico e layout'], 'missing'),
    row('dashboard-formulas', 'reports', ['Custom formulas', 'Fórmulas propias', 'Fórmulas personalizadas'], 'missing'),
    row('dashboard-sharing', 'reports', ['Dashboard sharing with permissions', 'Compartir dashboards con permisos', 'Compartilhar painéis com permissões'], 'missing'),
    row('dashboard-export', 'reports', ['Dashboard export', 'Exportar dashboards', 'Exportar painéis'], 'missing'),
    row('hr-benchmarks', 'reports', ['HR benchmarks', 'Benchmarks de RR. HH.', 'Benchmarks de RH'], 'missing'),
    row('mfa', 'security', ['Two-step login', 'Login en dos pasos', 'Login em duas etapas'], 'partial', {
      detail: ['Two-step login exists across the app. Built; not yet walked end to end in a browser for each role', 'El login en dos pasos existe en toda la app. Construido; falta recorrerlo de punta a punta en el navegador con cada rol', 'O login em duas etapas existe em todo o app. Construído; falta percorrer de ponta a ponta no navegador com cada papel'],
    }),
    row('passkeys', 'security', ['Passkeys', 'Passkeys', 'Passkeys'], 'missing'),
    row('sso-saml', 'security', ['SSO with SAML', 'SSO con SAML', 'SSO com SAML'], 'missing'),
    row('sso-google', 'security', ['Google single sign-on', 'SSO con Google', 'SSO com Google'], 'partial', {
      detail: ['Google sign-in across the app. Needs the owner Google credentials in production to verify it here', 'Entrar con Google en toda la app. Necesita las credenciales de Google del owner en producción para verificarlo acá', 'Entrar com Google em todo o app. Precisa das credenciais do Google do owner em produção para verificar aqui'],
    }),
    row('security-certs', 'security', ['Security audits and practices', 'Auditorías y prácticas de seguridad', 'Auditorias e práticas de segurança'], 'missing'),
    row('data-residency', 'security', ['Regional data centers', 'Centros de datos regionales', 'Data centers regionais'], 'missing'),
    row('api-oauth', 'platform', ['OAuth and API keys', 'OAuth y API key', 'OAuth e chaves de API'], 'partial', {
      detail: ['API keys and the workspace MCP login. Built; not yet walked end to end in a browser for each role', 'API keys y el login del MCP del workspace. Construido; falta recorrerlo de punta a punta en el navegador con cada rol', 'Chaves de API e o login do MCP do workspace. Construído; falta percorrer de ponta a ponta no navegador com cada papel'],
    }),
    row('api-sdks', 'platform', ['Official SDKs', 'SDK oficiales', 'SDKs oficiais'], 'missing'),
    row('webhooks-global', 'platform', ['Global webhooks', 'Webhooks globales', 'Webhooks globais'], 'missing'),
    row('webhooks-permissioned', 'platform', ['Permissioned webhooks', 'Webhooks por permiso', 'Webhooks por permissão'], 'missing'),
    row('webhooks-events', 'platform', ['Event-based webhooks', 'Webhooks por evento', 'Webhooks por evento'], 'missing'),
    row('assistant-policies', 'platform', ['Assistant on company policies', 'Asistente sobre políticas', 'Assistente sobre políticas'], 'missing'),
    row('ai-analytics', 'platform', ['Natural language analytics', 'Análisis en lenguaje natural', 'Análise em linguagem natural'], 'missing'),
    row('ai-risk', 'platform', ['AI risk signals', 'Riesgos detectados por AI', 'Sinais de risco por AI'], 'missing'),
    row('ai-external', 'platform', ['Connection to other AI tools', 'Conexión con otras AI', 'Conexão com outras AIs'], 'partial', {
      detail: ['The workspace MCP connector. Built; not yet walked end to end in a browser for each role', 'El conector MCP del workspace. Construido; falta recorrerlo de punta a punta en el navegador con cada rol', 'O conector MCP do workspace. Construído; falta percorrer de ponta a ponta no navegador com cada papel'],
    }),
    row('ai-governance', 'platform', ['AI governance', 'Gobierno de AI', 'Governança de AI'], 'missing'),
    row('mobile-push', 'platform', ['Push notifications', 'Notificaciones push', 'Notificações push'], 'missing'),
    row('community-read-receipts', 'platform', ['Announcement read confirmations', 'Confirmación de lectura', 'Confirmação de leitura'], 'missing'),
    row('community-groups', 'platform', ['Interest groups', 'Grupos internos', 'Grupos internos'], 'missing'),
    row('community-scheduling', 'platform', ['Scheduled posts', 'Publicaciones programadas', 'Publicações agendadas'], 'missing'),
    row('integrations', 'platform', ['Integrations marketplace', 'Marketplace de integraciones', 'Marketplace de integrações'], 'missing'),
    row('multi-language', 'platform', ['Multi-language interface', 'Interfaz en varios idiomas', 'Interface em vários idiomas'], 'partial', {
      detail: ['English, Spanish and Portuguese. Built; not yet walked end to end in a browser for each role', 'Inglés, español y portugués. Construido; falta recorrerlo de punta a punta en el navegador con cada rol', 'Inglês, espanhol e português. Construído; falta percorrer de ponta a ponta no navegador com cada papel'],
    }),
    row('compliance-intelligence', 'compliance', ['Labor law alerts', 'Alertas legales (VirgilHR)', 'Alertas de legislação trabalhista'], 'missing'),
    row('compliance-training', 'compliance', ['Compliance training', 'Capacitación obligatoria (EasyLlama)', 'Treinamento de conformidade'], 'missing'),
    row('handbook-templates', 'compliance', ['Handbook templates', 'Plantillas de manual', 'Modelos de manual'], 'missing'),
    row('aca-reporting', 'compliance', ['ACA reporting', 'Reporte ACA (Lumelight)', 'Relatórios ACA'], 'missing'),
    row('hr-consulting', 'compliance', ['HR consulting', 'Consultoría de RR. HH.', 'Consultoria de RH'], 'missing'),
    row('global-eor', 'global', ['Employer of record', 'Empleador de registro', 'Empregador de registro'], 'missing'),
    row('global-contractors', 'global', ['Contractor management', 'Gestión de contratistas', 'Gestão de prestadores'], 'missing'),
    row('global-payroll-bridge', 'global', ['Local payroll connections', 'Conexión con payroll local', 'Conexão com folhas locais'], 'missing'),
    row('global-cost-calculator', 'global', ['Global cost calculator', 'Calculadora de costo global', 'Calculadora de custo global'], 'missing'),
    row('global-regional-settings', 'global', ['Regional settings', 'Ajustes regionales', 'Configurações regionais'], 'partial', {
      detail: ['Holidays per country. Built; not yet walked end to end in a browser for each role', 'Feriados por país. Construido; falta recorrerlo de punta a punta en el navegador con cada rol', 'Feriados por país. Construído; falta percorrer de ponta a ponta no navegador com cada papel'],
    }),
    row('global-data-formats', 'global', ['Local data formats', 'Formatos locales de datos', 'Formatos locais de dados'], 'missing'),
  ],
};

export default parity;
