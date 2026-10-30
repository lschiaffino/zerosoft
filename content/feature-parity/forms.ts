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
 * Forms contra Typeform (ayuda y páginas de producto públicas, leídas el
 * 2026-10-30). Google Forms y Tally solo de referencia. Los saltos de lógica
 * solo van hacia adelante, igual que en Typeform. Los precios de Typeform no
 * se compararon.
 */
const parity: ProductParity = {
  competitor: 'Typeform',
  alsoCompared: ['Google Forms', 'Tally'],
  lastReviewed: '2026-10-30',
  areas: [
    { id: 'questions', label: loc(['Question types', 'Tipos de pregunta', 'Tipos de pergunta']) },
    { id: 'screens', label: loc(['Screens and fields', 'Pantallas y campos', 'Telas e campos']) },
    { id: 'logic', label: loc(['Logic and quizzes', 'Lógica y quizzes', 'Lógica e quizzes']) },
    { id: 'languages', label: loc(['Languages', 'Idiomas', 'Idiomas']) },
    { id: 'experience', label: loc(['Respondent experience', 'Experiencia de quien responde', 'Experiência de quem responde']) },
    { id: 'design', label: loc(['Design', 'Diseño', 'Design']) },
    { id: 'sharing', label: loc(['Sharing and embedding', 'Compartir e incrustar', 'Compartilhar e incorporar']) },
    { id: 'protection', label: loc(['Protection and privacy', 'Protección y privacidad', 'Proteção e privacidade']) },
    { id: 'responses', label: loc(['Responses and analysis', 'Respuestas y análisis', 'Respostas e análise']) },
    { id: 'integrations', label: loc(['Integrations', 'Integraciones', 'Integrações']) },
    { id: 'team', label: loc(['Team and AI', 'Equipo e IA', 'Equipe e IA']) },
  ],
  rows: [
    // Tipos de pregunta
    row('text-questions', 'questions', ['Short and long text', 'Texto corto y largo', 'Texto curto e longo'], 'have', { weight: 2 }),
    row('contact-questions', 'questions', ['Email, phone, number and website URL', 'Email, teléfono, número y URL', 'Email, telefone, número e URL'], 'have'),
    row('date-question', 'questions', ['Date', 'Fecha', 'Data'], 'have'),
    row('choice-questions', 'questions', ['Multiple choice, checkboxes and dropdown', 'Opción múltiple, casillas y desplegable', 'Múltipla escolha, caixas de seleção e lista suspensa'], 'have', { weight: 2 }),
    row('yes-no', 'questions', ['Yes or no', 'Sí o no', 'Sim ou não'], 'have'),
    row('rating-scale-nps', 'questions', ['Rating, opinion scale and NPS', 'Calificación, escala de opinión y NPS', 'Avaliação, escala de opinião e NPS'], 'have', { weight: 2 }),
    row('ranking', 'questions', ['Ranking', 'Ranking', 'Ranking'], 'have'),
    row('matrix', 'questions', ['Matrix', 'Matriz', 'Matriz'], 'have'),
    row('file-upload', 'questions', ['File upload', 'Subir archivos', 'Envio de arquivos'], 'have', {
      detail: [
        'Private files, type checked by their bytes, up to 10 MB',
        'Archivos privados, tipo verificado por sus bytes, hasta 10 MB',
        'Arquivos privados, tipo verificado pelos bytes, até 10 MB',
      ],
    }),
    row('signature', 'questions', ['Signature', 'Firma', 'Assinatura'], 'have', {
      detail: [
        'A simple signature: draw it or type your name',
        'Una firma simple: dibujarla o escribir el nombre',
        'Uma assinatura simples: desenhar ou digitar o nome',
      ],
    }),
    row('payments', 'questions', ['Payments in a form', 'Pagos dentro del formulario', 'Pagamentos dentro do formulário'], 'missing'),
    row('video-audio', 'questions', ['Video and audio questions', 'Preguntas de video y audio', 'Perguntas de vídeo e áudio'], 'missing'),

    // Pantallas y campos
    row('welcome-ending', 'screens', ['Welcome screen and several ending screens', 'Pantalla de bienvenida y varios finales', 'Tela de boas-vindas e vários finais'], 'have', { weight: 2 }),
    row('statement', 'screens', ['Statement screens', 'Pantallas de texto', 'Telas de texto'], 'have'),
    row('hidden-fields', 'screens', ['Hidden fields from URL parameters', 'Campos ocultos desde parámetros de la URL', 'Campos ocultos a partir de parâmetros da URL'], 'have'),
    row('validation', 'screens', ['Required fields and validation', 'Campos obligatorios y validación', 'Campos obrigatórios e validação'], 'have', {
      weight: 2,
      detail: [
        'Minimum and maximum length, value, number of choices and date range',
        'Largo mínimo y máximo, valor, cantidad de opciones y rango de fechas',
        'Tamanho mínimo e máximo, valor, número de opções e intervalo de datas',
      ],
    }),
    row('piping', 'screens', ['Answer piping', 'Respuestas anteriores dentro de las preguntas', 'Respostas anteriores dentro das perguntas'], 'have', {
      detail: [
        'Earlier answers and the score can be shown in later questions; files are not recalled',
        'Las respuestas anteriores y el puntaje se pueden mostrar en preguntas siguientes; los archivos no se retoman',
        'Respostas anteriores e a pontuação podem aparecer nas perguntas seguintes; arquivos não são retomados',
      ],
    }),

    // Lógica
    row('jumps', 'logic', ['Logic jumps by answer', 'Saltos de lógica según la respuesta', 'Saltos de lógica conforme a resposta'], 'have', {
      weight: 2,
      detail: [
        'Forward only, as in Typeform',
        'Solo hacia adelante, igual que en Typeform',
        'Só para a frente, como no Typeform',
      ],
    }),
    row('branching', 'logic', ['Branching with all or any conditions', 'Ramas con condiciones todas o alguna', 'Ramificações com condições todas ou qualquer uma'], 'have', { weight: 2 }),
    row('variables', 'logic', ['Calculated variables and score', 'Variables calculadas y puntaje', 'Variáveis calculadas e pontuação'], 'partial', {
      detail: [
        'Set, add, subtract, multiply and divide, with points per option for quizzes; no formula editor',
        'Asignar, sumar, restar, multiplicar y dividir, con puntos por opción para quizzes; sin editor de fórmulas',
        'Definir, somar, subtrair, multiplicar e dividir, com pontos por opção para quizzes; sem editor de fórmulas',
      ],
    }),
    row('quiz-endings', 'logic', ['Quizzes with endings per path', 'Quizzes con finales por camino', 'Quizzes com finais por caminho'], 'have'),

    // Idiomas
    row('multi-language', 'languages', ['Multi-language forms', 'Formularios en varios idiomas', 'Formulários em vários idiomas'], 'have', {
      weight: 2,
      detail: [
        'English, Spanish and Portuguese, with a translation table',
        'Inglés, español y portugués, con una tabla de traducción',
        'Inglês, espanhol e português, com uma tabela de tradução',
      ],
    }),

    // Experiencia
    row('one-at-a-time', 'experience', ['One question at a time', 'Una pregunta a la vez', 'Uma pergunta por vez'], 'have', { weight: 2 }),
    row('keyboard', 'experience', ['Keyboard answers', 'Respuestas con el teclado', 'Respostas pelo teclado'], 'have', {
      detail: [
        'Enter, letters A, B and C, Y and N, number keys and arrows',
        'Enter, letras A, B y C, Y y N, teclas numéricas y flechas',
        'Enter, letras A, B e C, Y e N, teclas numéricas e setas',
      ],
    }),
    row('classic-mode', 'experience', ['Classic mode with all questions on one page', 'Modo clásico con todas las preguntas en una página', 'Modo clássico com todas as perguntas numa página'], 'have'),
    row('progress', 'experience', ['Progress bar', 'Barra de progreso', 'Barra de progresso'], 'have'),
    row('save-resume', 'experience', ['Save and resume', 'Guardar y retomar', 'Salvar e retomar'], 'have', {
      detail: [
        'Saved in the respondent browser',
        'Se guarda en el navegador de quien responde',
        'Salvo no navegador de quem responde',
      ],
    }),
    row('partial-responses', 'experience', ['Partial responses', 'Respuestas parciales', 'Respostas parciais'], 'have', {
      detail: [
        'Sent only if the respondent agrees',
        'Se envían solo si quien responde acepta',
        'Enviadas só se quem responde aceitar',
      ],
    }),

    // Diseño
    row('themes', 'design', ['Themes and custom colors', 'Temas y colores propios', 'Temas e cores próprias'], 'have', {
      weight: 2,
      detail: [
        'Five presets and custom colors',
        'Cinco temas preparados y colores propios',
        'Cinco temas prontos e cores próprias',
      ],
    }),
    row('fonts', 'design', ['Fonts', 'Tipografías', 'Fontes'], 'have', {
      detail: ['Four fonts', 'Cuatro tipografías', 'Quatro fontes'],
    }),
    row('brand-kit', 'design', ['Colors from your brand kit', 'Colores de tu kit de marca', 'Cores do seu kit de marca'], 'have', {
      detail: [
        'Taken from the Design brand kit',
        'Salen del kit de marca de Design',
        'Vêm do kit de marca do Design',
      ],
    }),
    row('templates', 'design', ['Templates', 'Plantillas', 'Modelos'], 'have', {
      detail: [
        '12 templates: contact, lead generation, NPS, RSVP, job application, feedback, quiz, CSAT, workshop registration, order request, bug report and product research',
        '12 plantillas: contacto, captación de leads, NPS, RSVP, postulación, feedback, quiz, CSAT, inscripción a taller, pedido, reporte de error e investigación de producto',
        '12 modelos: contato, captação de leads, NPS, RSVP, candidatura, feedback, quiz, CSAT, inscrição em oficina, pedido, relato de erro e pesquisa de produto',
      ],
    }),
    row('drag-reorder', 'design', ['Drag and drop to reorder questions', 'Reordenar preguntas arrastrando', 'Reordenar perguntas arrastando'], 'partial', {
      detail: [
        'Buttons move a question up or down',
        'Botones para subir o bajar una pregunta',
        'Botões para subir ou descer uma pergunta',
      ],
    }),

    // Compartir
    row('public-link', 'sharing', ['Public link', 'Link público', 'Link público'], 'have', { weight: 2 }),
    row('embeds', 'sharing', ['Inline embed, iframe and popup', 'Embed en la página, iframe y popup', 'Embed na página, iframe e popup'], 'have', { weight: 2 }),
    row('qr', 'sharing', ['QR code', 'Código QR', 'Código QR'], 'have'),
    row('close-rules', 'sharing', ['Close by date or response limit', 'Cerrar por fecha o por cantidad de respuestas', 'Encerrar por data ou número de respostas'], 'have'),
    row('custom-domain', 'sharing', ['Custom domain for forms', 'Dominio propio para formularios', 'Domínio próprio para formulários'], 'missing'),

    // Protección
    row('spam', 'protection', ['Spam protection', 'Protección contra spam', 'Proteção contra spam'], 'partial', {
      detail: [
        'Honeypot, minimum time, rate limit and an optional limit per IP; no CAPTCHA option in Forms (CRM forms have Turnstile)',
        'Honeypot, tiempo mínimo, límite de frecuencia y un límite opcional por IP; sin opción de CAPTCHA en Forms (los formularios del CRM tienen Turnstile)',
        'Honeypot, tempo mínimo, limite de frequência e um limite opcional por IP; sem opção de CAPTCHA no Forms (os formulários do CRM têm Turnstile)',
      ],
    }),
    row('consent', 'protection', ['Consent checkbox', 'Casilla de consentimiento', 'Caixa de consentimento'], 'have'),
    row('retention', 'protection', ['Delete responses and retention', 'Borrar respuestas y retención', 'Excluir respostas e retenção'], 'have', {
      detail: [
        'Retention per form, with a default for the workspace',
        'Retención por formulario, con un valor por defecto del workspace',
        'Retenção por formulário, com um padrão para o workspace',
      ],
    }),
    row('form-access', 'protection', ['Access per form', 'Acceso por formulario', 'Acesso por formulário'], 'have', {
      detail: [
        'The whole workspace or chosen people',
        'Todo el workspace o las personas que elijas',
        'Todo o workspace ou as pessoas escolhidas',
      ],
    }),

    // Respuestas
    row('responses-table', 'responses', ['Responses table', 'Tabla de respuestas', 'Tabela de respostas'], 'have', {
      weight: 2,
      detail: [
        'Filters, search, date range and filter by answer',
        'Filtros, búsqueda, rango de fechas y filtro por respuesta',
        'Filtros, busca, intervalo de datas e filtro por resposta',
      ],
    }),
    row('single-response', 'responses', ['Individual response view', 'Vista de una respuesta', 'Visualização de uma resposta'], 'have'),
    row('csv-export', 'responses', ['CSV export', 'Exportar a CSV', 'Exportar para CSV'], 'have', {
      detail: [
        'With a guard against spreadsheet formulas',
        'Con protección contra fórmulas de planilla',
        'Com proteção contra fórmulas de planilha',
      ],
    }),
    row('summary', 'responses', ['Summary per question', 'Resumen por pregunta', 'Resumo por pergunta'], 'have', {
      weight: 2,
      detail: [
        'Bar charts, averages and NPS',
        'Gráficos de barras, promedios y NPS',
        'Gráficos de barras, médias e NPS',
      ],
    }),
    row('drop-off', 'responses', ['Drop-off per question', 'Abandono por pregunta', 'Abandono por pergunta'], 'have'),
    row('response-tags', 'responses', ['Tagging responses', 'Etiquetar respuestas', 'Etiquetar respostas'], 'missing'),
    row('ab-testing', 'responses', ['A/B testing', 'Pruebas A/B', 'Testes A/B'], 'missing'),

    // Integraciones
    row('notifications', 'integrations', ['Notifications on new responses', 'Avisos de respuestas nuevas', 'Avisos de novas respostas'], 'have', {
      detail: [
        'In the app to chosen people, and by email',
        'Dentro de la app a las personas que elijas, y por email',
        'Dentro do app para as pessoas escolhidas, e por email',
      ],
    }),
    row('crm-contacts', 'integrations', ['Create CRM contacts', 'Crear contactos del CRM', 'Criar contatos do CRM'], 'have', {
      detail: [
        'Only for new emails; an existing contact gets an unverified note and is never overwritten',
        'Solo para emails nuevos; un contacto existente recibe una nota sin verificar y nunca se sobrescribe',
        'Só para emails novos; um contato existente recebe uma nota não verificada e nunca é sobrescrito',
      ],
    }),
    row('flow-trigger', 'integrations', ['Automation trigger', 'Disparador de automatizaciones', 'Gatilho de automações'], 'have', {
      detail: [
        'Flow trigger forms.response.submitted',
        'Disparador de Flow forms.response.submitted',
        'Gatilho do Flow forms.response.submitted',
      ],
    }),
    row('webhook', 'integrations', ['Signed webhook per form', 'Webhook firmado por formulario', 'Webhook assinado por formulário'], 'have', { weight: 2 }),
    row('native-integrations', 'integrations', ['Native integrations such as Google Sheets', 'Integraciones nativas como Google Sheets', 'Integrações nativas como Google Sheets'], 'missing', {
      detail: [
        'Webhook and Flow instead',
        'Hay webhook y Flow',
        'Há webhook e Flow',
      ],
    }),
    row('zapier-app', 'integrations', ['Zapier app', 'App de Zapier', 'App do Zapier'], 'missing', {
      detail: [
        'Webhook and Flow instead',
        'Hay webhook y Flow',
        'Há webhook e Flow',
      ],
    }),
    row('api-read', 'integrations', ['API to read forms and responses', 'API para leer formularios y respuestas', 'API para ler formulários e respostas'], 'have', {
      detail: ['Read only, scope forms:read', 'Solo lectura, scope forms:read', 'Somente leitura, scope forms:read'],
    }),

    // Equipo e IA
    row('command-search', 'team', ['Find forms with Cmd+K', 'Buscar formularios con Cmd+K', 'Encontrar formulários com Cmd+K'], 'better', { competitorHas: false }),
    row('assistant', 'team', ['AI assistant over your forms', 'Asistente con IA sobre tus formularios', 'Assistente com IA sobre seus formulários'], 'better', {
      competitorHas: false,
      detail: [
        'Reads response counts, summaries and NPS; creates a form from a template or closes and reopens one only after you confirm',
        'Lee cantidad de respuestas, resúmenes y NPS; crea un formulario desde una plantilla o lo cierra y reabre solo después de que confirmás',
        'Lê quantidade de respostas, resumos e NPS; cria um formulário a partir de um modelo ou o encerra e reabre só depois que você confirma',
      ],
    }),
    row('ai-generation', 'team', ['AI form generation', 'Generar formularios con IA', 'Gerar formulários com IA'], 'missing'),
  ],
};

export default parity;
