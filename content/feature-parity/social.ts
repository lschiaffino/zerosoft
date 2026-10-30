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

/** Las redes se construyeron contra la API oficial y se probaron con el modo falso; sin cuentas reales todavía. */
/** Funciona con las redes simuladas; con cuentas reales todavía no se probó. */
const SIMULATED: L = [
  'Works against simulated networks; not yet verified with live accounts',
  'Funciona con redes simuladas; todavía sin verificar con cuentas reales',
  'Funciona com redes simuladas; ainda sem verificar com contas reais',
];

const UNVERIFIED: L = [
  'Built on the official API and tested against a simulated network. Needs the instance admin\'s developer app; not yet verified with a live account',
  'Hecho sobre la API oficial y probado contra una red simulada. Necesita la app de desarrollador del admin de la instancia; todavía sin verificar con una cuenta real',
  'Feito sobre a API oficial e testado contra uma rede simulada. Precisa do app de desenvolvedor do admin da instância; ainda sem verificar com uma conta real',
];

/**
 * Social contra Hootsuite (plans y docs públicos, 2026-10-29). Las filas de
 * cada red quedan en parcial hasta probarlas con cuentas reales.
 */
const parity: ProductParity = {
  competitor: 'Hootsuite',
  alsoCompared: ['Buffer'],
  lastReviewed: '2026-10-29',
  areas: [
    { id: 'networks', label: loc(['Networks', 'Redes', 'Redes']) },
    { id: 'composer', label: loc(['Composer', 'Compositor', 'Editor']) },
    { id: 'calendar', label: loc(['Calendar and queue', 'Calendario y cola', 'Calendário e fila']) },
    { id: 'publishing', label: loc(['Publishing', 'Publicación', 'Publicação']) },
    { id: 'approvals', label: loc(['Team and approvals', 'Equipo y aprobaciones', 'Time e aprovações']) },
    { id: 'inbox', label: loc(['Inbox', 'Bandeja', 'Caixa de entrada']) },
    { id: 'analytics', label: loc(['Analytics', 'Métricas', 'Métricas']) },
    { id: 'library', label: loc(['Content library', 'Biblioteca', 'Biblioteca']) },
    { id: 'more', label: loc(['Beyond publishing', 'Más allá de publicar', 'Além de publicar']) },
  ],
  rows: [
    // Redes
    row('facebook', 'networks', ['Facebook pages', 'Páginas de Facebook', 'Páginas do Facebook'], 'partial', { weight: 2, detail: UNVERIFIED }),
    row('instagram', 'networks', ['Instagram business accounts (feed, carousels, reels)', 'Cuentas de empresa de Instagram (feed, carruseles, reels)', 'Contas comerciais do Instagram (feed, carrosséis, reels)'], 'partial', { weight: 2, detail: UNVERIFIED }),
    row('linkedin', 'networks', ['LinkedIn profiles and company pages', 'Perfiles y páginas de empresa de LinkedIn', 'Perfis e páginas de empresa do LinkedIn'], 'partial', {
      weight: 2,
      detail: [
        'Built on the official API; company pages need LinkedIn\'s Community Management API approval. Not yet verified with a live account',
        'Hecho sobre la API oficial; las páginas de empresa necesitan la aprobación de la Community Management API de LinkedIn. Todavía sin verificar con una cuenta real',
        'Feito sobre a API oficial; as páginas de empresa precisam da aprovação da Community Management API do LinkedIn. Ainda sem verificar com uma conta real',
      ],
    }),
    row('x', 'networks', ['X', 'X', 'X'], 'partial', {
      weight: 2,
      detail: ['Text and up to four photos; no video yet. Not yet verified with a live account', 'Texto y hasta cuatro fotos; todavía sin video. Sin verificar con una cuenta real', 'Texto e até quatro fotos; ainda sem vídeo. Sem verificar com uma conta real'],
    }),
    row('tiktok', 'networks', ['TikTok', 'TikTok', 'TikTok'], 'partial', {
      detail: [
        'Video only. Until TikTok audits the developer app, posts go out as private. Not yet verified with a live account',
        'Solo video. Hasta que TikTok audite la app de desarrollador, sale como privado. Sin verificar con una cuenta real',
        'Só vídeo. Até o TikTok auditar o app de desenvolvedor, sai como privado. Sem verificar com uma conta real',
      ],
    }),
    row('youtube', 'networks', ['YouTube', 'YouTube', 'YouTube'], 'partial', {
      detail: ['Video upload up to 10 MB (our upload limit). Not yet verified with a live account', 'Subida de video de hasta 10 MB (nuestro límite de subida). Sin verificar con una cuenta real', 'Envio de vídeo de até 10 MB (nosso limite de envio). Sem verificar com uma conta real'],
    }),
    row('threads', 'networks', ['Threads', 'Threads', 'Threads'], 'partial', { detail: UNVERIFIED }),
    row('bluesky', 'networks', ['Bluesky', 'Bluesky', 'Bluesky'], 'partial', {
      detail: [
        'App password, no developer app needed. Photos only, accounts hosted by Bluesky. Not yet verified with a live account',
        'Contraseña de app, sin app de desarrollador. Solo fotos, cuentas alojadas en Bluesky. Sin verificar con una cuenta real',
        'Senha de app, sem app de desenvolvedor. Só fotos, contas hospedadas no Bluesky. Sem verificar com uma conta real',
      ],
    }),
    row('pinterest', 'networks', ['Pinterest', 'Pinterest', 'Pinterest'], 'missing'),
    row('gbp', 'networks', ['Google Business Profile', 'Perfil de empresa de Google', 'Perfil da empresa no Google'], 'missing'),
    row('stories', 'networks', ['Instagram and Facebook stories', 'Historias de Instagram y Facebook', 'Stories do Instagram e do Facebook'], 'missing'),

    // Compositor
    row('multi-account', 'composer', ['One post to several accounts', 'Una publicación a varias cuentas', 'Uma publicação para várias contas'], 'have', { weight: 2 }),
    row('per-network-text', 'composer', ['Own text per network', 'Texto propio por red', 'Texto próprio por rede'], 'have', { weight: 2 }),
    row('previews', 'composer', ['Live preview per network', 'Vista previa por red', 'Prévia por rede'], 'partial', {
      detail: ['An approximation of each network\'s card, with where the text folds', 'Una aproximación a la tarjeta de cada red, con dónde corta el texto', 'Uma aproximação do cartão de cada rede, com onde o texto corta'],
    }),
    row('counters', 'composer', ['Character counters per network', 'Contador de caracteres por red', 'Contador de caracteres por rede'], 'have'),
    row('media', 'composer', ['Photos and video', 'Fotos y video', 'Fotos e vídeo'], 'partial', {
      weight: 2,
      detail: ['Up to 10 MB per file, the suite\'s upload limit', 'Hasta 10 MB por archivo, el límite de subida de la suite', 'Até 10 MB por arquivo, o limite de envio da suíte'],
    }),
    row('media-checks', 'composer', ['Media checks per network (size, ratio, length)', 'Chequeo de archivos por red (peso, proporción, duración)', 'Checagem de arquivos por rede (tamanho, proporção, duração)'], 'have'),
    row('shortener', 'composer', ['Link shortener with UTM', 'Acortador de links con UTM', 'Encurtador de links com UTM'], 'have', {
      detail: ['With the Link app, which also counts the clicks', 'Con la app Link, que además cuenta los clics', 'Com o app Link, que também conta os cliques'],
    }),
    row('first-comment', 'composer', ['First comment', 'Primer comentario', 'Primeiro comentário'], 'have'),
    row('hashtags', 'composer', ['Hashtags and mentions', 'Hashtags y menciones', 'Hashtags e menções'], 'partial', {
      detail: ['Highlighted and listed, plus saved hashtag sets; no suggestions or account search for mentions', 'Resaltados y listados, más grupos de hashtags guardados; sin sugerencias ni búsqueda de cuentas para mencionar', 'Destacados e listados, mais grupos de hashtags salvos; sem sugestões nem busca de contas para mencionar'],
    }),
    row('drafts', 'composer', ['Drafts', 'Borradores', 'Rascunhos'], 'have'),
    row('ai-writer', 'composer', ['AI writing assistant', 'Asistente de escritura con IA', 'Assistente de escrita com IA'], 'partial', {
      detail: ['The suite assistant (⌘J) drafts and schedules posts with confirmation; no generator inside the composer', 'El asistente de la suite (⌘J) arma y programa publicaciones con confirmación; sin generador dentro del compositor', 'O assistente da suíte (⌘J) cria e agenda publicações com confirmação; sem gerador dentro do editor'],
    }),
    row('image-editor', 'composer', ['Image editor and Canva', 'Editor de imágenes y Canva', 'Editor de imagens e Canva'], 'missing'),

    // Calendario
    row('calendar', 'calendar', ['Month and week calendar', 'Calendario de mes y semana', 'Calendário de mês e semana'], 'have', { weight: 2 }),
    row('list-view', 'calendar', ['List view with filters', 'Vista de lista con filtros', 'Visão de lista com filtros'], 'have'),
    row('drag', 'calendar', ['Drag to reschedule', 'Arrastrar para reprogramar', 'Arrastar para reagendar'], 'have'),
    row('queue', 'calendar', ['Recurring queue times per account', 'Horarios de cola por cuenta', 'Horários de fila por conta'], 'have'),
    row('best-time', 'calendar', ['Best time to post', 'Mejor horario para publicar', 'Melhor horário para publicar'], 'partial', {
      detail: ['From your own engagement once there are 10 posts with metrics; before that, starting times labeled as such', 'Con tus propias interacciones cuando hay 10 publicaciones con métricas; antes, horarios para empezar que lo dicen', 'Com suas próprias interações quando há 10 publicações com métricas; antes, horários para começar que dizem isso'],
    }),
    row('bulk', 'calendar', ['Bulk scheduling from CSV', 'Programación masiva por CSV', 'Agendamento em massa por CSV'], 'missing'),

    // Publicación
    row('scheduled', 'publishing', ['Scheduled publishing', 'Publicación programada', 'Publicação agendada'], 'have', { weight: 2 }),
    row('retries', 'publishing', ['Automatic retries', 'Reintentos automáticos', 'Novas tentativas automáticas'], 'partial', {
      detail: [
        'Up to five attempts with growing waits; permanent errors stop at once. Works against simulated networks; not yet verified with live accounts',
        'Hasta cinco intentos con esperas crecientes; los errores permanentes cortan enseguida. Funciona con redes simuladas; todavía sin verificar con cuentas reales',
        'Até cinco tentativas com esperas crescentes; erros permanentes param na hora. Funciona com redes simuladas; ainda sem verificar com contas reais',
      ],
    }),
    row('errors', 'publishing', ['Error per network and manual retry', 'Error por red y reintento manual', 'Erro por rede e nova tentativa manual'], 'have'),
    row('live-links', 'publishing', ['Links to the published posts', 'Links a lo publicado', 'Links para o que foi publicado'], 'partial', { detail: SIMULATED }),
    row('token-refresh', 'publishing', ['Token refresh and reconnect prompts', 'Renovación de tokens y aviso para reconectar', 'Renovação de tokens e aviso para reconectar'], 'partial', { detail: SIMULATED }),

    // Equipo
    row('roles', 'approvals', ['Members who need approval', 'Miembros que necesitan aprobación', 'Membros que precisam de aprovação'], 'have', { weight: 2 }),
    row('approve-reject', 'approvals', ['Approve or reject with a comment', 'Aprobar o rechazar con comentario', 'Aprovar ou recusar com comentário'], 'have'),
    row('approval-notify', 'approvals', ['Approval notifications', 'Avisos de aprobación', 'Avisos de aprovação'], 'have'),
    row('account-access', 'approvals', ['Access per social account', 'Acceso por cuenta', 'Acesso por conta'], 'have'),
    row('multi-step', 'approvals', ['Multi-step approval workflows', 'Aprobaciones de varios pasos', 'Aprovações em várias etapas'], 'missing'),

    // Bandeja
    row('meta-inbox', 'inbox', ['Facebook and Instagram comments and messages', 'Comentarios y mensajes de Facebook e Instagram', 'Comentários e mensagens do Facebook e do Instagram'], 'partial', {
      weight: 2,
      detail: ['Webhook with signature check plus polling. Not yet verified with a live account', 'Webhook con firma verificada más polling. Sin verificar con una cuenta real', 'Webhook com assinatura verificada mais polling. Sem verificar com uma conta real'],
    }),
    row('other-inbox', 'inbox', ['LinkedIn, YouTube, Threads and Bluesky comments', 'Comentarios de LinkedIn, YouTube, Threads y Bluesky', 'Comentários do LinkedIn, YouTube, Threads e Bluesky'], 'partial', { detail: UNVERIFIED }),
    row('x-inbox', 'inbox', ['X mentions', 'Menciones de X', 'Menções do X'], 'partial', {
      detail: ['Needs an X API plan that can read mentions', 'Necesita un plan de la API de X que lea menciones', 'Precisa de um plano da API do X que leia menções'],
    }),
    row('tiktok-inbox', 'inbox', ['TikTok comments', 'Comentarios de TikTok', 'Comentários do TikTok'], 'missing'),
    row('assign', 'inbox', ['Reply, assign and mark done', 'Contestar, asignar y marcar hecho', 'Responder, atribuir e marcar concluído'], 'have'),
    row('saved-replies', 'inbox', ['Saved replies and inbox automations', 'Respuestas guardadas y automatizaciones de la bandeja', 'Respostas salvas e automações da caixa'], 'missing'),

    // Métricas
    row('post-metrics', 'analytics', ['Metrics per post', 'Métricas por publicación', 'Métricas por publicação'], 'partial', {
      weight: 2,
      detail: ['Pulled every hour; each network gives a different set (LinkedIn only likes and comments)', 'Se traen cada hora; cada red da un set distinto (LinkedIn solo me gusta y comentarios)', 'Buscadas a cada hora; cada rede entrega um conjunto diferente (LinkedIn só curtidas e comentários)'],
    }),
    row('followers', 'analytics', ['Followers per account over time', 'Seguidores por cuenta en el tiempo', 'Seguidores por conta ao longo do tempo'], 'have'),
    row('csv', 'analytics', ['CSV export', 'Export a CSV', 'Exportação em CSV'], 'have'),
    row('reports', 'analytics', ['Custom and scheduled PDF reports', 'Reportes a medida y por email en PDF', 'Relatórios personalizados e agendados em PDF'], 'missing'),
    row('benchmarks', 'analytics', ['Competitor benchmarks', 'Comparación con competidores', 'Comparação com concorrentes'], 'missing'),

    // Biblioteca
    row('snippets', 'library', ['Saved texts', 'Textos guardados', 'Textos salvos'], 'have'),
    row('hashtag-sets', 'library', ['Hashtag sets', 'Grupos de hashtags', 'Grupos de hashtags'], 'have'),
    row('assets', 'library', ['Shared media library', 'Biblioteca de archivos compartida', 'Biblioteca de arquivos compartilhada'], 'have'),

    // Más
    row('listening', 'more', ['Social listening', 'Escucha social', 'Social listening'], 'missing', { weight: 2 }),
    row('ads', 'more', ['Paid ads', 'Anuncios pagos', 'Anúncios pagos'], 'missing'),
    row('advocacy', 'more', ['Employee advocacy', 'Employee advocacy', 'Employee advocacy'], 'missing'),
    row('mobile', 'more', ['Mobile app', 'App mobile', 'App mobile'], 'missing'),
    row('api', 'more', ['API to create and list posts', 'API para crear y listar publicaciones', 'API para criar e listar publicações'], 'have', {
      detail: ['API v1 with social:read and social:write keys', 'API v1 con keys social:read y social:write', 'API v1 com chaves social:read e social:write'],
    }),
    row('self-host', 'more', ['Runs on your own server with your developer apps', 'Corre en tu servidor con tus apps de desarrollador', 'Roda no seu servidor com seus apps de desenvolvedor'], 'better', { competitorHas: false }),
    row('suite', 'more', ['Same workspace as CRM, Link and Talk', 'El mismo workspace que el CRM, Link y Talk', 'O mesmo workspace do CRM, Link e Talk'], 'better', { competitorHas: false }),
  ],
};

export default parity;
