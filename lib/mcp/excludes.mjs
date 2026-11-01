/**
 * Qué rutas NO entran al catálogo del MCP, con la razón, y correcciones a la
 * clase (lectura/escritura/destructiva) que el generador deduce.
 * Es .mjs porque lo leen scripts/mcp-catalog.mjs y el test de cobertura.
 *
 * Una ruta nueva entra sola al regenerar el catálogo salvo que coincida acá;
 * tests/unit/mcp-catalog.test.ts falla si una ruta no está en ninguno de los dos.
 */
const FAMILY_APPS = {
  crm: 'crm', chat: 'chat', groups: 'groups', agents: 'agents', flow: 'flow', robots: 'robots', track: 'track',
  links: 'link', link: 'link', docs: 'docs', notes: 'notes', calendar: 'cal', boards: 'board',
  voice: 'voice', rec: 'rec', talk: 'talk', design: 'design', shop: 'shop', analytics: 'analytics', social: 'social',
  hiring: 'hiring', people: 'people', books: 'books', sign: 'sign', forms: 'forms',
};

/** App de una ruta de API; 'workspace' para lo que no es de una app (equipo, avisos, búsqueda). */
export function appOfPath(url) {
  const seg = url.split('/').slice(2);
  const fam = seg[0] === 'v1' ? seg[1] : seg[0];
  return FAMILY_APPS[fam] ?? 'workspace';
}

const AUTH = 'login, session or OAuth endpoint: it mints credentials, so it stays out of reach of a token';
const CREDS = 'creates or reveals a credential (API key, client token, signing secret): a token must not be able to mint another one';
const CRON = 'cron: authenticated by CRON_SECRET, not by a person';
const INGEST = 'ingest: public SDK or write-key endpoint, no person behind it';
const INBOUND = 'inbound webhook from a third party, authenticated by a signature or secret in the URL';
const PUBLIC = 'public visitor flow, authenticated by a token in the URL or by nothing: it does not act as the logged-in person';
const STATIC = 'static asset or image generator, no data';
const BROWSER = 'browser redirect flow to connect a third party: it needs the person in a browser with cookies';
const REALTIME = 'realtime stream or collaboration channel that never ends: use the read operations instead';
const SELF = 'another MCP or the OAuth server itself: no recursion';
const UPLOAD = 'direct-to-Blob upload handshake for browsers; it returns a client upload token. Use the multipart operation of the app or a URL';
const ACCOUNT = 'workspace ownership or account-level change with no safe confirmation design over a token: do it in Settings';
const STAFF = 'zerosoft staff tool (ADMIN_EMAILS) or the signed roadmap ingest, not part of any customer workspace';
const ASSISTANT = 'nested assistant (a streaming model loop with its own tools and confirmations): Claude calls the operations directly';

