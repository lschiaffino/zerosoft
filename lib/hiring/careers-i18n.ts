/**
 * Textos de la página de empleos pública (fuera de next-intl: el idioma es el
 * de la página, no el del visitante). en/es/pt.
 */
export interface CareersStrings {
  skip: string;
  openRoles: string;
  noRoles: string;
  allJobs: string;
  apply: string;
  applyFor: string;
  name: string;
  email: string;
  phone: string;
  linkedin: string;
  resume: string;
  resumeHelp: string;
  optional: string;
  yes: string;
  no: string;
  choose: string;
  consentDefault: string;
  keepConsent: string;
  submit: string;
  sending: string;
  thanksTitle: string;
  thanksBody: string;
  errors: Record<string, string>;
  workplace: Record<string, string>;
  employment: Record<string, string>;
  period: Record<string, string>;
  salary: string;
  posted: string;
  poweredBy: string;
  offerTitle: string;
  offerFor: string;
  offerSalary: string;
  offerStart: string;
  offerAcceptHelp: string;
  offerSignName: string;
  offerAgree: string;
  offerAccept: string;
  offerDecline: string;
  offerDeclineReason: string;
  offerAccepted: string;
  offerDeclined: string;
  offerClosed: string;
  offerSignedAs: string;
  privacyTitle: string;
  privacyBody: string;
  privacyButton: string;
  privacyDone: string;
  notFound: string;
}

const en: CareersStrings = {
  skip: 'Skip to content',
  openRoles: 'Open roles',
  noRoles: 'There are no open roles right now. Check back soon.',
  allJobs: 'All jobs',
  apply: 'Apply',
  applyFor: 'Apply for this job',
  name: 'Full name',
  email: 'Email',
  phone: 'Phone',
  linkedin: 'LinkedIn profile',
  resume: 'Resume',
  resumeHelp: 'PDF, DOC or DOCX, up to 10 MB.',
  optional: 'optional',
  yes: 'Yes',
  no: 'No',
  choose: 'Choose one',
  consentDefault: 'I agree that {company} stores and processes my data to evaluate my application.',
  keepConsent: 'Keep my data for future openings.',
  submit: 'Submit application',
  sending: 'Sending…',
  thanksTitle: 'Application received',
  thanksBody: 'Thanks for applying. We sent you a confirmation by email and the team will get back to you.',
  errors: {
    invalid_input: 'Check the required fields.',
    invalid_email: 'Enter a valid email.',
    consent_required: 'You need to accept the data processing to apply.',
    resume_required: 'Attach your resume.',
    resume_type: 'The resume has to be a PDF, DOC or DOCX file.',
    resume_size: 'The resume can be up to 10 MB.',
    invalid_answers: 'Answer the required questions.',
    rate_limited: 'Too many attempts. Try again in a few minutes.',
    not_found: 'This job is no longer open.',
    name_mismatch: 'Type your full name exactly as it appears in the offer.',
    agree_required: 'Check the box to accept.',
    offer_closed: 'This offer was already answered or withdrawn.',
    generic: 'Something went wrong. Try again.',
  },
  workplace: { onsite: 'On-site', hybrid: 'Hybrid', remote: 'Remote' },
  employment: { full_time: 'Full-time', part_time: 'Part-time', contract: 'Contract', temporary: 'Temporary', internship: 'Internship' },
  period: { year: 'per year', month: 'per month', hour: 'per hour' },
  salary: 'Salary',
  posted: 'Posted',
  poweredBy: 'Careers page made with zerosoft Hiring',
  offerTitle: 'Your offer',
  offerFor: 'Offer from {company}',
  offerSalary: 'Salary',
  offerStart: 'Start date',
  offerAcceptHelp: 'To accept, type your full name as it appears in the letter. We keep a record with the date and time.',
  offerSignName: 'Your full name',
  offerAgree: 'I accept this offer.',
  offerAccept: 'Accept offer',
  offerDecline: 'Decline',
  offerDeclineReason: 'Reason (optional)',
  offerAccepted: 'You accepted the offer. Welcome aboard.',
  offerDeclined: 'You declined the offer. Thanks for letting us know.',
  offerClosed: 'This offer is closed.',
  offerSignedAs: 'Accepted by {name} on {date}.',
  privacyTitle: 'Delete my data',
  privacyBody: 'This deletes your applications, resume and every message we have from you at {company}. It cannot be undone.',
  privacyButton: 'Delete my data',
  privacyDone: 'Your data was deleted.',
  notFound: 'This page does not exist.',
};

