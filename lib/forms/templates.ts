/**
 * Forms: plantillas (contacto, leads, NPS, RSVP, postulación, feedback, quiz…).
 * Cada una arma la definición en el idioma de quien la crea (en/es/pt), con
 * lógica real donde suma: ramas por respuesta, puntaje y finales por camino.
 */
import { emptyDefinition } from './engine';
import type { FormDefinition, FormLang, Question } from './types';

type Tri = [string, string, string];
const pick = (lang: FormLang, t: Tri) => (lang === 'es' ? t[1] : lang === 'pt' ? t[2] : t[0]);

export const TEMPLATE_IDS = ['contact', 'lead', 'nps', 'rsvp', 'job', 'feedback', 'quiz', 'csat', 'registration', 'order', 'bug', 'research'] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export function isTemplateId(v: string): v is TemplateId {
  return (TEMPLATE_IDS as readonly string[]).includes(v);
}

function q(lang: FormLang, base: Omit<Question, 'title' | 'description' | 'required'> & { title: Tri; description?: Tri; required?: boolean; choiceLabels?: Tri[]; rowLabels?: Tri[]; colLabels?: Tri[]; left?: Tri; right?: Tri }): Question {
  const { title, description, choiceLabels, rowLabels, colLabels, left, right, required, ...rest } = base;
  return {
    ...rest,
    title: pick(lang, title),
    description: description ? pick(lang, description) : '',
    required: required ?? false,
    ...(choiceLabels ? { choices: choiceLabels.map((c, i) => ({ id: `c${i + 1}`, label: pick(lang, c), ...(rest.choices?.[i]?.points !== undefined ? { points: rest.choices[i].points } : {}) })) } : {}),
    ...(rowLabels ? { rows: rowLabels.map((c, i) => ({ id: `r${i + 1}`, label: pick(lang, c) })) } : {}),
    ...(colLabels ? { columns: colLabels.map((c, i) => ({ id: `k${i + 1}`, label: pick(lang, c) })) } : {}),
    ...(left ? { leftLabel: pick(lang, left) } : {}),
    ...(right ? { rightLabel: pick(lang, right) } : {}),
  };
}

const T = {
  name: ['What is your name?', '¿Cómo te llamás?', 'Qual é o seu nome?'] as Tri,
  email: ['What is your email?', '¿Cuál es tu email?', 'Qual é o seu email?'] as Tri,
  thanks: ['Thanks, {{name}}!', '¡Gracias, {{name}}!', 'Obrigado, {{name}}!'] as Tri,
  thanksPlain: ['Thanks for your answers.', 'Gracias por tus respuestas.', 'Obrigado pelas suas respostas.'] as Tri,
  start: ['Start', 'Empezar', 'Começar'] as Tri,
};

function base(lang: FormLang, welcome: [Tri, Tri] | null, endings: Array<{ id: string; title: Tri; description?: Tri }>): FormDefinition {
  const d = emptyDefinition(lang);
  if (welcome) d.welcome = { enabled: true, title: pick(lang, welcome[0]), description: pick(lang, welcome[1]), button: pick(lang, T.start) };
  d.endings = endings.map((e) => ({ id: e.id, title: pick(lang, e.title), description: e.description ? pick(lang, e.description) : '' }));
  return d;
}

export interface TemplateInfo {
  id: TemplateId;
  /** Lleva lógica (ramas, puntaje o finales por camino). */
  logic: boolean;
}

export const TEMPLATES: TemplateInfo[] = [
  { id: 'contact', logic: false },
  { id: 'lead', logic: true },
  { id: 'nps', logic: true },
  { id: 'rsvp', logic: true },
  { id: 'job', logic: false },
  { id: 'feedback', logic: true },
  { id: 'quiz', logic: true },
  { id: 'csat', logic: false },
  { id: 'registration', logic: false },
  { id: 'order', logic: false },
  { id: 'bug', logic: true },
  { id: 'research', logic: false },
];

