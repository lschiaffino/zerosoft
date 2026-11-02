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
 * Hiring contra Workable. Fuente: la documentación pública de Workable (Help
 * Center: jobs, careers page, candidates, evaluations, interviews, offers,
 * reports, GDPR), leída el 2026-10-29 y otra vez el 2026-11-01, contra el
 * código actual. Los ids son estables.
 */
const parity: ProductParity = {
  competitor: 'Workable',
  lastReviewed: '2026-11-02',
  percentHidden: { note: loc(['This table lists everything Workable documents, feature by feature, including its AI agent, sourcing and integrations, so a percentage would not compare with other apps. Rows count as done only after being used end to end in a browser.', 'Esta tabla lista todo lo que Workable documenta, función por función, con su agente de IA, búsqueda de candidatos e integraciones, así que un porcentaje no se compara con otras apps. Una fila cuenta como hecha solo después de usarla de punta a punta en el navegador.', 'Esta tabela lista tudo o que o Workable documenta, função por função, com seu agente de IA, busca de candidatos e integrações, então uma porcentagem não se compara com outros apps. Uma linha conta como pronta só depois de usada de ponta a ponta no navegador.']) },
  areas: [
    { id: 'jobs', label: loc(['Jobs', 'Puestos', 'Vagas']) },
    { id: 'careers', label: loc(['Careers page and applying', 'Página de empleos y postulación', 'Página de vagas e candidatura']) },
    { id: 'candidates', label: loc(['Candidates', 'Candidatos', 'Candidatos']) },
    { id: 'pipeline', label: loc(['Pipeline', 'Pipeline', 'Pipeline']) },
    { id: 'evaluation', label: loc(['Evaluation', 'Evaluación', 'Avaliação']) },
    { id: 'interviews', label: loc(['Interviews', 'Entrevistas', 'Entrevistas']) },
    { id: 'communication', label: loc(['Communication', 'Comunicación', 'Comunicação']) },
    { id: 'offers', label: loc(['Offers', 'Ofertas', 'Ofertas']) },
    { id: 'reports', label: loc(['Reports', 'Reportes', 'Relatórios']) },
    { id: 'privacy', label: loc(['Privacy and GDPR', 'Privacidad y GDPR', 'Privacidade e LGPD/GDPR']) },
    { id: 'platform', label: loc(['AI and platform', 'IA y plataforma', 'IA e plataforma']) },
  ],
  rows: [
    // Puestos
    row('job-templates', 'jobs', ['Jobs from templates', 'Puestos desde plantillas', 'Vagas a partir de modelos'], 'have', {
      detail: [
        'Four built-in templates per language, your own saved templates and a description imported from a Docs page',
        'Cuatro plantillas integradas por idioma, plantillas propias guardadas y la descripción importada de una página de Docs',
        'Quatro modelos integrados por idioma, modelos próprios salvos e a descrição importada de uma página do Docs',
      ],
    }),
    row('job-details', 'jobs', ['Department, location, workplace, type and salary', 'Área, ubicación, modalidad, tipo y salario', 'Área, local, modelo, tipo e salário'], 'have', {
      weight: 2,
      detail: ['On-site, hybrid or remote; salary range shown or hidden on the careers page', 'Presencial, híbrido o remoto; rango salarial visible u oculto en la página de empleos', 'Presencial, híbrido ou remoto; faixa salarial visível ou oculta na página de vagas'],
    }),
    row('hiring-team', 'jobs', ['Hiring team per job', 'Equipo de contratación por puesto', 'Time de contratação por vaga'], 'have', {
      weight: 2,
      detail: ['Recruiter, hiring manager and interviewer roles', 'Roles de recruiter, hiring manager y entrevistador', 'Papéis de recrutador, gestor e entrevistador'],
    }),
    row('custom-stages', 'jobs', ['Custom pipeline stages', 'Etapas propias del pipeline', 'Etapas próprias do pipeline'], 'have', {
      detail: ['Up to 12 stages per job, with defaults', 'Hasta 12 etapas por puesto, con las de defecto', 'Até 12 etapas por vaga, com as padrão'],
    }),
    row('job-states', 'jobs', ['Draft, published, closed and archived', 'Borrador, publicado, cerrado y archivado', 'Rascunho, publicada, fechada e arquivada'], 'have'),
    row('job-requisitions', 'jobs', ['Job requisitions and approvals', 'Solicitudes de puesto con aprobación', 'Requisições de vaga com aprovação'], 'partial', {
      detail: ['An ordered chain of approvers set in Settings: a new job cannot be published until each one approves, with a reason to reject and restart on a new request. No separate requisition form or budget field', 'Una cadena de aprobadores en orden, en Ajustes: un puesto nuevo no se publica hasta que aprueba cada uno, con motivo para rechazar y de cero al volver a pedir. Sin formulario de requisición ni campo de presupuesto', 'Uma cadeia de aprovadores em ordem, em Ajustes: uma vaga nova só é publicada quando cada um aprova, com motivo para recusar e do zero ao pedir de novo. Sem formulário de requisição nem campo de orçamento'],
    }),
    row('multiposting', 'jobs', ['Posting to job boards (LinkedIn, Indeed…)', 'Publicación en portales (LinkedIn, Indeed…)', 'Publicação em portais (LinkedIn, Indeed…)'], 'partial', {
      weight: 2,
      detail: ['Careers page, sitemap, JobPosting data for Google for Jobs and an XML feed in the format aggregators such as Indeed read. The feed is not registered with or tested by any board, and there is no one-click posting', 'Página de empleos, sitemap, datos JobPosting para Google for Jobs y un feed XML en el formato que leen agregadores como Indeed. El feed no está registrado ni probado con ningún portal y no hay publicación con un clic', 'Página de vagas, sitemap, dados JobPosting para o Google for Jobs e um feed XML no formato que agregadores como o Indeed leem. O feed não está registrado nem testado com nenhum portal e não há publicação com um clique'],
    }),
    // Página de empleos
    row('careers-page', 'careers', ['Branded careers page', 'Página de empleos con tu marca', 'Página de vagas com sua marca'], 'partial', {
      weight: 2,
      detail: ['Logo, company name, color and intro at /careers/<handle>; no custom domain or page builder', 'Logo, nombre, color y presentación en /careers/<handle>; sin dominio propio ni editor de página', 'Logo, nome, cor e apresentação em /careers/<handle>; sem domínio próprio nem editor de página'],
    }),
    row('job-seo', 'careers', ['JobPosting structured data and sitemap', 'Datos JobPosting y sitemap', 'Dados JobPosting e sitemap'], 'have'),
    row('application-form', 'careers', ['Application form with custom questions', 'Formulario con preguntas propias', 'Formulário com perguntas próprias'], 'have', {
      weight: 2,
      detail: ['Short and long text, yes or no, one option and number; required or optional', 'Texto corto y largo, sí o no, una opción y número; obligatorias u opcionales', 'Texto curto e longo, sim ou não, uma opção e número; obrigatórias ou opcionais'],
    }),
    row('resume-upload', 'careers', ['Resume upload', 'Subida de CV', 'Envio de currículo'], 'have', {
      detail: ['PDF, DOC or DOCX up to 4 MB, checked by their bytes; private Blob store or encrypted at rest', 'PDF, DOC o DOCX de hasta 4 MB, chequeados por sus bytes; Blob privado o cifrado en reposo', 'PDF, DOC ou DOCX de até 4 MB, verificados pelos bytes; Blob privado ou criptografado em repouso'],
    }),
    row('knockout', 'careers', ['Knock-out questions', 'Preguntas knock-out', 'Perguntas eliminatórias'], 'have', {
      detail: ['The application is flagged for review or, if the question says so, rejected automatically with the reason on record. The candidate is not told and it can be reactivated', 'La postulación queda marcada para revisión o, si la pregunta lo pide, rechazada sola con el motivo registrado. Al candidato no se le avisa y se puede reactivar', 'A candidatura fica marcada para revisão ou, se a pergunta pedir, recusada automaticamente com o motivo registrado. O candidato não é avisado e dá para reativar'],
    }),
    row('anti-spam', 'careers', ['Spam protection', 'Protección contra spam', 'Proteção contra spam'], 'partial', {
      detail: ['Rate limit per IP and a hidden trap field; no CAPTCHA', 'Límite por IP y un campo trampa oculto; sin CAPTCHA', 'Limite por IP e um campo armadilha oculto; sem CAPTCHA'],
    }),

    // Candidatos
    row('candidate-profile', 'candidates', ['Candidate profile with resume viewer', 'Perfil con visor de CV', 'Perfil com visualizador de currículo'], 'have', { weight: 2 }),
    row('tags-sources', 'candidates', ['Tags and source tracking', 'Etiquetas y fuente', 'Etiquetas e origem'], 'have', {
      detail: ['Careers page, referral, LinkedIn, manual, email, other, plus UTM parameters', 'Página de empleos, referido, LinkedIn, manual, email, otra, más parámetros UTM', 'Página de vagas, indicação, LinkedIn, manual, email, outra, mais parâmetros UTM'],
    }),
    row('duplicates', 'candidates', ['Duplicate detection', 'Detección de duplicados', 'Detecção de duplicados'], 'have', {
      detail: ['Same email on the same job joins the existing record; on another job it is a separate record, linked only for people who can see both. Those who manage all applications of both can merge them', 'El mismo email en el mismo puesto se une al registro; en otro puesto es otro registro, enlazado solo para quien ve los dos. Quien gestiona todas las postulaciones de ambos los puede fusionar', 'O mesmo email na mesma vaga se junta ao registro; em outra vaga é outro registro, vinculado só para quem vê os dois. Quem gerencia todas as candidaturas de ambos pode mesclar'],
    }),
    row('timeline', 'candidates', ['Activity timeline', 'Línea de tiempo', 'Linha do tempo'], 'have', {
      detail: ['Every email, reply, note, stage move, scorecard, interview and offer', 'Cada email, respuesta, nota, cambio de etapa, scorecard, entrevista y oferta', 'Cada email, resposta, nota, mudança de etapa, scorecard, entrevista e oferta'],
    }),
    row('bulk-actions', 'candidates', ['Bulk actions', 'Acciones en lote', 'Ações em lote'], 'have', {
      detail: ['Move stage, reject with a template email, tag', 'Mover de etapa, rechazar con email de plantilla, etiquetar', 'Mover de etapa, reprovar com email de modelo, etiquetar'],
    }),
    row('sourcing', 'candidates', ['Sourcing and talent pool search', 'Búsqueda de candidatos y talent pool', 'Busca de candidatos e banco de talentos'], 'partial', {
      weight: 2,
      detail: ['Search everyone you can see across jobs by name, email, tag, source, status and job, with the filters in the URL, and copy them to another job. No outside sourcing or boolean search', 'Buscás a todos los que ves en cualquier puesto por nombre, email, etiqueta, fuente, estado y puesto, con los filtros en la URL, y los copiás a otro puesto. Sin búsqueda externa ni booleana', 'Busque todos que você vê em qualquer vaga por nome, email, tag, origem, status e vaga, com os filtros na URL, e copie para outra vaga. Sem busca externa nem booleana'],
    }),
    row('candidate-import', 'candidates', ['Candidate import', 'Importar candidatos', 'Importar candidatos'], 'have', {
      detail: ['CSV to a job with a preview and an error per row: 500 rows, no email to anyone. Resumes are not imported. Self-serve, where Workable runs it for you', 'CSV a un puesto con vista previa y un error por fila: 500 filas, sin email a nadie. No importa CVs. Lo hacés vos, en Workable lo corre su equipo', 'CSV para uma vaga com prévia e um erro por linha: 500 linhas, sem email a ninguém. Não importa currículos. Você mesmo faz; no Workable quem faz é a equipe deles'],
    }),
    // Pipeline
    row('kanban', 'pipeline', ['Kanban per job with drag and drop', 'Kanban por puesto para arrastrar', 'Kanban por vaga com arrastar'], 'have', { weight: 2 }),
    row('list-filters', 'pipeline', ['List view with filters', 'Lista con filtros', 'Lista com filtros'], 'have'),

    // Evaluación
    row('scorecards', 'evaluation', ['Scorecards per stage', 'Scorecards por etapa', 'Scorecards por etapa'], 'have', {
      weight: 2,
      detail: ['Up to 10 criteria rated 1 to 4 and an overall recommendation', 'Hasta 10 criterios del 1 al 4 y una recomendación general', 'Até 10 critérios de 1 a 4 e uma recomendação geral'],
    }),
    row('blind-scores', 'evaluation', ["Others' scores hidden until you submit", 'Puntajes ajenos ocultos hasta enviar el tuyo', 'Notas dos outros ocultas até enviar a sua'], 'have', {
      detail: ['For interviewers, per stage: they score only the assigned stage, once. Recruiters and hiring managers see every scorecard', 'Para entrevistadores, por etapa: puntúan solo la etapa asignada, una vez. Recruiters y hiring managers ven todos los scorecards', 'Para entrevistadores, por etapa: avaliam só a etapa designada, uma vez. Recrutadores e gestores veem todos os scorecards'],
    }),
    row('interviewer-scope', 'evaluation', ['Interviewers see only assigned candidates', 'Entrevistadores ven solo a sus asignados', 'Entrevistadores veem só os designados'], 'have'),
    row('feedback-reminders', 'evaluation', ['Feedback reminders', 'Recordatorios de feedback', 'Lembretes de feedback'], 'have'),
    row('assessments', 'evaluation', ['Assessments and tests', 'Evaluaciones y tests', 'Testes e avaliações'], 'missing'),

    // Entrevistas
    row('self-scheduling', 'interviews', ['Candidate self-scheduling', 'Auto-agenda del candidato', 'Autoagendamento do candidato'], 'have', {
      weight: 2,
      detail: ['A private Cal event with the interviewers as hosts: only times when all are free', 'Un evento privado de Cal con los entrevistadores como anfitriones: solo horarios con todos libres', 'Um evento privado do Cal com os entrevistadores como anfitriões: só horários com todos livres'],
    }),
    row('calendar-invites', 'interviews', ['Calendar invites and reminders', 'Invitaciones y recordatorios', 'Convites e lembretes'], 'have', {
      detail: ['Sent by Cal', 'Los manda Cal', 'Enviados pelo Cal'],
    }),
    row('video-interviews', 'interviews', ['One-way video interviews', 'Entrevistas en video asincrónicas', 'Entrevistas em vídeo assíncronas'], 'missing'),

    // Comunicación
    row('email-templates', 'communication', ['Email templates with variables', 'Plantillas de email con variables', 'Modelos de email com variáveis'], 'have', {
      detail: ['Acknowledgement, rejection, interview invite, offer and your own, in three languages', 'Acuse, rechazo, invitación a entrevista, oferta y las tuyas, en tres idiomas', 'Confirmação, reprovação, convite para entrevista, oferta e os seus, em três idiomas'],
    }),
    row('send-email', 'communication', ['Email candidates from the app', 'Emails al candidato desde la app', 'Emails ao candidato pelo app'], 'have'),
    row('email-replies', 'communication', ['Replies in the candidate timeline', 'Respuestas en la línea de tiempo', 'Respostas na linha do tempo'], 'have', {
      detail: ['Through the inbound email domain Chat uses (CHAT_INBOUND_DOMAIN)', 'Con el dominio de recepción que usa Chat (CHAT_INBOUND_DOMAIN)', 'Com o domínio de recebimento do Chat (CHAT_INBOUND_DOMAIN)'],
    }),
    row('sms', 'communication', ['SMS and texting', 'SMS', 'SMS'], 'missing'),

    // Ofertas
    row('offer-letters', 'offers', ['Offer letters from templates', 'Cartas de oferta desde plantillas', 'Cartas de oferta a partir de modelos'], 'have'),
    row('offer-approval', 'offers', ['Offer approval', 'Aprobación de ofertas', 'Aprovação de ofertas'], 'have', {
      detail: ['One approval by the hiring manager or an admin, or an ordered chain of named people from Settings, with a reason to reject. Whoever wrote the offer skips their own step. No approval groups or reminders', 'Una aprobación del hiring manager o un admin, o una cadena en orden de personas elegidas en Ajustes, con motivo para rechazar. Quien la armó saltea su paso. Sin grupos ni recordatorios', 'Uma aprovação do hiring manager ou de um admin, ou uma cadeia em ordem de pessoas escolhidas em Ajustes, com motivo para recusar. Quem escreveu pula a própria etapa. Sem grupos nem lembretes'],
    }),
    row('offer-accept', 'offers', ['Candidate accepts or declines online', 'El candidato acepta o rechaza en línea', 'O candidato aceita ou recusa online'], 'have', {
      detail: ['Typed full name with date, IP, browser and a hash of the letter on record', 'Nombre escrito con fecha, IP, navegador y hash de la carta registrados', 'Nome digitado com data, IP, navegador e hash da carta registrados'],
    }),
    row('e-signature', 'offers', ['Electronic signature', 'Firma electrónica', 'Assinatura eletrônica'], 'have', {
      detail: [
        'With Sign: an approved offer goes out as a PDF with an audit trail and is accepted when the candidate signs',
        'Con Sign: una oferta aprobada sale como PDF con registro de auditoría y queda aceptada cuando el candidato firma',
        'Com o Sign: uma oferta aprovada sai como PDF com trilha de auditoria e fica aceita quando o candidato assina',
      ],
    }),

    // Reportes
    row('time-to-hire', 'reports', ['Time to hire', 'Tiempo hasta contratar', 'Tempo até contratar'], 'have'),
    row('conversion', 'reports', ['Pipeline conversion by stage', 'Conversión por etapa', 'Conversão por etapa'], 'have'),
    row('source-report', 'reports', ['Source effectiveness', 'Efectividad por fuente', 'Efetividade por origem'], 'have'),
    row('open-jobs-report', 'reports', ['Open jobs report', 'Reporte de puestos abiertos', 'Relatório de vagas abertas'], 'have'),
    row('eeo-reports', 'reports', ['EEO reports', 'Reportes EEO', 'Relatórios EEO'], 'missing'),
    // Privacidad
    row('team-visibility', 'privacy', ['Candidate data only for the hiring team', 'Datos del candidato solo para el equipo', 'Dados do candidato só para o time'], 'have', {
      weight: 2,
      detail: ['Also in Cmd+K, the assistant, notifications, Flow and the API', 'También en Cmd+K, el asistente, los avisos, Flow y la API', 'Também no Cmd+K, no assistente, nos avisos, no Flow e na API'],
    }),
    row('consent', 'privacy', ['Consent on the application form', 'Consentimiento en el formulario', 'Consentimento no formulário'], 'have'),
    row('retention', 'privacy', ['Data retention', 'Retención de datos', 'Retenção de dados'], 'have', {
      detail: ['Deletes candidates after N months without activity unless they agreed to stay', 'Borra candidatos tras N meses sin actividad salvo que hayan aceptado quedar', 'Exclui candidatos após N meses sem atividade, salvo se aceitaram ficar'],
    }),
    row('deletion-requests', 'privacy', ['Candidate data deletion', 'Borrado de datos del candidato', 'Exclusão de dados do candidato'], 'have', {
      detail: ['From the profile, or by the candidate with the link in the acknowledgement email', 'Desde el perfil, o por el candidato con el link del email de acuse', 'Pelo perfil, ou pelo candidato com o link do email de confirmação'],
    }),

    // IA y plataforma
    row('ai-assist', 'platform', ['AI resume parsing and summaries', 'Lectura de CV y resúmenes con IA', 'Leitura de currículo e resumos com IA'], 'partial', {
      detail: ['Reads PDF resumes only; AI never decides on a candidate', 'Lee solo CVs en PDF; la IA nunca decide sobre un candidato', 'Lê só currículos em PDF; a IA nunca decide sobre um candidato'],
    }),
    row('automations', 'platform', ['Automations on stage changes and hires', 'Automatizaciones al cambiar de etapa y contratar', 'Automações ao mudar de etapa e contratar'], 'have', {
      detail: ['Flow triggers: applied, stage changed, hired', 'Disparadores de Flow: postulación, cambio de etapa, contratación', 'Gatilhos do Flow: candidatura, mudança de etapa, contratação'],
    }),
    row('api', 'platform', ['API', 'API', 'API'], 'partial', {
      detail: ['Read jobs and the candidates the key can see (hiring:read)', 'Lectura de puestos y de los candidatos que la key puede ver (hiring:read)', 'Leitura de vagas e dos candidatos que a key pode ver (hiring:read)'],
    }),
    row('hris-handoff', 'platform', ['Hand-off to HR on hire', 'Paso a RR. HH. al contratar', 'Passagem para o RH ao contratar'], 'have', {
      detail: ['A server hook and a Flow event on every hire, and if the workspace uses People the person lands there in onboarding with job, department and start date. Salary stays for HR to enter', 'Un gancho y un evento de Flow en cada contratación, y si el workspace usa People la persona queda ahí en onboarding con puesto, área y fecha de inicio. El sueldo lo carga HR', 'Um gancho e um evento de Flow em cada contratação, e se o workspace usa o People a pessoa entra lá em onboarding com cargo, departamento e início. O salário fica para o RH'],
    }),
    row('assistant', 'platform', ['AI assistant over your pipeline', 'Asistente sobre tu pipeline', 'Assistente sobre seu pipeline'], 'better', {
      competitorHas: false,
      detail: ['Reads jobs and candidates you can see; moves and notes after you confirm', 'Lee puestos y candidatos que podés ver; mueve y deja notas cuando confirmás', 'Lê vagas e candidatos que você pode ver; move e deixa notas quando você confirma'],
    }),
    row('mobile-app', 'platform', ['Mobile app', 'App móvil', 'App móvel'], 'missing'),
    row('confidential-jobs', 'jobs', ['Confidential jobs', 'Puestos confidenciales', 'Vagas confidenciais'], 'have', {
      weight: 2,
      detail: ['Only the hiring team and admins see them, and they stay off the careers page, the feed and search. Calendar events are not marked private', 'Solo los ven el equipo y los admins, y quedan fuera de la página de empleos, del feed y de la búsqueda. Los eventos de calendario no se marcan privados', 'Só a equipe e os admins veem, e ficam fora da página de vagas, do feed e da busca. Os eventos de calendário não ficam privados'],
    }),
    row('ai-job-content', 'jobs', ['AI job descriptions and interview questions', 'Avisos y preguntas de entrevista con IA', 'Descrições de vaga e perguntas de entrevista com IA'], 'missing'),
    row('careers-widget', 'careers', ['Embeddable job list', 'Lista de empleos para embeber', 'Lista de vagas para incorporar'], 'missing'),
    row('candidate-search', 'candidates', ['Search all candidates across jobs', 'Búsqueda de candidatos en todos los puestos', 'Busca de candidatos em todas as vagas'], 'have', {
      weight: 2,
      detail: ['Limited to the jobs each person can see. No boolean operators', 'Limitada a los puestos que cada persona ve. Sin operadores booleanos', 'Limitada às vagas que cada pessoa vê. Sem operadores booleanos'],
    }),
    row('candidate-custom-fields', 'candidates', ['Custom candidate fields', 'Campos propios de candidatos', 'Campos próprios de candidatos'], 'missing', {
      weight: 2,
    }),
    row('resurface-candidates', 'candidates', ['AI suggests past candidates for a new job', 'La IA sugiere candidatos anteriores para un puesto', 'A IA sugere candidatos anteriores para uma vaga'], 'missing'),
    row('referrals-portal', 'candidates', ['Employee referral portal', 'Portal de referidos', 'Portal de indicações'], 'missing', {
      detail: ['Referral exists only as a source', 'Referido existe solo como fuente', 'Indicação existe só como origem'],
    }),
    row('linkedin-extension', 'candidates', ['Browser extension to add LinkedIn profiles', 'Extensión para sumar perfiles de LinkedIn', 'Extensão para adicionar perfis do LinkedIn'], 'missing'),
    row('copy-move-candidate', 'pipeline', ['Copy or move a candidate to another job', 'Copiar o mover un candidato a otro puesto', 'Copiar ou mover um candidato para outra vaga'], 'have', {
      weight: 2,
      detail: ['For those who manage both jobs', 'Para quien gestiona los dos puestos', 'Para quem gerencia as duas vagas'],
    }),
    row('disqualification-reasons', 'pipeline', ['Rejection reasons with a report', 'Motivos de rechazo con reporte', 'Motivos de recusa com relatório'], 'partial', {
      weight: 2,
      detail: ['A suggested list or your own text, and a report per reason. The reason is optional and the list cannot be edited', 'Una lista sugerida o tu propio texto, y un reporte por motivo. El motivo es opcional y la lista no se edita', 'Uma lista sugerida ou seu próprio texto, e um relatório por motivo. O motivo é opcional e a lista não se edita'],
    }),
    row('interview-kits', 'evaluation', ['Interview guides per stage', 'Guías de entrevista por etapa', 'Guias de entrevista por etapa'], 'have', {
      weight: 2,
      detail: ['Questions per stage and job, shown above the scorecard. Not reusable across jobs except through job templates', 'Preguntas por etapa y puesto, arriba del scorecard. No se reutilizan entre puestos', 'Perguntas por etapa e vaga, acima do scorecard. Não se reutilizam entre vagas'],
    }),
    row('anonymized-screening', 'evaluation', ['Anonymized early review', 'Revisión inicial anónima', 'Revisão inicial anônima'], 'missing'),
    row('background-checks', 'evaluation', ['Background checks', 'Verificación de antecedentes', 'Verificação de antecedentes'], 'missing'),
    row('multi-part-interviews', 'interviews', ['Multi-part interview coordination', 'Entrevistas de varias partes', 'Entrevistas em várias partes'], 'missing'),
    row('candidate-surveys', 'communication', ['Candidate experience surveys', 'Encuestas de experiencia del candidato', 'Pesquisas de experiência do candidato'], 'missing'),
    row('company-signatory', 'offers', ['Company signs the offer after approvals', 'La empresa firma la oferta después de aprobar', 'A empresa assina a oferta depois de aprovar'], 'missing'),
    row('custom-reports', 'reports', ['Custom reports', 'Reportes a medida', 'Relatórios personalizados'], 'partial', {
      weight: 2,
      detail: ['Fixed reports plus a CSV of the candidates you can see, with the same filters. No report builder or charts of your own', 'Reportes fijos y un CSV de los candidatos que ves, con los mismos filtros. Sin armador de reportes ni gráficos propios', 'Relatórios fixos e um CSV dos candidatos que você vê, com os mesmos filtros. Sem construtor de relatórios nem gráficos próprios'],
    }),
    row('scheduled-reports', 'reports', ['Scheduled report emails', 'Reportes programados por email', 'Relatórios agendados por email'], 'missing'),
    row('custom-roles', 'platform', ['Custom hiring roles', 'Roles de contratación a medida', 'Papéis de contratação personalizados'], 'missing'),
    row('hiring-audit-log', 'platform', ['Audit log', 'Registro de auditoría', 'Registro de auditoria'], 'missing'),
    // Del benchmark completo: docs/benchmark/hiring.md
    row('job-duplicate', 'jobs', ['Duplicate a job', 'Duplicar vacante', 'Duplicar vaga'], 'missing'),
    row('departments', 'jobs', ['Department hierarchy', 'Jerarquía de departamentos', 'Hierarquia de departamentos'], 'partial', {
      detail: ['A free text department, no hierarchy. Built; not yet walked end to end in a browser for each role', 'Un área de texto libre, sin jerarquía. Construido; falta recorrerlo de punta a punta en el navegador con cada rol', 'Um departamento de texto livre, sem hierarquia. Construído; falta percorrer de ponta a ponta no navegador com cada papel'],
    }),
    row('job-on-hold', 'jobs', ['Put a job on hold', 'Poner una vacante en pausa', 'Pausar uma vaga'], 'missing'),
    row('internal-jobs', 'jobs', ['Internal jobs', 'Vacantes internas', 'Vagas internas'], 'missing'),
    row('confidential-zone', 'jobs', ['Confidential zone', 'Zona confidencial', 'Zona confidencial'], 'missing'),
    row('requisition-approval-routing', 'jobs', ['Requisition approval routing', 'Aprobación de requisiciones por área', 'Roteamento de aprovação de requisições'], 'partial', {
      detail: ['Ordered named approvers from Settings. No routing rules or groups', 'Aprobadores en orden elegidos en Ajustes. Sin reglas de ruteo ni grupos', 'Aprovadores em ordem escolhidos em Ajustes. Sem regras de roteamento nem grupos'],
    }),
    row('requisition-reapproval', 'jobs', ['Re-approval on requisition edits', 'Reaprobación al editar', 'Reaprovação ao editar requisição'], 'missing'),
    row('requisition-fields', 'jobs', ['Custom requisition fields', 'Campos propios de requisición', 'Campos próprios de requisição'], 'missing'),
    row('requisition-bulk', 'jobs', ['Bulk requisitions', 'Requisiciones masivas', 'Requisições em massa'], 'missing'),
    row('requisition-statuses', 'jobs', ['Requisition statuses', 'Estados de requisición', 'Status de requisição'], 'missing'),
    row('hiring-plan-dashboard', 'jobs', ['Hiring plan dashboard', 'Tablero del plan de contratación', 'Painel do plano de contratação'], 'missing'),
    row('multi-language-jobs', 'jobs', ['Multi-language jobs', 'Vacantes en varios idiomas', 'Vagas em vários idiomas'], 'missing'),
    row('ai-interview-questions', 'jobs', ['AI interview questions', 'Preguntas de entrevista con AI', 'Perguntas de entrevista com AI'], 'missing'),
    row('job-brief-agent', 'jobs', ['Job brief agent', 'Job Brief Agent', 'Agente de briefing da vaga'], 'missing'),
    row('salary-estimator', 'jobs', ['Salary estimator', 'Estimador salarial', 'Estimador salarial'], 'missing'),
    row('inclusive-job-tools', 'jobs', ['Inclusive job descriptions', 'Descripciones inclusivas', 'Descrições inclusivas'], 'missing'),
    row('careers-editors', 'careers', ['Invite careers page editors', 'Editores invitados', 'Convidar editores da página de carreiras'], 'missing'),
    row('careers-custom-domain', 'careers', ['Careers page on a custom domain', 'Dominio propio', 'Página de carreiras em domínio próprio'], 'missing'),
    row('careers-api', 'careers', ['Careers page through the API', 'Página de empleos por API', 'Página de carreiras via API'], 'missing'),
    row('careers-pixel', 'careers', ['Conversion tracking pixel', 'Píxel de conversión', 'Pixel de conversão'], 'missing'),
    row('careers-analytics', 'careers', ['Google Analytics', 'Google Analytics', 'Google Analytics'], 'missing'),
    row('application-reorder', 'careers', ['Reorder form fields', 'Reordenar campos del formulario', 'Reordenar campos do formulário'], 'missing'),
    row('application-reuse', 'careers', ['Reuse a form on other jobs', 'Reutilizar un formulario', 'Reutilizar formulário'], 'partial', {
      detail: ['Through job templates. Built; not yet walked end to end in a browser for each role', 'Con plantillas de puesto. Construido; falta recorrerlo de punta a punta en el navegador con cada rol', 'Com modelos de vaga. Construído; falta percorrer de ponta a ponta no navegador com cada papel'],
    }),
    row('resume-autofill', 'careers', ['Autofill from resume', 'Autocompletar con CV', 'Preenchimento automático a partir do currículo'], 'missing'),
    row('one-click-apply', 'careers', ['One-click apply', 'Postulación en un clic', 'Candidatura com um clique'], 'missing'),
    row('apply-linkedin', 'careers', ['Apply with LinkedIn', 'Apply with LinkedIn', 'Candidatura com LinkedIn'], 'missing'),
    row('indeed-easy-apply', 'careers', ['Indeed Easy Apply', 'Indeed Easy Apply', 'Indeed Easy Apply'], 'missing'),
    row('jobs-by-workable', 'careers', ['Own job board', 'Jobs by Workable', 'Portal de vagas próprio'], 'missing'),
    row('social-promotion', 'careers', ['Automated social promotion', 'Promoción en redes', 'Promoção automática em redes sociais'], 'missing'),
    row('linkedin-rsc', 'careers', ['LinkedIn Recruiter System Connect', 'LinkedIn Recruiter System Connect', 'LinkedIn Recruiter System Connect'], 'missing'),
    row('candidate-edit', 'candidates', ['Edit candidate profile', 'Editar el perfil', 'Editar perfil do candidato'], 'partial', {
      detail: ['Name, phone, location and headline. Built; not yet walked end to end in a browser for each role', 'Nombre, teléfono, ubicación y título. Construido; falta recorrerlo de punta a punta en el navegador con cada rol', 'Nome, telefone, localização e título. Construído; falta percorrer de ponta a ponta no navegador com cada papel'],
    }),
    row('utm-sources', 'candidates', ['Custom sources with UTM links', 'Orígenes propios con UTM', 'Origens próprias com UTM'], 'partial', {
      detail: ['Fixed sources plus UTM on share links, no custom sources. Built; not yet walked end to end in a browser for each role', 'Fuentes fijas y UTM en links, sin fuentes propias. Construido; falta recorrerlo de punta a punta en el navegador con cada rol', 'Origens fixas e UTM em links, sem origens próprias. Construído; falta percorrer de ponta a ponta no navegador com cada papel'],
    }),
    row('ai-recommendations', 'candidates', ['AI candidate recommendations', 'Candidatos sugeridos por AI', 'Candidatos sugeridos por AI'], 'missing'),
    row('talent-pool', 'candidates', ['Talent pool', 'Talent Pool', 'Banco de talentos'], 'partial', {
      detail: ['Search across jobs and copy to another job, no separate pool. Built; not yet walked end to end in a browser for each role', 'Búsqueda entre puestos y copia a otro puesto, sin un pool aparte. Construido; falta recorrerlo de punta a punta en el navegador con cada rol', 'Busca entre vagas e cópia para outra vaga, sem pool à parte. Construído; falta percorrer de ponta a ponta no navegador com cada papel'],
    }),
    row('boolean-search', 'candidates', ['Boolean candidate search', 'Búsqueda booleana', 'Busca booleana de candidatos'], 'missing'),
    row('resume-bulk-upload', 'candidates', ['Bulk resume upload', 'Subir CV en lote', 'Envio de currículos em lote'], 'missing'),
    row('add-candidate-minimal', 'candidates', ['Add a candidate with name or email', 'Alta con nombre o email', 'Adicionar candidato com nome ou email'], 'partial', {
      detail: ['Name and email are both required. Built; not yet walked end to end in a browser for each role', 'Nombre y email son obligatorios. Construido; falta recorrerlo de punta a punta en el navegador con cada rol', 'Nome e email são obrigatórios. Construído; falta percorrer de ponta a ponta no navegador com cada papel'],
    }),
    row('job-mailbox', 'candidates', ['Job mailbox', 'Casilla de la vacante', 'Caixa de email da vaga'], 'missing'),
    row('candidate-attachments', 'candidates', ['Candidate attachments', 'Adjuntos en el perfil', 'Anexos do candidato'], 'partial', {
      detail: ['Resume and documents that arrive with an application. Built; not yet walked end to end in a browser for each role', 'CV y documentos que llegan con la postulación. Construido; falta recorrerlo de punta a punta en el navegador con cada rol', 'Currículo e documentos que chegam com a candidatura. Construído; falta percorrer de ponta a ponta no navegador com cada papel'],
    }),
    row('candidate-external-share', 'candidates', ['Share a profile outside the app', 'Compartir fuera de Workable', 'Compartilhar perfil fora do app'], 'missing'),
    row('candidate-snooze', 'candidates', ['Snooze with a follow-up reminder', 'Posponer con recordatorio', 'Adiar com lembrete'], 'missing'),
    row('reference-checks', 'candidates', ['Reference check notes', 'Referencias', 'Registro de referências'], 'missing'),
    row('referrals-dashboard', 'candidates', ['Referral dashboard', 'Tablero de referidos', 'Painel de indicações'], 'missing'),
    row('referrals-auto-join', 'candidates', ['Referral auto-join', 'Alta automática a referidos', 'Entrada automática em indicações'], 'missing'),
    row('disqualify', 'pipeline', ['Disqualify candidates', 'Descalificar candidatos', 'Desqualificar candidatos'], 'have', {
      detail: ['Reject one or many, with a reason on record, and reactivate', 'Rechazar uno o varios, con motivo registrado, y reactivar', 'Recusar um ou vários, com motivo registrado, e reativar'],
    }),
    row('reporting-pipeline', 'pipeline', ['Reporting pipeline', 'Pipeline de reportes', 'Pipeline de relatórios'], 'missing'),
    row('rating-scale', 'evaluation', ['Rating scale', 'Escala de evaluación', 'Escala de avaliação'], 'partial', {
      detail: ['A fixed 1 to 4 scale. Built; not yet walked end to end in a browser for each role', 'Una escala fija de 1 a 4. Construido; falta recorrerlo de punta a punta en el navegador con cada rol', 'Uma escala fixa de 1 a 4. Construído; falta percorrer de ponta a ponta no navegador com cada papel'],
    }),
    row('interview-kit-sources', 'evaluation', ['Build a kit from several sources', 'Crear kit desde varias fuentes', 'Criar kit a partir de várias fontes'], 'missing'),
    row('interview-kit-templates', 'evaluation', ['Interview kit templates', 'Plantillas de kits', 'Modelos de kits de entrevista'], 'missing'),
    row('interview-kit-print', 'evaluation', ['Print an interview kit', 'Imprimir kit', 'Imprimir kit de entrevista'], 'missing'),
    row('ai-screening', 'evaluation', ['AI candidate screening', 'Screening con AI', 'Triagem com AI'], 'missing'),
    row('ai-match-score', 'evaluation', ['Explainable match score', 'Puntaje de ajuste explicable', 'Pontuação de aderência explicável'], 'missing'),
    row('assessment-stage', 'evaluation', ['Assessment per stage', 'Test por etapa', 'Teste por etapa'], 'missing'),
    row('internal-comments', 'evaluation', ['Internal comments', 'Comentarios internos', 'Comentários internos'], 'partial', {
      detail: ['Notes on the timeline. Built; not yet walked end to end in a browser for each role', 'Notas en la línea de tiempo. Construido; falta recorrerlo de punta a punta en el navegador con cada rol', 'Notas na linha do tempo. Construído; falta percorrer de ponta a ponta no navegador com cada papel'],
    }),
    row('comment-visibility', 'evaluation', ['Restrict comment visibility', 'Restringir visibilidad de comentarios', 'Restringir visibilidade de comentários'], 'missing'),
    row('draft-autosave', 'evaluation', ['Draft autosave', 'Guardado de borradores', 'Salvamento de rascunhos'], 'missing'),
    row('scheduling-buffers', 'interviews', ['Self-scheduling buffers', 'Márgenes en autoagenda', 'Intervalos no autoagendamento'], 'missing'),
    row('interviewer-availability', 'interviews', ['Interviewer availability', 'Disponibilidad del entrevistador', 'Disponibilidade do entrevistador'], 'partial', {
      detail: ['Through Cal, with interviewers as hosts. Built; not yet walked end to end in a browser for each role', 'Con Cal, con los entrevistadores como anfitriones. Construido; falta recorrerlo de punta a punta en el navegador con cada rol', 'Pelo Cal, com os entrevistadores como anfitriões. Construído; falta percorrer de ponta a ponta no navegador com cada papel'],
    }),
    row('candidate-event-reminders', 'interviews', ['Candidate event reminders', 'Recordatorios al candidato', 'Lembretes de eventos ao candidato'], 'partial', {
      detail: ['Sent by Cal. Built; not yet walked end to end in a browser for each role', 'Los manda Cal. Construido; falta recorrerlo de punta a punta en el navegador con cada rol', 'Enviados pelo Cal. Construído; falta percorrer de ponta a ponta no navegador com cada papel'],
    }),
    row('event-templates', 'interviews', ['Event description templates', 'Plantillas de eventos', 'Modelos de descrição de eventos'], 'missing'),
    row('video-conferencing', 'interviews', ['Video conferencing', 'Videollamadas', 'Videoconferência'], 'partial', {
      detail: ['Through the Cal event. Built; not yet walked end to end in a browser for each role', 'Con el evento de Cal. Construido; falta recorrerlo de punta a punta en el navegador con cada rol', 'Pelo evento do Cal. Construído; falta percorrer de ponta a ponta no navegador com cada papel'],
    }),
    row('upcoming-interviews', 'interviews', ['Upcoming interviews view', 'Ver próximas entrevistas', 'Ver próximas entrevistas'], 'missing'),
    row('video-interview-stage', 'interviews', ['One-way video per stage', 'Video por etapa', 'Vídeo por etapa'], 'missing'),
    row('bulk-email', 'communication', ['Bulk email', 'Email masivo', 'Email em massa'], 'missing'),
    row('scheduled-send', 'communication', ['Scheduled email or text', 'Envío programado', 'Envio agendado'], 'missing'),
    row('private-email', 'communication', ['Private email or text', 'Email o texto privado', 'Email ou mensagem privada'], 'missing'),
    row('email-signature', 'communication', ['Email signature', 'Firma de email', 'Assinatura de email'], 'missing'),
    row('ai-email', 'communication', ['AI email drafts', 'Emails redactados con AI', 'Rascunhos de email com AI'], 'missing'),
    row('offer-variables', 'offers', ['Custom offer variables', 'Variables propias en ofertas', 'Variáveis próprias em ofertas'], 'partial', {
      detail: ['Fixed variables in templates, no custom ones. Built; not yet walked end to end in a browser for each role', 'Variables fijas en plantillas, sin propias. Construido; falta recorrerlo de punta a punta en el navegador con cada rol', 'Variáveis fixas em modelos, sem próprias. Construído; falta percorrer de ponta a ponta no navegador com cada papel'],
    }),
    row('offer-expiration', 'offers', ['Offer expiration', 'Vencimiento de oferta', 'Validade da oferta'], 'missing'),
    row('simple-esign-templates', 'offers', ['Simple signature templates', 'Plantillas simples de firma', 'Modelos simples de assinatura'], 'missing'),
    row('offer-template-access', 'offers', ['Limit offer template access', 'Limitar acceso a plantillas', 'Limitar acesso a modelos de oferta'], 'missing'),
    row('offer-details-access', 'offers', ['Offer details access', 'Acceso a detalles de oferta', 'Acesso aos detalhes da oferta'], 'missing'),
    row('hiring-velocity', 'reports', ['Hiring velocity report', 'Velocidad de contratación', 'Relatório de velocidade de contratação'], 'missing'),
    row('job-details-report', 'reports', ['Job details report', 'Detalle de vacantes', 'Relatório de detalhes da vaga'], 'missing'),
    row('offers-hires-report', 'reports', ['Offers and hires report', 'Ofertas y contrataciones', 'Relatório de ofertas e contratações'], 'missing'),
    row('offer-details-report', 'reports', ['Offer details report', 'Detalle de ofertas', 'Relatório de detalhes da oferta'], 'missing'),
    row('team-productivity', 'reports', ['Team productivity report', 'Productividad del equipo', 'Relatório de produtividade da equipe'], 'missing'),
    row('hiring-plan-report', 'reports', ['Hiring plan report', 'Reporte del plan de contratación', 'Relatório do plano de contratação'], 'missing'),
    row('ai-credit-report', 'reports', ['AI credit usage report', 'Uso de créditos AI', 'Relatório de uso de créditos de AI'], 'missing'),
    row('report-filters', 'reports', ['Report filters by dimension', 'Filtros por dimensión', 'Filtros de relatório por dimensão'], 'partial', {
      detail: ['Period and job. Built; not yet walked end to end in a browser for each role', 'Período y puesto. Construido; falta recorrerlo de punta a punta en el navegador con cada rol', 'Período e vaga. Construído; falta percorrer de ponta a ponta no navegador com cada papel'],
    }),
    row('saved-reports', 'reports', ['Saved reports', 'Reportes guardados', 'Relatórios salvos'], 'missing'),
    row('custom-dashboards', 'reports', ['Custom dashboards', 'Dashboards a medida', 'Painéis personalizados'], 'missing'),
    row('report-exports', 'reports', ['Report exports', 'Exportar reportes', 'Exportar relatórios'], 'partial', {
      detail: ['A CSV of candidates, not of each report. Built; not yet walked end to end in a browser for each role', 'Un CSV de candidatos, no de cada reporte. Construido; falta recorrerlo de punta a punta en el navegador con cada rol', 'Um CSV de candidatos, não de cada relatório. Construído; falta percorrer de ponta a ponta no navegador com cada papel'],
    }),
    row('report-sharing', 'reports', ['Report sharing', 'Compartir reportes', 'Compartilhar relatórios'], 'missing'),
    row('governed-sharing', 'reports', ['Governed report sharing', 'Compartir gobernado', 'Compartilhamento governado'], 'missing'),
    row('bi-link', 'reports', ['Business intelligence link', 'Enlace a BI', 'Conexão com BI'], 'missing'),
    row('monthly-spotlight', 'reports', ['Monthly summary email', 'Email mensual Spotlight', 'Email de resumo mensal'], 'missing'),
    row('gdpr-automation', 'privacy', ['GDPR automation', 'Automatización GDPR', 'Automação de GDPR'], 'partial', {
      detail: ['Retention by months and deletion by link. Built; not yet walked end to end in a browser for each role', 'Retención por meses y borrado por link. Construido; falta recorrerlo de punta a punta en el navegador con cada rol', 'Retenção por meses e exclusão por link. Construído; falta percorrer de ponta a ponta no navegador com cada papel'],
    }),
    row('sourced-auto-delete', 'privacy', ['Auto-delete uncontacted sourced candidates', 'Borrado de candidatos buscados sin contacto', 'Excluir candidatos buscados sem contato'], 'missing'),
    row('sourced-privacy-notice', 'privacy', ['Privacy notice for sourced candidates', 'Aviso de privacidad a buscados', 'Aviso de privacidade a candidatos buscados'], 'missing'),
    row('ccpa', 'privacy', ['CCPA features', 'Funciones CCPA', 'Recursos de CCPA'], 'missing'),
    row('eeo-ofccp', 'privacy', ['EEO and OFCCP options', 'Opciones EEO y OFCCP', 'Opções EEO e OFCCP'], 'missing'),
    row('eeo-survey', 'privacy', ['EEO survey', 'Encuesta EEO', 'Pesquisa EEO'], 'missing'),
    row('candidate-photos', 'privacy', ['Candidate photos and social profiles', 'Fotos y redes del candidato', 'Fotos e redes do candidato'], 'missing'),
    row('hide-hired', 'privacy', ['Hide hired candidate details', 'Ocultar datos de contratados', 'Ocultar dados de contratados'], 'missing'),
    row('certifications', 'privacy', ['Security certifications', 'Certificaciones', 'Certificações de segurança'], 'missing'),
    row('resume-parsing', 'platform', ['Resume parsing', 'Lectura automática de CV', 'Leitura automática de currículos'], 'partial', {
      detail: ['PDF only, and tested here only against the fake model', 'Solo PDF, y probado acá solo contra el modelo falso', 'Só PDF, e testado aqui só com o modelo falso'],
    }),
    row('ai-toggle', 'platform', ['Turn AI features on or off', 'Activar o desactivar AI', 'Ativar ou desativar AI'], 'missing'),
    row('automation-sms', 'platform', ['Automated texts', 'Texto automático', 'Mensagens automáticas'], 'missing'),
    row('zapier', 'platform', ['Zapier', 'Zapier', 'Zapier'], 'missing'),
    row('api-webhooks', 'platform', ['Webhooks', 'Webhooks', 'Webhooks'], 'missing'),
    row('api-oauth', 'platform', ['OAuth for partners', 'OAuth para socios', 'OAuth para parceiros'], 'missing'),
    row('integrations', 'platform', ['Integrations marketplace', 'Integraciones', 'Marketplace de integrações'], 'missing'),
    row('agent', 'platform', ['Autonomous recruiting agent', 'Workable Agent', 'Agente autônomo de recrutamento'], 'missing'),
    row('agent-chat', 'platform', ['Agent conversations with candidates', 'Conversaciones del agente', 'Conversas do agente com candidatos'], 'missing'),
    row('agent-auto-disqualify', 'platform', ['Agent disqualifies and advances', 'Descartes y avances del agente', 'Agente desqualifica e avança'], 'missing'),
    row('agent-credits', 'platform', ['AI credits', 'Créditos AI', 'Créditos de AI'], 'missing'),
    row('preset-roles', 'platform', ['Preset roles', 'Roles predefinidos', 'Funções predefinidas'], 'partial', {
      detail: ['Recruiter, hiring manager and interviewer. Built; not yet walked end to end in a browser for each role', 'Recruiter, hiring manager e interviewer. Construido; falta recorrerlo de punta a punta en el navegador con cada rol', 'Recruiter, hiring manager e interviewer. Construído; falta percorrer de ponta a ponta no navegador com cada papel'],
    }),
    row('sso', 'platform', ['Single sign-on', 'SSO', 'Login único'], 'partial', {
      detail: ['Google sign-in across the app; no SAML', 'Entrar con Google en toda la app; sin SAML', 'Entrar com Google em todo o app; sem SAML'],
    }),
    row('mfa', 'platform', ['Multi-factor sign-in', 'MFA o 2FA', 'Login com vários fatores'], 'partial', {
      detail: ['Two-step login exists across the app. Built; not yet walked end to end in a browser for each role', 'El login en dos pasos existe en toda la app. Construido; falta recorrerlo de punta a punta en el navegador con cada rol', 'O login em duas etapas existe em todo o app. Construído; falta percorrer de ponta a ponta no navegador com cada papel'],
    }),
    row('smart-invites', 'platform', ['Invites by company domain', 'Invitaciones por dominio', 'Convites por domínio da empresa'], 'missing'),
    row('external-recruiters', 'platform', ['External recruiters', 'Recruiters externos', 'Recrutadores externos'], 'missing'),
    row('notification-preferences', 'platform', ['Notification preferences', 'Preferencias de avisos', 'Preferências de notificações'], 'missing'),
    row('interface-languages', 'platform', ['Multi-language interface', 'Interfaz en varios idiomas', 'Interface em vários idiomas'], 'partial', {
      detail: ['English, Spanish and Portuguese. Built; not yet walked end to end in a browser for each role', 'Inglés, español y portugués. Construido; falta recorrerlo de punta a punta en el navegador con cada rol', 'Inglês, espanhol e português. Construído; falta percorrer de ponta a ponta no navegador com cada papel'],
    }),
    row('data-export', 'platform', ['Data export', 'Exportar datos', 'Exportação de dados'], 'partial', {
      detail: ['A CSV of candidates. Built; not yet walked end to end in a browser for each role', 'Un CSV de candidatos. Construido; falta recorrerlo de punta a punta en el navegador con cada rol', 'Um CSV de candidatos. Construído; falta percorrer de ponta a ponta no navegador com cada papel'],
    }),
  ],
};

export default parity;