const es: CareersStrings = {
  skip: 'Ir al contenido',
  openRoles: 'Puestos abiertos',
  noRoles: 'No hay puestos abiertos por ahora. Volvé a mirar pronto.',
  allJobs: 'Todos los puestos',
  apply: 'Postularme',
  applyFor: 'Postulate a este puesto',
  name: 'Nombre completo',
  email: 'Email',
  phone: 'Teléfono',
  linkedin: 'Perfil de LinkedIn',
  resume: 'CV',
  resumeHelp: 'PDF, DOC o DOCX, hasta 10 MB.',
  optional: 'opcional',
  yes: 'Sí',
  no: 'No',
  choose: 'Elegí una opción',
  consentDefault: 'Acepto que {company} guarde y procese mis datos para evaluar mi postulación.',
  keepConsent: 'Guardar mis datos para futuras búsquedas.',
  submit: 'Enviar postulación',
  sending: 'Enviando…',
  thanksTitle: 'Recibimos tu postulación',
  thanksBody: 'Gracias por postularte. Te mandamos una confirmación por email y el equipo te va a responder.',
  errors: {
    invalid_input: 'Revisá los campos obligatorios.',
    invalid_email: 'Escribí un email válido.',
    consent_required: 'Para postularte tenés que aceptar el tratamiento de tus datos.',
    resume_required: 'Adjuntá tu CV.',
    resume_type: 'El CV tiene que ser PDF, DOC o DOCX.',
    resume_size: 'El CV puede pesar hasta 10 MB.',
    invalid_answers: 'Respondé las preguntas obligatorias.',
    rate_limited: 'Demasiados intentos. Probá en unos minutos.',
    not_found: 'Este puesto ya no está abierto.',
    name_mismatch: 'Escribí tu nombre completo tal como figura en la oferta.',
    agree_required: 'Marcá la casilla para aceptar.',
    offer_closed: 'Esta oferta ya fue respondida o retirada.',
    generic: 'Algo salió mal. Probá de nuevo.',
  },
  workplace: { onsite: 'Presencial', hybrid: 'Híbrido', remote: 'Remoto' },
  employment: { full_time: 'Tiempo completo', part_time: 'Medio tiempo', contract: 'Contrato', temporary: 'Temporal', internship: 'Pasantía' },
  period: { year: 'por año', month: 'por mes', hour: 'por hora' },
  salary: 'Salario',
  posted: 'Publicado',
  poweredBy: 'Página de empleos hecha con zerosoft Hiring',
  offerTitle: 'Tu oferta',
  offerFor: 'Oferta de {company}',
  offerSalary: 'Salario',
  offerStart: 'Fecha de inicio',
  offerAcceptHelp: 'Para aceptar, escribí tu nombre completo como figura en la carta. Guardamos un registro con la fecha y la hora.',
  offerSignName: 'Tu nombre completo',
  offerAgree: 'Acepto esta oferta.',
  offerAccept: 'Aceptar oferta',
  offerDecline: 'Rechazar',
  offerDeclineReason: 'Motivo (opcional)',
  offerAccepted: 'Aceptaste la oferta. Te damos la bienvenida.',
  offerDeclined: 'Rechazaste la oferta. Gracias por avisarnos.',
  offerClosed: 'Esta oferta está cerrada.',
  offerSignedAs: 'Aceptada por {name} el {date}.',
  privacyTitle: 'Borrar mis datos',
  privacyBody: 'Esto borra tus postulaciones, tu CV y todos los mensajes que tenemos tuyos en {company}. No se puede deshacer.',
  privacyButton: 'Borrar mis datos',
  privacyDone: 'Tus datos fueron borrados.',
  notFound: 'Esta página no existe.',
};

