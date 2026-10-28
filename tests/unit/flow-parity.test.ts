import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb, type FlowRunRow } from '@/lib/db';
import { addMember, createTeam } from '@/lib/teams';
import {
  createFlow,
  enqueueEventRuns,
  enqueueRun,
  enqueueWebhookRun,
  getFlow,
  getFlowRow,
  listFlowVersions,
  listFlowWebhooks,
  publicForm,
  publishFlowDraft,
  resolveHeldRuns,
  sanitizeImportedGraph,
  saveFlowDraft,
  updateFlow,
  validateFormSubmission,
  formStamp,
  checkFormStamp,
} from '@/lib/flow';
import { runFlowNow } from '@/lib/flow-http';
import { createFolder, deleteFolder, listFolders } from '@/lib/flow-folders';
import { createVariable, deleteVariable, listVariables, updateVariable } from '@/lib/flow-variables';
import { exportRuns, flowStats, searchRuns } from '@/lib/flow-monitor';
import { enqueueDuePolls, parseFeed } from '@/lib/flow-poll';
import { claimQueuedRun, processFlowQueue } from '@/lib/flow-worker';
import { builtToGraph, fakeBuild, aiExtractNode, redactConfig, redactSecretsInText, extractFields } from '@/lib/flow-ai';
import { copyNodes, parseClipboard, parseCurl, parseFlowImport, pasteNodes, shellWords } from '@/lib/flow-transfer';
import { formFields, validateGraph, type FlowGraph } from '@/lib/flow-schema';
import { columnLetter, lookupSheetRows, sheetName } from '@/lib/flow-integrations';
import { nextFromLinkHeader } from '@/lib/flow-engine';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const T = { id: 't', type: 'trigger.manual' as const, position: { x: 0, y: 0 }, config: { sample: '{}' } };
const node = (id: string, type: string, config: Record<string, unknown> = {}) => ({ id, type, position: { x: 0, y: 100 }, config });
const edge = (source: string, target: string, sourceHandle = 'out') => ({ id: `e_${source}_${target}`, source, target, sourceHandle });

async function team() {
  const owner = await makeUser('fp-o');
  const ana = await makeUser('fp-ana');
  const bob = await makeUser('fp-bob');
  const t = await createTeam(owner.id, 'T');
  await addMember(t.id, ana.id, 'admin');
  await addMember(t.id, bob.id, 'admin');
  return { ws: owner.id, ana: ana.id, bob: bob.id };
}

async function newFlow(ws: string, actor: string, graph: unknown) {
  const res = await createFlow(ws, actor, { name: 'F', graph });
  if (!res.ok) throw new Error(res.error);
  return res.flow;
}

