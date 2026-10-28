/**
 * Probar un token real sin importar nada (desarrollo): valida el token contra
 * la API y muestra lo que el import vería (cuenta, cantidades, permisos que
 * faltan). No escribe en la base ni guarda el token.
 *
 *   IMPORT_PROBE_TOKEN=ntn_... npx tsx scripts/import-probe.ts notion
 *   IMPORT_PROBE_TOKEN=pat-... npx tsx scripts/import-probe.ts hubspot
 *
 * El token va por variable de entorno (no como argumento, para que no quede
 * en el historial del shell ni en la lista de procesos).
 */
import { createNotionClient, pageTitle, type NDatabase, type NList, type NPage } from '../lib/notion-api';
import { createHubspotSource } from '../lib/crm-import-hubspot';
import { SourceError } from '../lib/crm-import-source';
import { ImportError } from '../lib/import-jobs';

async function probeNotion(token: string) {
  const client = createNotionClient(token);
  const me: { name?: string; bot?: { workspace_name?: string | null } } = await client.get('/users/me');
  console.log(`Token OK. Workspace: ${me.bot?.workspace_name ?? me.name ?? '(sin nombre)'}`);
  try {
    const users: NList<{ type?: string; person?: { email?: string } }> = await client.get('/users?page_size=100');
    const people = users.results.filter((u) => u.type !== 'bot');
    console.log(`Personas: ${people.length}${users.has_more ? '+' : ''} (${people.filter((p) => p.person?.email).length} con email)`);
  } catch (e) {
    console.log(`Personas: sin acceso (${e instanceof ImportError ? e.code : 'error'}). Activá "Read user information including email addresses".`);
  }
  let pages = 0;
  let rows = 0;
  let databases = 0;
  const roots: string[] = [];
  let next: string | null = null;
  for (let i = 0; i < 200; i++) {
    const res: NList<NPage | NDatabase> = await client.post('/search', { page_size: 100, ...(next ? { start_cursor: next } : {}) });
    for (const o of res.results) {
      if (o.archived || o.in_trash) continue;
      if (o.object === 'database') databases++;
      else if (o.parent.type === 'database_id') rows++;
      else pages++;
      if (o.parent.type === 'workspace' && roots.length < 15) roots.push(`${o.object === 'database' ? '[base] ' : ''}${pageTitle(o) || 'Untitled'}`);
    }
    next = res.has_more ? res.next_cursor : null;
    if (!next) break;
  }
  console.log(`Compartido con la integración: ${pages} páginas, ${databases} bases, ${rows} filas.`);
  if (!pages && !databases) console.log('No ve nada: en Notion, en cada página de primer nivel: ••• › Connections › agregá la integración.');
  if (roots.length) console.log(`Primer nivel:\n  ${roots.join('\n  ')}`);
}

async function probeHubspot(token: string) {
  const source = createHubspotSource(token);
  const owners = await source.owners();
  console.log(`Token OK. Owners: ${owners.length}`);
  const fields = await source.fields();
  console.log(`Propiedades propias: ${fields.length}`);
  const pipelines = await source.pipelines();
  console.log(`Pipelines de deals: ${pipelines.map((p) => `${p.name} (${p.stages.length} etapas)`).join(', ') || 'ninguno'}`);
  for (const phase of source.phases()) {
    try {
      console.log(`  ${phase}: ${(await source.count(phase)) ?? '?'}`);
    } catch (e) {
      console.log(`  ${phase}: ${e instanceof SourceError && e.code === 'scope' ? 'falta el permiso (se saltea)' : 'error'}`);
    }
  }
}

async function main() {
  const kind = process.argv[2];
  const token = (process.env.IMPORT_PROBE_TOKEN ?? '').trim();
  if (!token || (kind !== 'notion' && kind !== 'hubspot')) {
    console.error('Uso: IMPORT_PROBE_TOKEN=<token> npx tsx scripts/import-probe.ts notion|hubspot');
    process.exit(2);
  }
  try {
    if (kind === 'notion') await probeNotion(token);
    else await probeHubspot(token);
  } catch (e) {
    const code = e instanceof ImportError ? e.code : e instanceof SourceError ? e.code : 'error';
    console.error(`No se pudo: ${code}${code === 'unauthorized' || code === 'auth' ? ' (token rechazado)' : ''}`);
    process.exit(1);
  }
}

void main();
