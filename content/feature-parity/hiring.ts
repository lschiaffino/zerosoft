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
 * reports, GDPR), leída el 2026-10-29, contra el código de esta primera
 * versión. Los ids son estables.
 */
const parity: ProductParity = {
  competitor: 'Workable',
  lastReviewed: '2026-10-29',
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
    row('job-requisitions', 'jobs', ['Job requisitions and approvals', 'Solicitudes de puesto con aprobación', 'Requisições de vaga com aprovação'], 'missing'),
    row('multiposting', 'jobs', ['Posting to job boards (LinkedIn, Indeed…)', 'Publicación en portales (LinkedIn, Indeed…)', 'Publicação em portais (LinkedIn, Indeed…)'], 'missing', {
      weight: 2,
      detail: ['Only the careers page, its sitemap and JobPosting data for Google for Jobs', 'Solo la página de empleos, su sitemap y los datos JobPosting para Google for Jobs', 'Só a página de vagas, seu sitemap e os dados JobPosting para o Google for Jobs'],
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
      detail: ['PDF, DOC or DOCX checked by their bytes, stored privately', 'PDF, DOC o DOCX validados por sus bytes y guardados en privado', 'PDF, DOC ou DOCX validados pelos bytes e guardados em privado'],
    }),
    row('knockout', 'careers', ['Knock-out questions', 'Preguntas knock-out', 'Perguntas eliminatórias'], 'partial', {
      detail: ['The application is flagged for review; it is not disqualified on its own', 'La postulación queda marcada para revisar; no se descarta sola', 'A candidatura fica marcada para análise; não é desclassificada sozinha'],
    }),
    row('anti-spam', 'careers', ['Spam protection', 'Protección contra spam', 'Proteção contra spam'], 'have', {
      detail: ['Rate limit per IP and a hidden trap field', 'Límite por IP y un campo trampa oculto', 'Limite por IP e um campo armadilha oculto'],
    }),

    // Candidatos
    row('candidate-profile', 'candidates', ['Candidate profile with resume viewer', 'Perfil con visor de CV', 'Perfil com visualizador de currículo'], 'have', { weight: 2 }),
    row('tags-sources', 'candidates', ['Tags and source tracking', 'Etiquetas y fuente', 'Etiquetas e origem'], 'have', {
      detail: ['Careers page, referral, LinkedIn, manual, email, other, plus UTM parameters', 'Página de empleos, referido, LinkedIn, manual, email, otra, más parámetros UTM', 'Página de vagas, indicação, LinkedIn, manual, email, outra, mais parâmetros UTM'],
    }),
    row('duplicates', 'candidates', ['Duplicate detection', 'Detección de duplicados', 'Detecção de duplicados'], 'partial', {
      detail: ['Same email joins the existing candidate; no manual merge of two profiles', 'El mismo email se une al candidato existente; no hay fusión manual de dos perfiles', 'O mesmo email se junta ao candidato existente; não há fusão manual de dois perfis'],
    }),
    row('timeline', 'candidates', ['Activity timeline', 'Línea de tiempo', 'Linha do tempo'], 'have', {
      detail: ['Every email, reply, note, stage move, scorecard, interview and offer', 'Cada email, respuesta, nota, cambio de etapa, scorecard, entrevista y oferta', 'Cada email, resposta, nota, mudança de etapa, scorecard, entrevista e oferta'],
    }),
    row('bulk-actions', 'candidates', ['Bulk actions', 'Acciones en lote', 'Ações em lote'], 'have', {
      detail: ['Move stage, reject with a template email, tag', 'Mover de etapa, rechazar con email de plantilla, etiquetar', 'Mover de etapa, reprovar com email de modelo, etiquetar'],
    }),
    row('sourcing', 'candidates', ['Sourcing and talent pool search', 'Búsqueda de candidatos y talent pool', 'Busca de candidatos e banco de talentos'], 'missing', { weight: 2 }),
    row('candidate-import', 'candidates', ['Candidate import', 'Importar candidatos', 'Importar candidatos'], 'missing'),

    // Pipeline
    row('kanban', 'pipeline', ['Kanban per job with drag and drop', 'Kanban por puesto para arrastrar', 'Kanban por vaga com arrastar'], 'have', { weight: 2 }),
    row('list-filters', 'pipeline', ['List view with filters', 'Lista con filtros', 'Lista com filtros'], 'have'),

    // Evaluación
    row('scorecards', 'evaluation', ['Scorecards per stage', 'Scorecards por etapa', 'Scorecards por etapa'], 'have', {
      weight: 2,
      detail: ['Up to 10 criteria rated 1 to 4 and an overall recommendation', 'Hasta 10 criterios del 1 al 4 y una recomendación general', 'Até 10 critérios de 1 a 4 e uma recomendação geral'],
    }),
    row('blind-scores', 'evaluation', ["Others' scores hidden until you submit", 'Puntajes ajenos ocultos hasta enviar el tuyo', 'Notas dos outros ocultas até enviar a sua'], 'have'),
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
    row('offer-approval', 'offers', ['Offer approval', 'Aprobación de ofertas', 'Aprovação de ofertas'], 'partial', {
      detail: ['One approval by the hiring manager or an admin; no multi-step chains', 'Una aprobación del hiring manager o un admin; sin cadenas de varios pasos', 'Uma aprovação do gestor ou de um admin; sem cadeias de várias etapas'],
    }),
    row('offer-accept', 'offers', ['Candidate accepts or declines online', 'El candidato acepta o rechaza en línea', 'O candidato aceita ou recusa online'], 'have', {
      detail: ['Typed full name with date, IP, browser and a hash of the letter on record', 'Nombre escrito con fecha, IP, navegador y hash de la carta registrados', 'Nome digitado com data, IP, navegador e hash da carta registrados'],
    }),
    row('e-signature', 'offers', ['Electronic signature', 'Firma electrónica', 'Assinatura eletrônica'], 'missing'),

    // Reportes
    row('time-to-hire', 'reports', ['Time to hire', 'Tiempo hasta contratar', 'Tempo até contratar'], 'have'),
    row('conversion', 'reports', ['Pipeline conversion by stage', 'Conversión por etapa', 'Conversão por etapa'], 'have'),
    row('source-report', 'reports', ['Source effectiveness', 'Efectividad por fuente', 'Efetividade por origem'], 'have'),
    row('open-jobs-report', 'reports', ['Open jobs report', 'Reporte de puestos abiertos', 'Relatório de vagas abertas'], 'have'),
    row('eeo-reports', 'reports', ['EEO and custom reports', 'Reportes EEO y propios', 'Relatórios EEO e personalizados'], 'missing'),

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
      detail: ['Reads PDF resumes only; AI never rejects, ranks or scores', 'Lee solo CVs en PDF; la IA nunca rechaza, ordena ni puntúa', 'Lê só currículos em PDF; a IA nunca reprova, ordena nem pontua'],
    }),
    row('automations', 'platform', ['Automations on stage changes and hires', 'Automatizaciones al cambiar de etapa y contratar', 'Automações ao mudar de etapa e contratar'], 'have', {
      detail: ['Flow triggers: applied, stage changed, hired', 'Disparadores de Flow: postulación, cambio de etapa, contratación', 'Gatilhos do Flow: candidatura, mudança de etapa, contratação'],
    }),
    row('api', 'platform', ['API', 'API', 'API'], 'partial', {
      detail: ['Read jobs and the candidates the key can see (hiring:read)', 'Lectura de puestos y de los candidatos que la key puede ver (hiring:read)', 'Leitura de vagas e dos candidatos que a key pode ver (hiring:read)'],
    }),
    row('hris-handoff', 'platform', ['Hand-off to HR on hire', 'Paso a RR. HH. al contratar', 'Passagem para o RH ao contratar'], 'partial', {
      detail: ['A server hook and a Flow event on every hire; the People app is not built yet', 'Un gancho en el servidor y un evento de Flow en cada contratación; la app People todavía no existe', 'Um gancho no servidor e um evento do Flow a cada contratação; o app People ainda não existe'],
    }),
    row('assistant', 'platform', ['AI assistant over your pipeline', 'Asistente sobre tu pipeline', 'Assistente sobre seu pipeline'], 'better', {
      competitorHas: false,
      detail: ['Reads jobs and candidates you can see; moves and notes after you confirm', 'Lee puestos y candidatos que podés ver; mueve y deja notas cuando confirmás', 'Lê vagas e candidatos que você pode ver; move e deixa notas quando você confirma'],
    }),
    row('mobile-app', 'platform', ['Mobile app', 'App móvil', 'App móvel'], 'missing'),
  ],
};

export default parity;