describe('Flow: borrador por persona', () => {
  it('cada persona edita su borrador; no cambia lo que corre; publicar el propio pasa el flow a quien publica', async () => {
    const { ws, ana, bob } = await team();
    const g1: FlowGraph = { nodes: [T, node('a', 'data.set', { fields: [{ key: 'v', value: '1' }] })] as FlowGraph['nodes'], edges: [edge('t', 'a')] };
    const flow = await newFlow(ws, ana, g1);
    const g2 = { ...g1, nodes: [T, node('a', 'data.set', { fields: [{ key: 'v', value: '2' }] })] };
    const saved = await saveFlowDraft(ws, flow.id, g2, 0, bob);
    expect(saved.ok && saved.flow.draftRev).toBe(1);
    // Ana no ve el borrador de Bob y lo publicado no cambió.
    expect((await getFlow(ws, flow.id, ana))?.draft).toBeNull();
    let row = await getFlowRow(ws, flow.id);
    expect(row?.created_by).toBe(ana);
    expect(JSON.parse(row!.graph).nodes[1].config.fields[0].value).toBe('1');
    // Revisión vieja: conflicto (dos pestañas de Bob).
    expect(await saveFlowDraft(ws, flow.id, g2, 0, bob)).toMatchObject({ ok: false, error: 'conflict' });
    // Igual a lo publicado: se descarta.
    const back = await saveFlowDraft(ws, flow.id, g1, 1, bob);
    expect(back.ok && back.flow.draft).toBeNull();
    await saveFlowDraft(ws, flow.id, g2, 0, bob);
    // Publicar sin la revisión que se ve, o con otra: 409.
    expect(await publishFlowDraft(ws, flow.id, bob)).toMatchObject({ ok: false, error: 'conflict' });
    expect(await publishFlowDraft(ws, flow.id, bob, { rev: 7 })).toMatchObject({ ok: false, error: 'conflict' });
    // Ana no tiene borrador: no puede publicar el de Bob.
    expect(await publishFlowDraft(ws, flow.id, ana, { rev: 1 })).toMatchObject({ ok: false, error: 'no_draft' });
    const pub = await publishFlowDraft(ws, flow.id, bob, { rev: 1 });
    expect(pub.ok).toBe(true);
    row = await getFlowRow(ws, flow.id);
    expect(row?.created_by).toBe(bob);
    expect(JSON.parse(row!.graph).nodes[1].config.fields[0].value).toBe('2');
    expect(await getFlow(ws, flow.id, bob).then((f) => f?.draft)).toBeNull();
    const versions = await listFlowVersions(ws, flow.id);
    expect(versions[0].authorName).toBe('fp-bob');
  });

  it('escenario t1: el nodo que Bob mete en su borrador nunca corre ni se publica con el acceso de Ana', async () => {
    const { ws, ana, bob } = await team();
    await createVariable(ws, ana, 'secret', 'A-SECRET-123');
    await createVariable(ws, bob, 'secret', 'B-value');
    const g: FlowGraph = { nodes: [T, node('set', 'data.set', { fields: [{ key: 'hello', value: 'world' }] })] as FlowGraph['nodes'], edges: [edge('t', 'set')] };
    const flow = await newFlow(ws, ana, g);
    // Ana edita su borrador.
    const aDraft = { ...g, nodes: [T, node('set', 'data.set', { fields: [{ key: 'hello', value: 'world2' }] })] };
    const a1 = await saveFlowDraft(ws, flow.id, aDraft, 0, ana);
    const aRev = a1.ok ? a1.flow.draftRev : -1;
    // Bob arma un borrador con un paso que leería la variable secreta.
    const evil = {
      nodes: [...aDraft.nodes, node('leak', 'data.set', { fields: [{ key: 'v', value: '{{vars.secret}}' }] })],
      edges: [...aDraft.edges, edge('set', 'leak')],
    };
    expect((await saveFlowDraft(ws, flow.id, evil, 0, bob)).ok).toBe(true);
    // "Probar" de Ana corre SU borrador, con su acceso: el paso de Bob no está.
    const test = await runFlowNow(ws, flow.id, {}, { personId: ana, admin: true }, { draft: true, draftRev: aRev });
    expect(test.ok && test.run?.steps.map((s) => s.nodeId)).toEqual(['t', 'set']);
    // Probar con una revisión que no es la que se ve: 409.
    expect(await runFlowNow(ws, flow.id, {}, { personId: ana, admin: true }, { draft: true, draftRev: aRev + 5 })).toMatchObject({ ok: false, error: 'conflict' });
    // Publicar de Ana publica lo suyo.
    expect((await publishFlowDraft(ws, flow.id, ana, { rev: aRev })).ok).toBe(true);
    const graph = JSON.parse((await getFlowRow(ws, flow.id))!.graph) as FlowGraph;
    expect(graph.nodes.map((n) => n.id)).toEqual(['t', 'set']);
    // El borrador de Bob corre como Bob (sus variables), nunca como Ana.
    const bRun = await runFlowNow(ws, flow.id, {}, { personId: bob, admin: true }, { draft: true });
    expect(bRun.ok && bRun.run?.steps.find((s) => s.nodeId === 'leak')?.output).toEqual({ v: 'B-value' });
    const leaked = (await getDb().prepare("SELECT COUNT(*) AS n FROM flow_steps WHERE output LIKE '%A-SECRET-123%'").get()) as { n: number };
    expect(Number(leaked.n)).toBe(0);
  });

  it('guardar borrador y ajustes no sube la versión; dos editores no se trancan; publicar sobre una base vieja pide confirmación', async () => {
    const { ws, ana, bob } = await team();
    const g1: FlowGraph = { nodes: [T, node('a', 'data.set', { fields: [] })] as FlowGraph['nodes'], edges: [edge('t', 'a')] };
    const flow = await newFlow(ws, ana, g1);
    const gA = { ...g1, nodes: [T, node('a', 'data.set', { fields: [{ key: 'by', value: 'ana' }] })] };
    const gB = { ...g1, nodes: [T, node('a', 'data.set', { fields: [{ key: 'by', value: 'bob' }] })] };
    // Autoguardados alternados de los dos (borrador + ajustes, como el editor).
    let ra = 0;
    let rb = 0;
    for (let i = 0; i < 3; i++) {
      const a = await saveFlowDraft(ws, flow.id, gA, ra, ana);
      expect(a.ok).toBe(true);
      if (a.ok) ra = a.flow.draftRev;
      expect((await updateFlow(ws, flow.id, { name: `F ana ${i}`, description: 'x' }, ana)).ok).toBe(true);
      const b = await saveFlowDraft(ws, flow.id, gB, rb, bob);
      expect(b.ok).toBe(true);
      if (b.ok) rb = b.flow.draftRev;
      expect((await updateFlow(ws, flow.id, { failureAlerts: false }, bob)).ok).toBe(true);
    }
    let row = await getFlowRow(ws, flow.id);
    expect(row?.version).toBe(1);
    // Cada uno escribió su campo: no se pisaron.
    expect(row?.name).toBe('F ana 2');
    expect(row?.failure_alerts).toBe(0);
    // Ana publica; el borrador de Bob queda sobre una base vieja.
    expect((await publishFlowDraft(ws, flow.id, ana, { rev: ra })).ok).toBe(true);
    const stale = await publishFlowDraft(ws, flow.id, bob, { rev: rb });
    expect(stale).toMatchObject({ ok: false, error: 'stale_draft', stale: { baseVersion: 1, publishedVersion: 2 } });
    if (!stale.ok) expect(stale.stale?.diff.changed).toEqual(['a']);
    expect((await publishFlowDraft(ws, flow.id, bob, { rev: rb, force: true })).ok).toBe(true);
    row = await getFlowRow(ws, flow.id);
    expect(row?.version).toBe(3);
    expect(row?.created_by).toBe(bob);
  });

  it('probar el borrador propio corre con el acceso de quien prueba, no del dueño', async () => {
    const { ws, ana, bob } = await team();
    await createVariable(ws, ana, 'who', 'ana');
    await createVariable(ws, bob, 'who', 'bob');
    const g: FlowGraph = { nodes: [T, node('a', 'data.set', { fields: [{ key: 'who', value: '{{vars.who}}' }] })] as FlowGraph['nodes'], edges: [edge('t', 'a')] };
    const flow = await newFlow(ws, ana, g);
    const pubRun = await runFlowNow(ws, flow.id, {}, { personId: ana, admin: true });
    expect(pubRun.ok && pubRun.run?.steps.find((s) => s.nodeId === 'a')?.output).toEqual({ who: 'ana' });
    const g2 = { ...g, nodes: [T, node('a', 'data.set', { fields: [{ key: 'who', value: 'draft {{vars.who}}' }] })] };
    await saveFlowDraft(ws, flow.id, g2, 0, bob);
    const res = await runFlowNow(ws, flow.id, {}, { personId: bob, admin: true }, { draft: true, draftRev: 1 });
    const run = res.ok ? res.run : null;
    expect(run?.steps.find((s) => s.nodeId === 'a')?.output).toEqual({ who: 'draft bob' });
    const row = (await getDb().prepare('SELECT captured_by FROM flow_runs WHERE id = ?').get(run!.id)) as Pick<FlowRunRow, 'captured_by'>;
    expect(row.captured_by).toBe(bob);
    expect((await getFlowRow(ws, flow.id))?.created_by).toBe(ana);
  });
});

