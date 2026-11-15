#!/usr/bin/env node
/**
 * Revisa que cada route handler de la API pase por un chequeo de sesión o de
 * API key, o que esté en la lista explícita de rutas públicas por diseño
 * (scripts/api-public-routes.json: webhooks firmados, crons con secreto,
 * páginas públicas, callbacks de OAuth, widgets embebibles...).
 *
 * Cómo decide: lee cada `route.ts` de `app/api/**` y `lib/routes/**` con el
 * parser de TypeScript y mira si llama a alguna de las funciones de GUARDS,
 * importada del módulo indicado. Una ruta nueva sin guard y fuera de la lista
 * hace fallar tests/unit/api-route-guards.test.ts.
 *
 * Uso: node scripts/api-route-guards.mjs        # lista las rutas sin guard
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ts = createRequire(join(ROOT, 'package.json'))('typescript');

/**
 * Funciones que resuelven la sesión (o la API key) y responden 401/403 sin
 * ella. `módulo#nombre`. Sumar acá un wrapper nuevo solo si de verdad corta
 * el pedido anónimo.
 */
export const GUARDS = [
  '@/lib/session#getCurrentUser',
  '@/lib/session#requireUser',
  '@/lib/session#sessionGate',
  '@/lib/api-auth#requireApiUser',
  '@/lib/api-auth#validateApiKey',
  '@/lib/api-auth#validateApiKeyAuth',
  '@/lib/agents-http#agentRouteContext',
  '@/lib/analytics/http#analyticsActor',
  '@/lib/assistant/http#assistantUser',
  '@/lib/bi/http#withViewer',
  '@/lib/board-session#getBoardPerson',
  '@/lib/board-v1#boardsApi',
  '@/lib/books-http#booksSession',
  '@/lib/books-http#handle',
  '@/lib/calls/http#callsActor',
  '@/lib/chat-http#chatSession',
  '@/lib/crm-files-http#recordFilesHandlers',
  '@/lib/crm-media-http#mediaUser',
  '@/lib/crm-voice-http#callForSession',
  '@/lib/design-http#designActor',
  '@/lib/docs-meetings-http#meetingFor',
  '@/lib/docs-v1#docsApi',
  '@/lib/forms/http#formsActor',
  '@/lib/groups-http#groupsSession',
  '@/lib/hiring/http#hiringActor',
  '@/lib/import-http#importJobFor',
  '@/lib/import-http#importUser',
  '@/lib/inbox/http#inboxOwner',
  '@/lib/inbox/http#withOwner',
  '@/lib/mcp/server#handleMcpPost',
  '@/lib/notes-v1#notesApi',
  '@/lib/people-http#withPeople',
  '@/lib/rec-http#recActor',
  '@/lib/roadmap-admin#currentUserIsAdmin',
  '@/lib/send/http#sendActor',
  '@/lib/shop-http#shopActor',
  '@/lib/sign/http#signActor',
  '@/lib/social-http#withSocial',
  '@/lib/talk-http#withTalk',
  '@/lib/teams-http#teamsCtx',
  '@/lib/track-api-http#trackApiRoute',
  '@/lib/track-mcp#mcpHttpPost',
  '@/lib/track-planning-http#planningContext',
  '@/lib/track-triage-http#issueAccess',
  '@/lib/track-triage-http#projectAccess',
  '@/lib/voice-route#voiceAuth',
  '@/lib/voice-v1#voiceApiAuth',
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/^route\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/** Rutas relativas (con /) de todos los route handlers de la API. */
export function listRouteFiles() {
  return [...walk(join(ROOT, 'app/api')), ...walk(join(ROOT, 'lib/routes'))]
    .map((f) => relative(ROOT, f).split('\\').join('/'))
    .filter((f) => !readFileSync(join(ROOT, f), 'utf8').includes('createDispatcher('))
    .sort();
}

/** Nombres locales de los guards que importa el archivo y que efectivamente llama. */
export function guardsUsed(file) {
  const src = readFileSync(join(ROOT, file), 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const wanted = new Set(GUARDS);
  const local = new Map();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st)) continue;
    const bindings = st.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    const mod = st.moduleSpecifier.text;
    for (const el of bindings.elements) {
      const key = `${mod}#${(el.propertyName ?? el.name).text}`;
      if (wanted.has(key)) local.set(el.name.text, key);
    }
  }
  const used = new Set();
  const visit = (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && local.has(n.expression.text)) used.add(local.get(n.expression.text));
    ts.forEachChild(n, visit);
  };
  visit(sf);
  // `export { GET } from '<otra ruta>'`: vale lo que valga esa ruta.
  for (const st of sf.statements) {
    if (!ts.isExportDeclaration(st) || !st.moduleSpecifier) continue;
    const target = resolveModule(file, st.moduleSpecifier.text);
    if (target && target !== file) for (const g of guardsUsed(target)) used.add(g);
  }
  return [...used];
}

function resolveModule(from, spec) {
  const base = spec.startsWith('@/') ? join(ROOT, spec.slice(2)) : spec.startsWith('.') ? resolve(dirname(join(ROOT, from)), spec) : null;
  if (!base) return null;
  for (const ext of ['.ts', '.tsx', '/route.ts']) {
    try {
      if (statSync(base + ext).isFile()) return relative(ROOT, base + ext).split('\\').join('/');
    } catch {
      /* siguiente */
    }
  }
  return null;
}

export function publicRoutes() {
  return JSON.parse(readFileSync(join(ROOT, 'scripts/api-public-routes.json'), 'utf8'));
}

/** Rutas sin guard que no están en la lista pública, y entradas de la lista que ya no existen o ya tienen guard. */
export function checkRouteGuards() {
  const allow = publicRoutes();
  const files = listRouteFiles();
  const unguarded = files.filter((f) => guardsUsed(f).length === 0);
  const missing = unguarded.filter((f) => !(f in allow));
  const stale = Object.keys(allow).filter((f) => !unguarded.includes(f));
  return { files, unguarded, missing, stale };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { files, unguarded, missing, stale } = checkRouteGuards();
  console.log(`${files.length} rutas, ${unguarded.length} sin guard (públicas por diseño), ${missing.length} fuera de la lista`);
  for (const f of missing) console.log(`  sin guard: ${f}`);
  for (const f of stale) console.log(`  sobra en la lista: ${f}`);
  if (missing.length || stale.length) process.exitCode = 1;
}