const pt: CareersStrings = {
  skip: 'Ir para o conteúdo',
  openRoles: 'Vagas abertas',
  noRoles: 'Não há vagas abertas no momento. Volte em breve.',
  allJobs: 'Todas as vagas',
  apply: 'Candidatar-me',
  applyFor: 'Candidate-se a esta vaga',
  name: 'Nome completo',
  email: 'Email',
  phone: 'Telefone',
  linkedin: 'Perfil do LinkedIn',
  resume: 'Currículo',
  resumeHelp: 'PDF, DOC ou DOCX, até 10 MB.',
  optional: 'opcional',
  yes: 'Sim',
  no: 'Não',
  choose: 'Escolha uma opção',
  consentDefault: 'Concordo que a {company} armazene e processe meus dados para avaliar minha candidatura.',
  keepConsent: 'Guardar meus dados para futuras vagas.',
  submit: 'Enviar candidatura',
  sending: 'Enviando…',
  thanksTitle: 'Candidatura recebida',
  thanksBody: 'Obrigado por se candidatar. Enviamos uma confirmação por email e o time vai te responder.',
  errors: {
    invalid_input: 'Revise os campos obrigatórios.',
    invalid_email: 'Digite um email válido.',
    consent_required: 'Para se candidatar, aceite o tratamento dos seus dados.',
    resume_required: 'Anexe seu currículo.',
    resume_type: 'O currículo precisa ser PDF, DOC ou DOCX.',
    resume_size: 'O currículo pode ter até 10 MB.',
    invalid_answers: 'Responda as perguntas obrigatórias.',
    rate_limited: 'Muitas tentativas. Tente em alguns minutos.',
    not_found: 'Esta vaga não está mais aberta.',
    name_mismatch: 'Digite seu nome completo como aparece na oferta.',
    agree_required: 'Marque a caixa para aceitar.',
    offer_closed: 'Esta oferta já foi respondida ou retirada.',
    generic: 'Algo deu errado. Tente de novo.',
  },
  workplace: { onsite: 'Presencial', hybrid: 'Híbrido', remote: 'Remoto' },
  employment: { full_time: 'Tempo integral', part_time: 'Meio período', contract: 'Contrato', temporary: 'Temporário', internship: 'Estágio' },
  period: { year: 'por ano', month: 'por mês', hour: 'por hora' },
  salary: 'Salário',
  posted: 'Publicada',
  poweredBy: 'Página de vagas feita com zerosoft Hiring',
  offerTitle: 'Sua oferta',
  offerFor: 'Oferta da {company}',
  offerSalary: 'Salário',
  offerStart: 'Data de início',
  offerAcceptHelp: 'Para aceitar, digite seu nome completo como aparece na carta. Guardamos um registro com data e hora.',
  offerSignName: 'Seu nome completo',
  offerAgree: 'Aceito esta oferta.',
  offerAccept: 'Aceitar oferta',
  offerDecline: 'Recusar',
  offerDeclineReason: 'Motivo (opcional)',
  offerAccepted: 'Você aceitou a oferta. Boas-vindas.',
  offerDeclined: 'Você recusou a oferta. Obrigado por avisar.',
  offerClosed: 'Esta oferta está encerrada.',
  offerSignedAs: 'Aceita por {name} em {date}.',
  privacyTitle: 'Excluir meus dados',
  privacyBody: 'Isso exclui suas candidaturas, seu currículo e todas as mensagens que temos de você na {company}. Não dá para desfazer.',
  privacyButton: 'Excluir meus dados',
  privacyDone: 'Seus dados foram excluídos.',
  notFound: 'Esta página não existe.',
};

export function careersStrings(locale: string): CareersStrings {
  return locale === 'es' ? es : locale === 'pt' ? pt : en;
}

export function fill(s: string, vars: Record<string, string>): string {
  return s.replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? '');
}