describe('Flow: páginas de Docs creadas por un flow', () => {
  it('quedan a nombre de la persona con cuyo acceso corrió (page_owner_id y content_by)', async () => {
    const { ws, ana, bob } = await team();
    const flow = await newFlow(ws, ana, {
      nodes: [T, node('d', 'app.docs_page', { operation: 'page_create', title: 'Desde Flow {{trigger.n}}', content: 'Hola' })],
      edges: [edge('t', 'd')],
    });
    const byAna = await runFlowNow(ws, flow.id, { n: 'ana' }, { personId: ana, admin: true });
    const byBob = await runFlowNow(ws, flow.id, { n: 'bob' }, { personId: bob, admin: true });
    expect(byAna.ok && byAna.run?.status).toBe('success');
    expect(byBob.ok && byBob.run?.status).toBe('success');
    const rows = (await getDb()
      .prepare("SELECT title, page_owner_id, content_by FROM docs_pages WHERE user_id = ? AND title LIKE 'Desde Flow %' ORDER BY title")
      .all(ws)) as Array<{ title: string; page_owner_id: string; content_by: string }>;
    expect(rows).toEqual([
      { title: 'Desde Flow ana', page_owner_id: ana, content_by: ana },
      { title: 'Desde Flow bob', page_owner_id: bob, content_by: bob },
    ]);
  });
});

describe('Flow: variables por persona', () => {
  it('cada persona ve y cambia solo las suyas', async () => {
    const { ws, ana, bob } = await team();
    const v = await createVariable(ws, ana, 'api_base', 'https://a.test');
    expect(v.ok).toBe(true);
    expect(await createVariable(ws, ana, 'api_base', 'x')).toMatchObject({ ok: false, error: 'duplicate_key' });
    expect(await createVariable(ws, ana, '1bad', 'x')).toMatchObject({ ok: false, error: 'invalid_key' });
    expect(await listVariables(ws, bob)).toEqual([]);
    if (!v.ok) return;
    expect(await updateVariable(ws, bob, v.variable.id, { value: 'https://evil.test' })).toMatchObject({ ok: false, error: 'not_found' });
    expect(await deleteVariable(ws, bob, v.variable.id)).toBe(false);
    expect((await updateVariable(ws, ana, v.variable.id, { value: 'https://b.test' })).ok).toBe(true);
    expect((await listVariables(ws, ana))[0].value).toBe('https://b.test');
  });
});