export function templateDefinition(id: TemplateId, lang: FormLang): FormDefinition {
  switch (id) {
    case 'contact': {
      const d = base(lang, null, [{ id: 'end_thanks', title: T.thanks, description: ['We will get back to you soon.', 'Te respondemos pronto.', 'Respondemos em breve.'] }]);
      d.questions = [
        q(lang, { id: 'q_name', ref: 'name', type: 'short_text', title: T.name, required: true }),
        q(lang, { id: 'q_email', ref: 'email', type: 'email', title: T.email, required: true }),
        q(lang, { id: 'q_message', ref: 'message', type: 'long_text', title: ['How can we help, {{name}}?', '¿En qué te ayudamos, {{name}}?', 'Como podemos ajudar, {{name}}?'], required: true }),
      ];
      return d;
    }
    case 'lead': {
      const d = base(lang, [['Let us find the right plan for you', 'Encontremos el plan para tu equipo', 'Vamos encontrar o plano certo'], ['Four questions, under a minute.', 'Cuatro preguntas, menos de un minuto.', 'Quatro perguntas, menos de um minuto.']], [
        { id: 'end_sales', title: ['Thanks, {{name}}. Someone from sales will email you today.', 'Gracias, {{name}}. Alguien de ventas te escribe hoy.', 'Obrigado, {{name}}. Alguém de vendas vai te escrever hoje.'] },
        { id: 'end_self', title: ['Thanks, {{name}}. You can start on your own right away.', 'Gracias, {{name}}. Podés empezar por tu cuenta ya mismo.', 'Obrigado, {{name}}. Você pode começar agora mesmo.'] },
      ]);
      d.questions = [
        q(lang, { id: 'q_name', ref: 'name', type: 'short_text', title: T.name, required: true }),
        q(lang, { id: 'q_email', ref: 'email', type: 'email', title: ['Your work email', 'Tu email de trabajo', 'Seu email de trabalho'], required: true }),
        q(lang, { id: 'q_company', ref: 'company', type: 'short_text', title: ['Which company are you with?', '¿En qué empresa trabajás?', 'Em qual empresa você trabalha?'] }),
        q(lang, {
          id: 'q_size',
          ref: 'team_size',
          type: 'choice',
          title: ['How big is your team?', '¿Qué tamaño tiene tu equipo?', 'Qual o tamanho da sua equipe?'],
          required: true,
          choiceLabels: [['1-10', '1-10', '1-10'], ['11-50', '11-50', '11-50'], ['51-200', '51-200', '51-200'], ['More than 200', 'Más de 200', 'Mais de 200']],
        }),
        q(lang, { id: 'q_phone', ref: 'phone', type: 'phone', title: ['A phone number for the call', 'Un teléfono para la llamada', 'Um telefone para a ligação'] }),
      ];
      d.logic = {
        q_size: [
          { id: 'r_small', match: 'any', conditions: [{ left: 'q:q_size', op: 'is', value: 'c1' }, { left: 'q:q_size', op: 'is', value: 'c2' }], actions: [{ type: 'jump', to: 'end:end_self' }] },
        ],
        q_phone: [{ id: 'r_sales', match: 'all', conditions: [], actions: [{ type: 'jump', to: 'end:end_sales' }] }],
      };
      d.hidden = ['utm_source'];
      return d;
    }
    case 'nps': {
      const d = base(lang, null, [{ id: 'end_thanks', title: T.thanksPlain }]);
      d.questions = [
        q(lang, { id: 'q_score', ref: 'score_nps', type: 'opinion_scale', nps: true, steps: 11, start: 0, title: ['How likely are you to recommend us to a friend or colleague?', '¿Qué tan probable es que nos recomiendes a un amigo o colega?', 'Qual a chance de você nos recomendar a um amigo ou colega?'], required: true, left: ['Not likely', 'Poco probable', 'Pouco provável'], right: ['Very likely', 'Muy probable', 'Muito provável'] }),
        q(lang, { id: 'q_low', ref: 'improve', type: 'long_text', title: ['Sorry to hear that. What should we fix first?', 'Lamentamos. ¿Qué deberíamos arreglar primero?', 'Sentimos muito. O que devemos corrigir primeiro?'] }),
        q(lang, { id: 'q_mid', ref: 'missing', type: 'long_text', title: ['What would make it a 10?', '¿Qué haría falta para que sea un 10?', 'O que faltaria para ser um 10?'] }),
        q(lang, { id: 'q_high', ref: 'love', type: 'long_text', title: ['Great! What do you like most?', '¡Genial! ¿Qué es lo que más te gusta?', 'Ótimo! Do que você mais gosta?'] }),
        q(lang, { id: 'q_email', ref: 'email', type: 'email', title: ['Can we follow up? Leave your email (optional).', '¿Te podemos escribir? Dejá tu email (opcional).', 'Podemos te escrever? Deixe seu email (opcional).'] }),
      ];
      d.logic = {
        q_score: [
          { id: 'r_low', match: 'all', conditions: [{ left: 'q:q_score', op: 'lte', value: '6' }], actions: [{ type: 'jump', to: 'q:q_low' }] },
          { id: 'r_mid', match: 'all', conditions: [{ left: 'q:q_score', op: 'lte', value: '8' }], actions: [{ type: 'jump', to: 'q:q_mid' }] },
          { id: 'r_high', match: 'all', conditions: [], actions: [{ type: 'jump', to: 'q:q_high' }] },
        ],
        q_low: [{ id: 'r_low_next', match: 'all', conditions: [], actions: [{ type: 'jump', to: 'q:q_email' }] }],
        q_mid: [{ id: 'r_mid_next', match: 'all', conditions: [], actions: [{ type: 'jump', to: 'q:q_email' }] }],
      };
      return d;
    }
    case 'rsvp': {
      const d = base(lang, [['You are invited', 'Estás invitado', 'Você está convidado'], ['Let us know if you can make it.', 'Contanos si venís.', 'Conte para a gente se você vem.']], [
        { id: 'end_yes', title: ['See you there, {{name}}!', '¡Nos vemos, {{name}}!', 'Até lá, {{name}}!'] },
        { id: 'end_no', title: ['Sorry you cannot make it, {{name}}.', 'Qué pena que no puedas venir, {{name}}.', 'Que pena que você não pode vir, {{name}}.'] },
      ]);
      d.questions = [
        q(lang, { id: 'q_name', ref: 'name', type: 'short_text', title: T.name, required: true }),
        q(lang, { id: 'q_email', ref: 'email', type: 'email', title: T.email, required: true }),
        q(lang, { id: 'q_attend', ref: 'attending', type: 'yes_no', title: ['Will you attend?', '¿Vas a venir?', 'Você vai comparecer?'], required: true }),
        q(lang, { id: 'q_guests', ref: 'guests', type: 'number', min: 0, max: 5, title: ['How many guests are you bringing?', '¿Cuántos acompañantes traés?', 'Quantos acompanhantes você vai trazer?'] }),
        q(lang, { id: 'q_diet', ref: 'diet', type: 'dropdown', title: ['Any dietary needs?', '¿Alguna restricción alimentaria?', 'Alguma restrição alimentar?'], choiceLabels: [['None', 'Ninguna', 'Nenhuma'], ['Vegetarian', 'Vegetariana', 'Vegetariana'], ['Vegan', 'Vegana', 'Vegana'], ['Gluten free', 'Sin TACC', 'Sem glúten']] }),
      ];
      d.logic = { q_attend: [{ id: 'r_no', match: 'all', conditions: [{ left: 'q:q_attend', op: 'is', value: 'no' }], actions: [{ type: 'jump', to: 'end:end_no' }] }] };
      d.endings = [d.endings[0], d.endings[1]];
      return d;
    }
    case 'job': {
      const d = base(lang, [['Join our team', 'Sumate al equipo', 'Junte-se ao time'], ['Tell us about yourself. It takes about five minutes.', 'Contanos sobre vos. Son unos cinco minutos.', 'Conte sobre você. Leva uns cinco minutos.']], [{ id: 'end_thanks', title: ['Thanks, {{name}}. We read every application.', 'Gracias, {{name}}. Leemos todas las postulaciones.', 'Obrigado, {{name}}. Lemos todas as candidaturas.'] }]);
      d.questions = [
        q(lang, { id: 'q_name', ref: 'name', type: 'short_text', title: ['Full name', 'Nombre completo', 'Nome completo'], required: true }),
        q(lang, { id: 'q_email', ref: 'email', type: 'email', title: T.email, required: true }),
        q(lang, { id: 'q_phone', ref: 'phone', type: 'phone', title: ['Phone', 'Teléfono', 'Telefone'] }),
        q(lang, { id: 'q_linkedin', ref: 'linkedin', type: 'url', title: ['LinkedIn or portfolio', 'LinkedIn o portfolio', 'LinkedIn ou portfólio'] }),
        q(lang, { id: 'q_role', ref: 'role', type: 'dropdown', title: ['Which role are you applying for?', '¿A qué puesto te postulás?', 'Para qual vaga você está se candidatando?'], required: true, choiceLabels: [['Engineering', 'Ingeniería', 'Engenharia'], ['Design', 'Diseño', 'Design'], ['Sales', 'Ventas', 'Vendas'], ['Support', 'Soporte', 'Suporte']] }),
        q(lang, { id: 'q_cv', ref: 'resume', type: 'file_upload', maxMb: 5, title: ['Upload your resume (PDF)', 'Subí tu CV (PDF)', 'Envie seu currículo (PDF)'], required: true }),
        q(lang, { id: 'q_why', ref: 'why', type: 'long_text', title: ['Why do you want to work with us?', '¿Por qué querés trabajar con nosotros?', 'Por que você quer trabalhar com a gente?'] }),
        q(lang, { id: 'q_start', ref: 'start_date', type: 'date', title: ['When could you start?', '¿Cuándo podrías empezar?', 'Quando você poderia começar?'] }),
      ];
      d.consent = { enabled: true, required: true, text: pick(lang, ['I agree that my data is stored to evaluate my application.', 'Acepto que se guarden mis datos para evaluar mi postulación.', 'Concordo que meus dados sejam guardados para avaliar minha candidatura.']) };
      return d;
    }
    case 'feedback': {
      const d = base(lang, null, [{ id: 'end_thanks', title: T.thanksPlain }]);
      d.questions = [
        q(lang, { id: 'q_rating', ref: 'rating', type: 'rating', steps: 5, title: ['How was your experience?', '¿Cómo fue tu experiencia?', 'Como foi sua experiência?'], required: true }),
        q(lang, { id: 'q_bad', ref: 'what_went_wrong', type: 'multi_choice', title: ['What went wrong?', '¿Qué salió mal?', 'O que deu errado?'], choiceLabels: [['Too slow', 'Muy lento', 'Muito lento'], ['Hard to use', 'Difícil de usar', 'Difícil de usar'], ['Missing features', 'Faltan funciones', 'Faltam funções'], ['Price', 'Precio', 'Preço']] }),
        q(lang, { id: 'q_comment', ref: 'comment', type: 'long_text', title: ['Anything else you want to tell us?', '¿Algo más que nos quieras contar?', 'Algo mais que queira nos contar?'] }),
      ];
      d.logic = { q_rating: [{ id: 'r_good', match: 'all', conditions: [{ left: 'q:q_rating', op: 'gte', value: '4' }], actions: [{ type: 'jump', to: 'q:q_comment' }] }] };
      return d;
    }
    case 'quiz': {
      const d = base(lang, [['Quick quiz', 'Quiz rápido', 'Quiz rápido'], ['Three questions. See your score at the end.', 'Tres preguntas. Al final ves tu puntaje.', 'Três perguntas. Veja sua pontuação no final.']], [
        { id: 'end_pass', title: ['You scored {{score}} out of 3. Well done!', 'Sacaste {{score}} de 3. ¡Muy bien!', 'Você fez {{score}} de 3. Muito bem!'] },
        { id: 'end_fail', title: ['You scored {{score}} out of 3. Try again?', 'Sacaste {{score}} de 3. ¿Probás de nuevo?', 'Você fez {{score}} de 3. Tentar de novo?'] },
      ]);
      d.questions = [
        q(lang, { id: 'q_1', ref: 'q1', type: 'choice', title: ['What is the capital of Brazil?', '¿Cuál es la capital de Brasil?', 'Qual é a capital do Brasil?'], required: true, choices: [{ id: 'c1', label: '' }, { id: 'c2', label: '', points: 1 }, { id: 'c3', label: '' }], choiceLabels: [['São Paulo', 'São Paulo', 'São Paulo'], ['Brasília', 'Brasilia', 'Brasília'], ['Rio de Janeiro', 'Río de Janeiro', 'Rio de Janeiro']] }),
        q(lang, { id: 'q_2', ref: 'q2', type: 'choice', title: ['How many minutes are in an hour?', '¿Cuántos minutos tiene una hora?', 'Quantos minutos tem uma hora?'], required: true, choices: [{ id: 'c1', label: '', points: 1 }, { id: 'c2', label: '' }, { id: 'c3', label: '' }], choiceLabels: [['60', '60', '60'], ['100', '100', '100'], ['30', '30', '30']] }),
        q(lang, { id: 'q_3', ref: 'q3', type: 'yes_no', title: ['Is water wet?', '¿El agua moja?', 'A água molha?'], required: true }),
      ];
      d.logic = {
        q_3: [
          { id: 'r_pt', match: 'all', conditions: [{ left: 'q:q_3', op: 'is', value: 'yes' }], actions: [{ type: 'calc', variable: 'score', op: 'add', value: 1 }] },
          { id: 'r_pass', match: 'all', conditions: [{ left: 'v:score', op: 'gte', value: '2' }], actions: [{ type: 'jump', to: 'end:end_pass' }] },
          { id: 'r_fail', match: 'all', conditions: [], actions: [{ type: 'jump', to: 'end:end_fail' }] },
        ],
      };
      return d;
    }
    case 'csat': {
      const d = base(lang, null, [{ id: 'end_thanks', title: T.thanksPlain }]);
      d.questions = [
        q(lang, { id: 'q_overall', ref: 'overall', type: 'rating', steps: 5, title: ['How satisfied are you overall?', '¿Qué tan conforme estás en general?', 'Qual sua satisfação geral?'], required: true }),
        q(lang, {
          id: 'q_matrix',
          ref: 'aspects',
          type: 'matrix',
          title: ['Rate each part of the service', 'Calificá cada parte del servicio', 'Avalie cada parte do serviço'],
          rowLabels: [['Speed', 'Velocidad', 'Velocidade'], ['Friendliness', 'Amabilidad', 'Simpatia'], ['Solution', 'Solución', 'Solução']],
          colLabels: [['Bad', 'Mal', 'Ruim'], ['OK', 'Bien', 'Ok'], ['Great', 'Muy bien', 'Ótimo']],
        }),
        q(lang, { id: 'q_comment', ref: 'comment', type: 'long_text', title: ['What could we do better?', '¿Qué podríamos mejorar?', 'O que poderíamos melhorar?'] }),
      ];
      return d;
    }
    case 'registration': {
      const d = base(lang, [['Workshop registration', 'Inscripción al taller', 'Inscrição no workshop'], ['Save your spot.', 'Reservá tu lugar.', 'Garanta sua vaga.']], [{ id: 'end_thanks', title: ['You are in, {{name}}. Check your email for the details.', 'Ya estás, {{name}}. Revisá tu email para los detalles.', 'Pronto, {{name}}. Veja os detalhes no seu email.'] }]);
      d.questions = [
        q(lang, { id: 'q_name', ref: 'name', type: 'short_text', title: T.name, required: true }),
        q(lang, { id: 'q_email', ref: 'email', type: 'email', title: T.email, required: true }),
        q(lang, { id: 'q_session', ref: 'session', type: 'choice', title: ['Which session?', '¿Qué turno?', 'Qual sessão?'], required: true, choiceLabels: [['Morning', 'Mañana', 'Manhã'], ['Afternoon', 'Tarde', 'Tarde']] }),
        q(lang, { id: 'q_level', ref: 'level', type: 'opinion_scale', steps: 5, start: 1, title: ['How much do you know about the topic?', '¿Cuánto sabés del tema?', 'Quanto você sabe sobre o tema?'], left: ['Nothing', 'Nada', 'Nada'], right: ['A lot', 'Mucho', 'Muito'] }),
      ];
      d.consent = { enabled: true, required: false, text: pick(lang, ['Send me news about future workshops.', 'Quiero recibir novedades de próximos talleres.', 'Quero receber novidades de próximos workshops.']) };
      return d;
    }
    case 'order': {
      const d = base(lang, null, [{ id: 'end_thanks', title: ['Request received, {{name}}.', 'Recibimos tu pedido, {{name}}.', 'Recebemos seu pedido, {{name}}.'] }]);
      d.questions = [
        q(lang, { id: 'q_name', ref: 'name', type: 'short_text', title: T.name, required: true }),
        q(lang, { id: 'q_email', ref: 'email', type: 'email', title: T.email, required: true }),
        q(lang, { id: 'q_product', ref: 'product', type: 'dropdown', title: ['What would you like to order?', '¿Qué querés pedir?', 'O que você quer pedir?'], required: true, choiceLabels: [['Basic pack', 'Pack básico', 'Pacote básico'], ['Standard pack', 'Pack estándar', 'Pacote padrão'], ['Premium pack', 'Pack premium', 'Pacote premium']] }),
        q(lang, { id: 'q_qty', ref: 'quantity', type: 'number', min: 1, max: 100, title: ['Quantity', 'Cantidad', 'Quantidade'], required: true }),
        q(lang, { id: 'q_date', ref: 'delivery', type: 'date', title: ['Preferred delivery date', 'Fecha de entrega preferida', 'Data de entrega preferida'] }),
      ];
      return d;
    }
    case 'bug': {
      const d = base(lang, null, [{ id: 'end_thanks', title: ['Thanks. We will look into it.', 'Gracias. Lo vamos a revisar.', 'Obrigado. Vamos verificar.'] }, { id: 'end_urgent', title: ['Thanks. Critical reports go straight to the team on call.', 'Gracias. Los reportes críticos van directo a la guardia.', 'Obrigado. Relatos críticos vão direto para o plantão.'] }]);
      d.questions = [
        q(lang, { id: 'q_email', ref: 'email', type: 'email', title: T.email, required: true }),
        q(lang, { id: 'q_page', ref: 'page', type: 'url', title: ['On which page did it happen?', '¿En qué página pasó?', 'Em qual página aconteceu?'] }),
        q(lang, { id: 'q_severity', ref: 'severity', type: 'choice', title: ['How bad is it?', '¿Qué tan grave es?', 'Quão grave é?'], required: true, choiceLabels: [['Minor', 'Menor', 'Menor'], ['It blocks my work', 'Me bloquea el trabajo', 'Bloqueia meu trabalho'], ['Critical', 'Crítico', 'Crítico']] }),
        q(lang, { id: 'q_steps', ref: 'steps', type: 'long_text', title: ['What did you do, and what happened?', '¿Qué hiciste y qué pasó?', 'O que você fez e o que aconteceu?'], required: true }),
        q(lang, { id: 'q_shot', ref: 'screenshot', type: 'file_upload', maxMb: 5, title: ['A screenshot helps (optional)', 'Una captura ayuda (opcional)', 'Uma captura ajuda (opcional)'] }),
      ];
      d.logic = { q_shot: [{ id: 'r_urgent', match: 'all', conditions: [{ left: 'q:q_severity', op: 'is', value: 'c3' }], actions: [{ type: 'jump', to: 'end:end_urgent' }] }] };
      return d;
    }
    case 'research': {
      const d = base(lang, [['Help us build what you need', 'Ayudanos a construir lo que necesitás', 'Ajude a construir o que você precisa'], ['Five short questions.', 'Cinco preguntas cortas.', 'Cinco perguntas curtas.']], [{ id: 'end_thanks', title: T.thanksPlain }]);
      d.questions = [
        q(lang, { id: 'q_role', ref: 'role', type: 'short_text', title: ['What is your role?', '¿Cuál es tu rol?', 'Qual é o seu cargo?'] }),
        q(lang, { id: 'q_rank', ref: 'priorities', type: 'ranking', title: ['Rank these by importance', 'Ordená por importancia', 'Ordene por importância'], choiceLabels: [['Price', 'Precio', 'Preço'], ['Speed', 'Velocidad', 'Velocidade'], ['Integrations', 'Integraciones', 'Integrações'], ['Support', 'Soporte', 'Suporte']] }),
        q(lang, { id: 'q_effort', ref: 'effort', type: 'opinion_scale', steps: 7, start: 1, title: ['How easy is it to get your work done today?', '¿Qué tan fácil es hacer tu trabajo hoy?', 'Quão fácil é fazer seu trabalho hoje?'], left: ['Very hard', 'Muy difícil', 'Muito difícil'], right: ['Very easy', 'Muy fácil', 'Muito fácil'] }),
        q(lang, { id: 'q_tools', ref: 'tools', type: 'multi_choice', title: ['Which tools do you use?', '¿Qué herramientas usás?', 'Quais ferramentas você usa?'], choiceLabels: [['Spreadsheets', 'Planillas', 'Planilhas'], ['Email', 'Email', 'Email'], ['Chat', 'Chat', 'Chat'], ['A CRM', 'Un CRM', 'Um CRM']] }),
        q(lang, { id: 'q_wish', ref: 'wish', type: 'long_text', title: ['If you could change one thing, what would it be?', 'Si pudieras cambiar una cosa, ¿cuál sería?', 'Se pudesse mudar uma coisa, qual seria?'] }),
      ];
      return d;
    }
  }
}