/** Regla: [regex del path, razón, métodos opcionales]. La primera que coincide gana. */
export const EXCLUDE_RULES = [
  // Login, sesión y OAuth
  [/^\/api\/auth(\/|$)/, AUTH],
  [/^\/api\/desktop\/(login|token)$/, AUTH],
  [/^\/api\/gate$/, 'password gate of a public link: it issues a browser cookie'],
  [/^\/api\/oauth(\/|$)/, SELF],
  [/^\/api\/mcp(\/|$)/, SELF],
  [/^\/api\/v1\/[a-z-]+\/mcp$/, SELF],
  [/^\/api\/v1\/openapi\.json$/, STATIC],

  // Credenciales
  [/^\/api\/keys(\/|$)/, CREDS],
  [/^\/api\/analytics\/projects\/\[id\]\/secret$/, CREDS],
  [/^\/api\/books\/settings\/webhook-token$/, CREDS],
  [/^\/api\/crm\/voice\/token$/, CREDS],
  [/^\/api\/rec\/videos\/\[id\]\/upload-token$/, UPLOAD],

  // Cron, ingest, webhooks entrantes
  [/^\/api\/cron(\/|$)/, CRON],
  [/^\/api\/calendar\/reminders\/due$/, CRON],
  [/^\/api\/ingest(\/|$)/, INGEST],
  [/^\/api\/analytics\/flags\/evaluate$/, INGEST],
  [/^\/api\/(books|shop)\/webhooks(\/|$)/, INBOUND],
  [/^\/api\/calendar\/payments\/webhook(\/|$)/, INBOUND],
  [/^\/api\/crm\/stripe-webhook(\/|$)/, INBOUND],
  [/^\/api\/crm\/voice\/(consent|events|inbound|twiml)$/, INBOUND],
  [/^\/api\/links\/shopify-webhook$/, INBOUND],
  [/^\/api\/social\/webhooks(\/|$)/, INBOUND],
  [/^\/api\/track\/slack\/(commands|events|interactions)$/, INBOUND],
  [/^\/api\/track\/sentry\/webhook(\/|$)/, INBOUND],
  [/^\/api\/track\/github\/(webhook|app\/webhook)/, INBOUND],
  [/^\/api\/groups\/webhook(\/|$)/, INBOUND],
  [/^\/api\/talk\/(hooks\/\[token\]|commands\/respond)/, INBOUND],
  [/^\/api\/flow\/(hooks|resume|approvals)\/\[token\]$/, INBOUND],
  [/^\/api\/agents\/\[id\]\/(meta|slack)$/, INBOUND],
  [/^\/api\/agents\/voice$/, INBOUND],
  [/^\/api\/robots\/recordings\/\[id\]\/steps$/, 'recorder extension endpoint, authenticated by a recording token'],

  [/^\/api\/v1\/track\/agent-sessions(\/|$)/, 'authenticated by the token of a Track agent app (zsa_), not by a person'],

  // Público
  [/\/public(\/|$)/, PUBLIC],
  [/^\/api\/boards\/guest(\/|$)/, PUBLIC],
  [/^\/api\/board\/(unsubscribe|changelog)$/, PUBLIC],
  [/^\/api\/calendar\/poll-votes\/\[token\]$/, PUBLIC],
  [/^\/api\/calendar\/bookings\/manage\/\[token\]$/, PUBLIC],
  [/^\/api\/calendar\/routing\/\[id\]\/route$/, PUBLIC],
  [/^\/api\/chat\/(csat|help|history|identify|messages|outbound|read|typing|unsubscribe|visitor)$/, PUBLIC],
  [/^\/api\/chat\/messages\/upload$/, PUBLIC],
  [/^\/api\/crm\/(d|v)\/\[token\]\//, PUBLIC],
  [/^\/api\/crm\/t(\/|$)/, PUBLIC],
  [/^\/api\/crm\/forms\/submit\//, PUBLIC],
  [/^\/api\/docs\/help\//, PUBLIC],
  [/^\/api\/docs\/site\/host$/, PUBLIC],
  [/^\/api\/rec\/v\//, PUBLIC],
  [/^\/api\/rec\/oembed$/, PUBLIC],
  [/^\/api\/tools(\/|$)/, 'public marketing tools with no account behind them'],
  [/^\/api\/v1\/links\/track\/open$/, PUBLIC],

  // Estáticos
  [/^\/api\/og(\/|$)/, STATIC],
  [/^\/api\/pwa-icon(\/|$)/, STATIC],
  [/^\/api\/uploads(\/|$)/, STATIC],
  [/^\/api\/desktop\/update(\/|$)/, STATIC],
  [/\/(embed|widget)\.js$/, STATIC],
  [/^\/api\/desktop\/badge$/, STATIC],
  [/^\/api\/blog-cover(\/|$)/, STATIC],

  // Conectar terceros: redirect en el navegador
  [/^\/api\/integrations\/[a-z-]+\/(start|callback)$/, BROWSER],
  [/^\/api\/calendar\/outlook\/(start|callback)$/, BROWSER],
  [/^\/api\/social\/oauth\//, BROWSER],
  [/^\/api\/track\/slack\/(install|callback)$/, BROWSER],
  [/^\/api\/track\/github\/app\/(install|callback)$/, BROWSER],

  // Tiempo real
  [/^\/api\/(chat|talk)\/stream$/, REALTIME],
  [/^\/api\/docs\/collab$/, REALTIME],
  [/^\/api\/boards\/live$/, REALTIME],
  [/^\/api\/voice\/events$/, REALTIME],

  // Subidas directas a Blob
  [/^\/api\/crm\/media\/upload$/, UPLOAD],
  [/^\/api\/voice\/upload$/, UPLOAD],
  [/^\/api\/import\/upload$/, UPLOAD],
  [/^\/api\/import\/jobs\/\[id\]\/chunk$/, UPLOAD],
  [/^\/api\/(docs\/pages|notes)\/\[id\]\/files\/blob$/, UPLOAD],

  // Cuenta y propiedad
  [/^\/api\/rec\/settings\/transfer$/, ACCOUNT],
  [/^\/api\/teams\/switch$/, 'changes the browser workspace of the person: use the switch_workspace tool, which only moves this connection'],
  [/^\/api\/teams\/(accept|join)$/, 'joining a workspace is the decision of the person, in the browser, with the invitation link'],
  [/^\/api\/teams$/, ACCOUNT, ['POST']],
  [/^\/api\/onboarding$/, 'first-run wizard of the browser session'],

  // Personal de zerosoft
  [/^\/api\/roadmap\/(ingest|merge)$/, STAFF],
  [/^\/api\/changelog-entries(\/|$)/, STAFF],
  [/^\/api\/feedback\/\[id\](\/promote)?$/, STAFF],

  // Colas del navegador
  [/^\/api\/groups\/push\/pending$/, 'browser push queue: reading it consumes the notifications'],
  [/^\/api\/talk\/guests\/accept$/, 'accepting a guest invitation is a browser step of the invited person'],

  // Asistente
  [/^\/api\/assistant\/chat$/, ASSISTANT],
  [/^\/api\/assistant\/actions\/\[id\]$/, ASSISTANT],
];

export function excludeReason(url, method) {
  for (const [re, reason, methods] of EXCLUDE_RULES) {
    if (re.test(url) && (!methods || methods.includes(method))) return reason;
  }
  return null;
}

/** Correcciones de clase: lo sensible se marca destructivo aunque sea PATCH o POST. */
export const ACCESS_OVERRIDES = {
  'POST /api/teams/invites': 'destructive',
  'POST /api/teams/invites/[id]': 'destructive',
  'PATCH /api/teams/members/[userId]': 'destructive',
  'PATCH /api/teams/workspace': 'destructive',
  'POST /api/webhooks': 'destructive',
  'PATCH /api/webhooks/[id]': 'destructive',
  'POST /api/webhooks/deliveries/[id]/resend': 'destructive',
  'POST /api/webhooks/[id]/test': 'write',
  'POST /api/flow/credentials': 'destructive',
  'PATCH /api/flow/credentials/[id]': 'destructive',
  'POST /api/agents/[id]/secrets': 'destructive',
};

/** POST que solo leen (búsquedas y vistas previas sin efectos). Agregar acá solo después de leer el handler. */
export const READ_POST = new Set([
  'POST /api/analytics/query', // consulta con su propio tope por workspace
  'POST /api/crm/email-templates/preview', // arma la vista previa, no envía ni guarda
]);

/**
 * GET en los que el generador ve SQL de escritura alcanzable pero que siguen
 * siendo lectura: solo escriben auditoría, siembran valores por defecto o
 * refrescan un token o un cache. Revisados con TODO el SQL que alcanzan
 * (node scripts/mcp-catalog.mjs --report). Lo que no está acá queda como
 * escritura: un GET que despierta conversaciones pospuestas, vence cotizaciones,
 * sincroniza entrevistas o marca presencia cambia datos, aunque sea un GET.
 */
export const MUTATING_GET_OK = new Set([
  // Siembran la fila de ajustes por defecto de la app.
  'GET /api/books/accounts', 'GET /api/books/bank-accounts', 'GET /api/books/bank-accounts/[id]', 'GET /api/books/contacts',
  'GET /api/books/contacts/[id]', 'GET /api/books/documents', 'GET /api/books/documents/[id]/pdf', 'GET /api/books/expenses',
  'GET /api/books/items', 'GET /api/books/journals', 'GET /api/books/purchase-orders', 'GET /api/books/recurring',
  'GET /api/books/recurring/[id]', 'GET /api/books/reports', 'GET /api/books/series', 'GET /api/books/settings', 'GET /api/books/taxes',
  'GET /api/v1/books/invoices', 'GET /api/calendar/config', 'GET /api/calendar/payments', 'GET /api/crm/lead-stages',
  'GET /api/crm/scoring/rules', 'GET /api/crm/scoring/scores', 'GET /api/hiring/settings', 'GET /api/notes/email-address',
  'GET /api/shop/analytics',
  'GET /api/shop/inventory', 'GET /api/shop/locations', 'GET /api/shop/payments', 'GET /api/shop/store', 
  'GET /api/links/domains', 'GET /api/links/publishable-key', 'GET /api/agents/[id]/analytics',
  // Registran que la persona leyó o exportó (auditoría y "abierto hace poco").
  'GET /api/chat/export', 'GET /api/docs/export', 'GET /api/docs/pages/[id]/export', 'GET /api/groups/export',
  'GET /api/people/documents', 'GET /api/people/documents/[id]', 'GET /api/people/export', 'GET /api/people/me',
  'GET /api/people/reviews', 'GET /api/people/cycles/[id]', 'GET /api/people/employees/[id]',
  'GET /api/people/employees/[id]/compensation', 'GET /api/people/employees/[id]/goals', 'GET /api/design/designs/[id]',
  'GET /api/track/integrations/slack/channels', 'GET /api/voice/send-targets',
  // No son datos de la persona: refrescan el token de una integración o un cache de logos.
  'GET /api/calendar/calendars', 
  'GET /api/crm/logo/[domain]',
  
]);

/**
 * Operaciones del catálogo en las que el generador no ve la sesión porque el
 * handler sale de una fábrica o son lectura pública. Revisadas a mano; una
 * nueva sin sesión hace fallar el test de cobertura hasta decidir qué es.
 */
export const NO_SESSION_OK = new Set([
  'GET /api/board/items/[id]/comments', // lectura del board público
  'GET /api/calendar/event-types/[id]/slots', // horarios públicos de un tipo de evento
  'POST /api/crm/companies/[id]/files', 'DELETE /api/crm/companies/[id]/files', 'GET /api/crm/companies/[id]/files', // fábrica de crm-files-http
  'POST /api/crm/contacts/[id]/files', 'DELETE /api/crm/contacts/[id]/files', 'GET /api/crm/contacts/[id]/files',
  'POST /api/crm/deals/[id]/files', 'DELETE /api/crm/deals/[id]/files', 'GET /api/crm/deals/[id]/files',
  'GET /api/notes/[id]/transcribe', // solo dice si hay proveedor de transcripción, sin datos
]);