describe('Flow: carpetas', () => {
  it('crear, mover un flow, borrar la carpeta deja el flow sin carpeta', async () => {
    const { ws, ana } = await team();
    const d = await createFolder(ws, ana, '  Ventas ');
    expect(d.ok && d.folder.name).toBe('Ventas');
    if (!d.ok) return;
    const flow = await newFlow(ws, ana, { nodes: [T], edges: [] });
    expect((await updateFlow(ws, flow.id, { folderId: d.folder.id }, ana)).ok).toBe(true);
    expect((await listFolders(ws))[0].flowCount).toBe(1);
    expect(await updateFlow(ws, flow.id, { folderId: 'nope' }, ana)).toMatchObject({ ok: false, error: 'invalid_folder' });
    // Mover no es cambiar el grafo: no cambia de dueño.
    expect((await getFlowRow(ws, flow.id))?.created_by).toBe(ana);
    const other = await makeUser('fp-other');
    expect(await deleteFolder(other.id, d.folder.id)).toBe(false);
    expect(await deleteFolder(ws, d.folder.id)).toBe(true);
    expect((await getFlowRow(ws, flow.id))?.folder_id).toBeNull();
  });
});

describe('Flow: avalanchas y concurrencia', () => {
  it('pasado el límite, las corridas automáticas quedan retenidas y no corren hasta liberarlas', async () => {
    const ws = (await makeUser('fp-flood')).id;
    const g = {
      nodes: [{ id: 't', type: 'trigger.event', position: { x: 0, y: 0 }, config: { event: 'contact.created' } }, node('a', 'data.set', { fields: [] })],
      edges: [edge('t', 'a')],
    };
    const flow = await newFlow(ws, ws, g);
    await updateFlow(ws, flow.id, { enabled: true, floodLimit: 2 }, ws);
    for (let i = 0; i < 4; i++) await enqueueEventRuns(ws, 'contact.created', { id: `c${i}` });
    const held = (await getDb().prepare('SELECT COUNT(*) AS n FROM flow_runs WHERE flow_id = ? AND held = 1').get(flow.id)) as { n: number };
    expect(Number(held.n)).toBe(2);
    await processFlowQueue({ limit: 50 });
    const statuses = (await getDb().prepare('SELECT status, held FROM flow_runs WHERE flow_id = ? ORDER BY created_at').all(flow.id)) as Array<{ status: string; held: number }>;
    expect(statuses.filter((s) => s.status === 'success')).toHaveLength(2);
    expect(statuses.filter((s) => s.held === 1 && s.status === 'queued')).toHaveLength(2);
    const stats = await flowStats(ws, 7);
    expect(stats.queue.held).toBe(2);
    expect(await resolveHeldRuns(ws, flow.id, 'discard', [])).toBe(2);
    const after = (await getDb().prepare("SELECT COUNT(*) AS n FROM flow_runs WHERE flow_id = ? AND error = 'discarded'").get(flow.id)) as { n: number };
    expect(Number(after.n)).toBe(2);
  });

  it('un flow con cientos en cola y concurrencia 1 no frena a los demás', async () => {
    const ws = (await makeUser('fp-fair')).id;
    const busy = await newFlow(ws, ws, { nodes: [T], edges: [] });
    await updateFlow(ws, busy.id, { maxConcurrency: 1 }, ws);
    await enqueueRun({ id: busy.id, user_id: ws }, 'manual', {}, { status: 'running', lockMs: 60_000 });
    for (let i = 0; i < 250; i++) await enqueueRun({ id: busy.id, user_id: ws }, 'manual', {});
    const other = await newFlow(ws, ws, { nodes: [T], edges: [] });
    const otherRun = await enqueueRun({ id: other.id, user_id: ws }, 'manual', {});
    await processFlowQueue({ limit: 200 });
    const row = (await getDb().prepare('SELECT status FROM flow_runs WHERE id = ?').get(otherRun)) as { status: string };
    expect(row.status).toBe('success');
    const stillQueued = (await getDb().prepare("SELECT COUNT(*) AS n FROM flow_runs WHERE flow_id = ? AND status = 'queued'").get(busy.id)) as { n: number };
    expect(Number(stillQueued.n)).toBe(250);
  });

  it('con concurrencia 1 no toma una corrida mientras otra del flow corre', async () => {
    const ws = (await makeUser('fp-conc')).id;
    const flow = await newFlow(ws, ws, { nodes: [T], edges: [] });
    await updateFlow(ws, flow.id, { maxConcurrency: 1 }, ws);
    const running = await enqueueRun({ id: flow.id, user_id: ws }, 'manual', {}, { status: 'running', lockMs: 60_000 });
    const queued = await enqueueRun({ id: flow.id, user_id: ws }, 'manual', {});
    expect(await claimQueuedRun(queued!)).toBe(false);
    await getDb().prepare("UPDATE flow_runs SET status = 'success' WHERE id = ?").run(running);
    expect(await claimQueuedRun(queued!)).toBe(true);
  });
});

describe('Flow: polling', () => {
  const RSS = (items: string[]) =>
    `<?xml version="1.0"?><rss><channel>${items
      .map((id) => `<item><title><![CDATA[Post ${id}]]></title><link>https://blog.test/${id}</link><guid>${id}</guid></item>`)
      .join('')}</channel></rss>`;

  it('parsea en tiempo lineal un feed hostil de 2 MB', () => {
    const t0 = Date.now();
    parseFeed('<item>'.repeat(350_000));
    parseFeed(`<rss><item><title>${'<title'.repeat(300_000)}</item></rss>`);
    parseFeed('<entry><link '.repeat(150_000));
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(parseFeed('<rss><item><guid>1</guid><title><![CDATA[a]]></title></item><items>x</items></rss>')).toHaveLength(1);
  });

  it('parsea RSS y Atom', () => {
    expect(parseFeed(RSS(['a']))[0]).toMatchObject({ id: 'a', title: 'Post a', link: 'https://blog.test/a' });
    const atom = '<feed><entry><id>x1</id><title>Hi &amp; bye</title><link rel="alternate" href="https://a.test/1"/></entry></feed>';
    expect(parseFeed(atom)[0]).toMatchObject({ id: 'x1', title: 'Hi & bye', link: 'https://a.test/1' });
  });

  it('la primera consulta toma la línea de base y después corre una vez por ítem nuevo', async () => {
    vi.stubEnv('ALLOW_PRIVATE_WEBHOOKS', 'true');
    let feed = RSS(['2', '1']);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(feed, { status: 200 })));
    const ws = (await makeUser('fp-poll')).id;
    const flow = await newFlow(ws, ws, {
      nodes: [
        { id: 't', type: 'trigger.poll', position: { x: 0, y: 0 }, config: { source: 'rss', url: 'http://blog.test/feed', everyMinutes: 5 } },
        node('a', 'data.set', { fields: [{ key: 't', value: '{{trigger.title}}' }] }),
      ],
      edges: [edge('t', 'a')],
    });
    await updateFlow(ws, flow.id, { enabled: true }, ws);
    expect(await enqueueDuePolls(new Date(Date.now() + 1000))).toBe(0);
    feed = RSS(['4', '3', '2', '1']);
    expect(await enqueueDuePolls(new Date(Date.now() + 6 * 60_000))).toBe(2);
    const inputs = (await getDb().prepare("SELECT input FROM flow_runs WHERE flow_id = ? AND trigger_type = 'trigger.poll' ORDER BY created_at, rowid").all(flow.id)) as Array<{
      input: string;
    }>;
    expect(inputs.map((r) => JSON.parse(r.input).title)).toEqual(['Post 3', 'Post 4']);
    // Antes de tiempo no vuelve a consultar.
    expect(await enqueueDuePolls(new Date(Date.now() + 7 * 60_000))).toBe(0);
  });

  it('una URL privada no se consulta (SSRF) y queda el error', async () => {
    const ws = (await makeUser('fp-ssrf')).id;
    const flow = await newFlow(ws, ws, {
      nodes: [{ id: 't', type: 'trigger.poll', position: { x: 0, y: 0 }, config: { source: 'json', url: 'http://127.0.0.1/admin', everyMinutes: 5 } }],
      edges: [],
    });
    await updateFlow(ws, flow.id, { enabled: true }, ws);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await enqueueDuePolls(new Date(Date.now() + 1000));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.parse((await getFlowRow(ws, flow.id))!.poll_state!).error).toBe('private_host');
  });
});

describe('Flow: formulario hospedado', () => {
  it('valida los campos y corre el flow con lo que se envió', async () => {
    const ws = (await makeUser('fp-form')).id;
    const flow = await newFlow(ws, ws, {
      nodes: [
        {
          id: 't',
          type: 'trigger.form',
          position: { x: 0, y: 0 },
          config: {
            title: 'Contacto',
            formFields: [
              { label: 'Nombre completo', type: 'text', required: true },
              { label: 'Email', type: 'email', required: true },
              { label: 'Plan', type: 'select', options: 'Basic, Pro' },
            ],
          },
        },
      ],
      edges: [],
    });
    const token = (await listFlowWebhooks(ws, flow.id))[0].token;
    expect((await publicForm(token))?.open).toBe(false);
    await updateFlow(ws, flow.id, { enabled: true }, ws);
    const form = await publicForm(token);
    expect(form?.fields.map((f) => f.key)).toEqual(['nombre_completo', 'email', 'plan']);
    const bad = await enqueueWebhookRun(token, { method: 'POST', body: { email: 'nope', plan: 'Gold' }, query: {}, headers: {} });
    expect(bad).toMatchObject({ ok: false, error: 'invalid_form', fields: { nombre_completo: 'required', email: 'invalid_email', plan: 'invalid_option' } });
    // Sin sello, o enviado al instante: no corre (bots).
    const valid = { nombre_completo: 'Ada', email: 'ada@x.test', plan: 'Pro', extra: 'x' };
    expect(await enqueueWebhookRun(token, { method: 'POST', body: valid, query: {}, headers: {} })).toMatchObject({ ok: false, error: 'form_check' });
    expect(await enqueueWebhookRun(token, { method: 'POST', body: { ...valid, _ts: formStamp(token) }, query: {}, headers: {} })).toMatchObject({
      ok: false,
      error: 'form_check',
    });
    expect(checkFormStamp(token, formStamp('fh_other_token_xxxxxxxxxxxxxxx', Date.now() - 5000))).toBe('invalid');
    const stamp = formStamp(token, Date.now() - 5000);
    const ok = await enqueueWebhookRun(token, { method: 'POST', body: { ...valid, _ts: stamp }, query: {}, headers: {} });
    // El mismo sello no sirve dos veces.
    expect(await enqueueWebhookRun(token, { method: 'POST', body: { ...valid, _ts: stamp }, query: {}, headers: {} })).toMatchObject({ ok: false, error: 'form_check' });
    expect(ok.ok && ok.runId).toBeTruthy();
    const run = (await getDb().prepare('SELECT input FROM flow_runs WHERE id = ?').get(ok.ok ? ok.runId : '')) as { input: string };
    expect(JSON.parse(run.input).fields).toEqual({ nombre_completo: 'Ada', email: 'ada@x.test', plan: 'Pro' });
    expect(await enqueueWebhookRun(token, { method: 'POST', body: { _hp: 'bot' }, query: {}, headers: {} })).toMatchObject({ ok: true, ignored: true });
  });

  it('limita los envíos por IP y usa su propio cupo, no el tope del workspace', async () => {
    vi.stubEnv('RATE_LIMIT_DISABLED', 'false');
    vi.stubEnv('FLOW_RUNS_PER_HOUR', '1');
    const ws = (await makeUser('fp-form-ip')).id;
    const flow = await newFlow(ws, ws, {
      nodes: [{ id: 't', type: 'trigger.form', position: { x: 0, y: 0 }, config: { formFields: [{ label: 'Email', type: 'email', required: true }] } }],
      edges: [],
    });
    await updateFlow(ws, flow.id, { enabled: true }, ws);
    const token = (await listFlowWebhooks(ws, flow.id))[0].token;
    let k = 0;
    const base = Date.now() - 5000;
    const send = (ip: string) =>
      enqueueWebhookRun(token, { method: 'POST', body: { email: 'a@x.test', _ts: formStamp(token, base - k++) }, query: {}, headers: {} }, { body: '', signature: null, ip });
    const ip = `198.51.100.${Math.floor(Math.random() * 200)}`;
    const results = [];
    for (let i = 0; i < 12; i++) results.push(await send(ip));
    // Con FLOW_RUNS_PER_HOUR=1 igual entran 10 (cupo de formularios), y la IP se frena después.
    expect(results.filter((r) => r.ok)).toHaveLength(10);
    expect(results[11]).toMatchObject({ ok: false, error: 'rate_limited' });
  });

  it('validateFormSubmission normaliza checkbox y número', () => {
    const fields = formFields({ formFields: [{ label: 'Acepto', type: 'checkbox', required: true }, { label: 'Edad', type: 'number' }] });
    expect(validateFormSubmission(fields, { acepto: 'on', edad: '42' })).toEqual({ ok: true, values: { acepto: true, edad: 42 } });
    expect(validateFormSubmission(fields, {})).toMatchObject({ ok: false, errors: { acepto: 'required' } });
  });
});

describe('Flow: historial global', () => {
  it('busca por dato solo en las corridas capturadas por quien busca y exporta sin datos ajenos', async () => {
    const { ws, ana, bob } = await team();
    const flow = await newFlow(ws, ana, { nodes: [T], edges: [] });
    await runFlowNow(ws, flow.id, { secret: 'ana-only-value' }, { personId: ana, admin: true });
    const asAna = await searchRuns(ws, { personId: ana, admin: true }, { q: 'ana-only-value' });
    expect(asAna.runs).toHaveLength(1);
    expect(asAna.runs[0].input).toMatchObject({ secret: 'ana-only-value' });
    const asBob = await searchRuns(ws, { personId: bob, admin: true }, { q: 'ana-only-value' });
    expect(asBob.runs).toHaveLength(0);
    const all = await searchRuns(ws, { personId: bob, admin: true }, {});
    expect(all.runs[0].dataHidden).toBe(true);
    expect(JSON.stringify(all)).not.toContain('ana-only-value');
    expect(await exportRuns(ws, { personId: bob, admin: true }, {}, 'json')).not.toContain('ana-only-value');
    const csv = await exportRuns(ws, { personId: bob, admin: true }, {}, 'csv');
    expect(csv.split('\r\n')[0]).toBe('run_id,flow,status,trigger,error,steps,created_at,started_at,finished_at,duration_ms');
    expect((await flowStats(ws, 7)).total).toBe(1);
  });
});

describe('Flow: importar, copiar y pegar, cURL', () => {
  it('parsea cURL con headers, cuerpo y usuario', () => {
    const c = parseCurl(`curl -X PUT 'https://api.test/items/1' \\\n  -H 'Content-Type: application/json' -H "Authorization: Bearer abc" -d '{"a": "b c"}'`);
    expect(c).toEqual({
      method: 'PUT',
      url: 'https://api.test/items/1',
      headers: [
        { key: 'Content-Type', value: 'application/json' },
        { key: 'Authorization', value: 'Bearer abc' },
      ],
      body: '{"a": "b c"}',
    });
    expect(parseCurl('curl https://x.test -d a=1')?.method).toBe('POST');
    expect(parseCurl('curl -u me:pw https://x.test')?.headers[0]).toEqual({ key: 'Authorization', value: `Basic ${Buffer.from('me:pw').toString('base64')}` });
    expect(parseCurl('wget https://x.test')).toBeNull();
    expect(shellWords(`a "b \\"c\\"" 'd e'`)).toEqual(['a', 'b "c"', 'd e']);
  });

  it('pega con ids nuevos, renombra referencias y no duplica el trigger', () => {
    const g: FlowGraph = {
      nodes: [T, node('http_1', 'action.http', { url: 'x' }), node('set_1', 'data.set', { fields: [{ key: 'v', value: '{{nodes.http_1.output.body}}' }] })] as FlowGraph['nodes'],
      edges: [edge('t', 'http_1'), edge('http_1', 'set_1')],
    };
    const clip = parseClipboard(JSON.stringify(copyNodes(g, ['t', 'http_1', 'set_1'])))!;
    const { graph, added } = pasteNodes(g, clip);
    expect(added).toEqual(['http_2', 'set_2']);
    expect(graph.nodes.find((n) => n.id === 'set_2')?.config).toEqual({ fields: [{ key: 'v', value: '{{nodes.http_2.output.body}}' }] });
    expect(graph.edges.some((e) => e.source === 'http_2' && e.target === 'set_2')).toBe(true);
    expect(validateGraph(graph).ok).toBe(true);
  });

  it('importar limpia las referencias de otro workspace', async () => {
    const ws = (await makeUser('fp-imp')).id;
    const parsed = parseFlowImport(
      JSON.stringify({ format: 'zerosoft-flow', name: 'X', graph: { nodes: [T, node('s', 'app.slack', { credentialId: 'cred-of-other-ws', channel: '#a' })], edges: [edge('t', 's')] } }),
    );
    expect(parsed?.name).toBe('X');
    const clean = await sanitizeImportedGraph(ws, parsed!.graph as FlowGraph);
    expect(clean.nodes[1].config).toEqual({ credentialId: '', channel: '#a' });
    expect(parseFlowImport('nope')).toBeNull();
  });
});

describe('Flow: IA (sin modelo real)', () => {
  it('el armador falso arma un flow válido sin credenciales', () => {
    const graph = builtToGraph(fakeBuild('When someone fills a form, add the contact to the CRM and post to Slack'));
    expect(graph).not.toBeNull();
    expect(graph!.nodes.map((n) => n.type)).toEqual(['trigger.form', 'app.crm_contact', 'app.slack']);
    expect(graph!.nodes.some((n) => 'credentialId' in n.config && n.config.credentialId)).toBe(false);
    expect(builtToGraph({ name: 'x', description: '', nodes: [{ id: 'a', type: 'action.email', configJson: '{}' }], edges: [] })).toBeNull();
  });

  it('extraer: sin IA configurada falla con ai_disabled; con el modelo falso devuelve los campos', async () => {
    const ws = (await makeUser('fp-ai')).id;
    vi.stubEnv('AI_GATEWAY_API_KEY', '');
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('VERCEL_OIDC_TOKEN', '');
    await expect(aiExtractNode(ws, { mode: 'extract', text: 'Name: Ada', fields: [{ key: 'name', value: '' }], categories: '', instructions: '' })).rejects.toMatchObject({
      code: 'ai_disabled',
    });
    vi.stubEnv('FLOW_AI_FAKE', '1');
    expect(
      await aiExtractNode(ws, { mode: 'extract', text: 'Name: Ada\nwrite to ada@x.test', fields: [{ key: 'name', value: '' }, { key: 'email', value: '' }], categories: '', instructions: '' }),
    ).toEqual({ name: 'Ada', email: 'ada@x.test' });
    expect(await aiExtractNode(ws, { mode: 'classify', text: 'I need help with billing', fields: [], categories: 'Sales\nBilling', instructions: '' })).toMatchObject({
      category: 'Billing',
    });
    expect(extractFields([{ key: 'ok' }, { key: 'bad key' }, { key: 'ok' }])).toEqual([{ key: 'ok', description: '' }]);
  });

  it('el diagnóstico no manda valores que parecen secretos', () => {
    expect(redactConfig({ url: 'https://x', headers: [{ key: 'Authorization', value: 'Bearer abc' }], apiKey: 'k' })).toEqual({
      url: 'https://x',
      headers: [{ key: 'Authorization', value: '[redacted]' }],
      apiKey: '[redacted]',
    });
    const r = redactSecretsInText('https://api.test/x?token=abc123&q=1 Bearer sk_live_51HxYzAbCdEfGhIj key: AKIAABCDEFGHIJKLMNOP x9Fk2LmQ8rTz7VwYp3Nc5Hb1Jd hello world');
    expect(r).not.toMatch(/abc123|sk_live|AKIAABCD|x9Fk2LmQ/);
    expect(r).toContain('q=1');
    expect(r).toContain('hello world');
  });
});

describe('Flow: HTTP paginado y Sheets', () => {
  it('sigue el header Link y junta los ítems', async () => {
    vi.stubEnv('ALLOW_PRIVATE_WEBHOOKS', 'true');
    const pages: Record<string, { items: number[]; link?: string }> = {
      'http://api.test/items': { items: [1, 2], link: '<http://api.test/items?page=2>; rel="next"' },
      'http://api.test/items?page=2': { items: [3] },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) => {
        const p = pages[String(url)];
        return new Response(JSON.stringify({ data: p.items }), { status: 200, headers: p.link ? { link: p.link } : {} });
      }),
    );
    const ws = (await makeUser('fp-page')).id;
    const flow = await newFlow(ws, ws, {
      nodes: [T, node('h', 'action.http', { method: 'GET', url: 'http://api.test/items', paginate: 'next_url', nextUrlPath: 'header.link', itemsPath: 'data', maxPages: 5 })],
      edges: [edge('t', 'h')],
    });
    const res = await runFlowNow(ws, flow.id, {});
    expect(res.ok && res.run?.steps.find((s) => s.nodeId === 'h')?.output).toMatchObject({ items: [1, 2, 3], pages: 2 });
    expect(nextFromLinkHeader('<https://a.test/2>; rel="next", <https://a.test/9>; rel="last"')).toBe('https://a.test/2');

    // Una página siguiente en otro host no se sigue (llevaría la credencial).
    pages['http://api.test/items'].link = '<http://evil.test/steal>; rel="next"';
    const res2 = await runFlowNow(ws, flow.id, {});
    expect(res2.ok && res2.run?.steps.find((s) => s.nodeId === 'h')?.output).toMatchObject({ items: [1, 2], pages: 1 });
  });

  it('busca filas por encabezado y arma rangos A1', () => {
    const values = [['Name', 'Email'], ['Ada', 'ada@x.test'], ['Bob', 'bob@x.test']];
    expect(lookupSheetRows(values, 'email', 'bob@x.test')).toEqual([{ rowNumber: 3, row: { Name: 'Bob', Email: 'bob@x.test' } }]);
    expect(columnLetter(0)).toBe('A');
    expect(columnLetter(27)).toBe('AB');
    expect(sheetName("'Hoja 1'!A1:C9")).toBe('Hoja 1');
  });
});
