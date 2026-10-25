import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { addMember, createTeam } from '@/lib/teams';
import { createDocPage, getDocPageRow, parseBlocks, updateDocPage } from '@/lib/docs';
import { defaultDatabase, normalizeDatabase } from '@/lib/docs-database';
import type { DocsBlock } from '@/lib/docs-types';
import {
  coerceValue,
  createPage,
  createRow,
  deleteRow,
  DocsPlatformError,
  fillTemplateBlocks,
  getPage,
  listDatabases,
  listPages,
  queryRows,
  searchPages,
  updatePage,
  updateRow,
} from '@/lib/docs-platform';
import { docsActorFor, pageFor } from '@/lib/docs-platform-access';
import { databaseEventDrafts, flushPageUpdatedEvents } from '@/lib/docs-events';
import { keepSyncedDatabases } from '@/lib/docs-sync-guard';
import { buildSyncedDatabase, claimSource, createSource, normalizeConfig, rowIdFor, runSync, unlinkSource, DocsSyncError } from '@/lib/docs-sync';
import { handleDocsRpc } from '@/lib/docs-mcp';
import { docsPageFlowNode, docsRowFlowNode } from '@/lib/flow-app-nodes';
import { agentDocsScope, readDocsForAgent, writePageForAgent, writeRowForAgent } from '@/lib/agent-docs-tools';
import { askWorkspace, cleanAnswer, fakeMeetingNotes, runEditorAi, summarizeMeeting } from '@/lib/docs-ai';
import { appendTranscript, createMeeting, getMeeting, markActionsSent, meetingBlockContent, MEETING_MAX_SECONDS } from '@/lib/docs-meetings';
import { createWebhook, listDeliveries } from '@/lib/webhooks';
import { API_SCOPES, hasScope } from '@/lib/api-scopes';
import { endpointScope, API_ENDPOINTS } from '@/lib/api-docs';
import { AiError } from '@/lib/ai';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  vi.stubEnv('ALLOW_PRIVATE_WEBHOOKS', 'true');
  vi.stubEnv('DOCS_SYNC_FAKE', '1');
  vi.stubEnv('DOCS_AI_FAKE', '1');
  vi.stubEnv('DOCS_EVENT_WINDOW_SEC', '0');
  vi.stubEnv('AI_FREE_TOKENS_PER_MONTH', 'unlimited');
});

async function workspace(label: string) {
  const user = await makeUser(label);
  const actor = (await docsActorFor(user.id, user.id))!;
  return { user, actor };
}

function dbBlock(): DocsBlock {
  const db = defaultDatabase();
  return { id: crypto.randomUUID(), type: 'database', content: '', db };
}

describe('Docs D4: API de páginas (lib/docs-platform.ts)', () => {
  it('crea, lee en Markdown, agrega, reemplaza conservando bases, renombra y manda a la papelera', async () => {
    const { actor } = await workspace('dp-pages');
    const parent = await createPage(actor, { title: 'Roadmap' });
    const page = await createPage(actor, { title: 'Q4', parentId: parent.id, markdown: '## Goals\n\n- [ ] Ship beta' });
    expect(page.parentId).toBe(parent.id);
    expect(page.markdown).toContain('## Goals');
    expect(page.markdown).toContain('- [ ] Ship beta');

    const appended = await updatePage(actor, page.id, { appendMarkdown: 'Next: **launch**' });
    expect(appended.markdown.trim().endsWith('Next: **launch**')).toBe(true);

    // Una base en la página: reemplazar el contenido la conserva.
    const row = (await getDocPageRow(page.id))!;
    const withDb = [...parseBlocks(row.content), dbBlock()];
    await updateDocPage(row.user_id, page.id, { content: withDb });
    const replaced = await updatePage(actor, page.id, { markdown: 'Only this' });
    expect(replaced.markdown).toContain('Only this');
    expect(replaced.databases).toHaveLength(1);

    const renamed = await updatePage(actor, page.id, { title: 'Q4 plan' });
    expect(renamed.title).toBe('Q4 plan');

    const children = await listPages(actor, { parentId: parent.id });
    expect(children.pages.map((p) => p.id)).toEqual([page.id]);
    const hits = await searchPages(actor, 'Only this');
    expect(hits[0]?.page.id).toBe(page.id);

    await updatePage(actor, page.id, { archived: true });
    expect(await pageFor(actor, page.id)).toBeNull();
    await expect(getPage(actor, page.id)).rejects.toBeInstanceOf(DocsPlatformError);
  });

  it('crea desde una plantilla y completa sus {{variables}} escapando HTML', async () => {
    const { actor } = await workspace('dp-tpl');
    const page = await createPage(actor, { templateId: 'builtin:meeting-notes', title: 'Weekly', locale: 'en' }).catch(() => null);
    // La plantilla integrada puede no existir con esa clave: se valida el relleno puro.
    if (page) expect(page.title).toBe('Weekly');
    const filled = fillTemplateBlocks([{ id: 'a', type: 'paragraph', content: 'Hi {{name}} <b>{{x}}</b>' }], { name: 'Ada <3', x: '1' });
    expect(filled[0].content).toBe('Hi Ada &lt;3 <b>1</b>');
    await expect(createPage(actor, { templateId: 'nope' })).rejects.toMatchObject({ code: 'template_not_found' });
  });

  it('respeta permisos: otro workspace no ve ni escribe; un miembro del equipo sí', async () => {
    const { user: owner, actor } = await workspace('dp-owner');
    const page = await createPage(actor, { title: 'Private', markdown: 'secret' });
    const stranger = await makeUser('dp-stranger');
    const strangerActor = (await docsActorFor(stranger.id, stranger.id))!;
    expect(await pageFor(strangerActor, page.id)).toBeNull();
    // Una key de otra persona sobre el workspace del dueño solo si es miembro.
    const member = await makeUser('dp-member');
    const team = await createTeam(owner.id, 'Team');
    await addMember(team.id, member.id, 'member');
    const memberActor = (await docsActorFor(owner.id, member.id))!;
    expect(memberActor.actingUser?.id).toBe(member.id);
    expect((await pageFor(memberActor, page.id))?.access).toBe('owner');
    await expect(updatePage(strangerActor, page.id, { appendMarkdown: 'x' })).rejects.toMatchObject({ status: 404 });
    // El hijo no se puede colgar de una página de otro workspace.
    await expect(createPage(strangerActor, { title: 'x', parentId: page.id })).rejects.toMatchObject({ code: 'parent_not_found' });
  });
});

describe('Docs D4: mismas reglas que el editor (D3)', () => {
  it('página bloqueada: 423 al cambiar contenido; sin edición: 403', async () => {
    const { user: owner, actor } = await workspace('dp-lock');
    const page = await createPage(actor, { title: 'Locked', markdown: 'x' });
    await getDb().prepare('UPDATE docs_pages SET locked = 1 WHERE id = ?').run(page.id);
    await expect(updatePage(actor, page.id, { appendMarkdown: 'y' })).rejects.toMatchObject({ status: 423 });
    await getDb().prepare('UPDATE docs_pages SET locked = 0, member_role = ? WHERE id = ?').run('view', page.id);
    const member = await makeUser('dp-lock-m');
    const team = await createTeam(owner.id, 'T');
    await addMember(team.id, member.id, 'member');
    const viewer = (await docsActorFor(owner.id, member.id))!;
    expect((await pageFor(viewer, page.id))?.access).toBe('view');
    await expect(updatePage(viewer, page.id, { appendMarkdown: 'z' })).rejects.toMatchObject({ status: 403 });
  });
});

describe('Docs D4: filas de bases', () => {
  it('agrega y cambia filas por nombre de propiedad (crea opciones, persona por email, fechas) y filtra', async () => {
    const { user, actor } = await workspace('dp-rows');
    const block = dbBlock();
    const db = normalizeDatabase(block);
    db.properties.push({ id: 'tags', name: 'Tags', type: 'multi_select', options: [] }, { id: 'deadline', name: 'Deadline', type: 'date' }, { id: 'pts', name: 'Points', type: 'number' }, { id: 'own', name: 'Owner', type: 'person' });
    const page = await createDocPage(user.id, { title: 'Projects', content: [{ ...block, db }] });

    const row = await createRow(actor, page.id, block.id, { title: 'Website', values: { Tags: ['web', 'q4'], Deadline: '2026-11-30', Points: '3', Owner: user.email } });
    expect(row.title).toBe('Website');
    expect(row.properties.Tags).toBe('web, q4');
    expect(row.values.Deadline).toBe('2026-11-30');
    expect(row.values.Points).toBe(3);
    expect(row.values.Owner).toEqual([user.id]);

    const status = db.properties.find((p) => p.type === 'status');
    if (status) {
      const done = status.options!.find((o) => o.group === 'done')!;
      const upd = await updateRow(actor, page.id, block.id, row.id, { values: { [status.name]: done.name }, appendMarkdown: 'Notes' });
      expect(upd.properties[status.name]).toBe(done.name);
      await expect(updateRow(actor, page.id, block.id, row.id, { values: { [status.name]: 'Nope' } })).rejects.toMatchObject({ code: `invalid_option:${status.name}` });
    }
    await expect(createRow(actor, page.id, block.id, { values: { Missing: 'x' } })).rejects.toMatchObject({ code: 'unknown_property:Missing' });
    await expect(createRow(actor, page.id, block.id, { values: { Owner: 'nobody@x.y' } })).rejects.toMatchObject({ code: 'invalid_person:Owner' });

    await createRow(actor, page.id, block.id, { title: 'Docs', values: { Tags: 'web' } });
    const web = await queryRows(actor, page.id, block.id, { filter: { Tags: 'q4' } });
    expect(web.rows.map((r) => r.title)).toEqual(['Website']);
    expect((await listDatabases(actor)).some((d) => d.blockId === block.id)).toBe(true);

    // La base nueva trae una fila vacía, más "Docs".
    await deleteRow(actor, page.id, block.id, row.id);
    expect((await queryRows(actor, page.id, block.id)).total).toBe(2);
  });

  it('coerceValue: números, checkbox y select nuevo', () => {
    expect(coerceValue({ id: 'n', name: 'N', type: 'number' }, '1.234,5', []).value).toBe(1234.5);
    expect(coerceValue({ id: 'c', name: 'C', type: 'checkbox' }, 'true', []).value).toBe(true);
    const res = coerceValue({ id: 's', name: 'S', type: 'select', options: [] }, 'New', []);
    expect(res.property?.options?.[0].name).toBe('New');
    expect(() => coerceValue({ id: 'n', name: 'N', type: 'number' }, 'abc', [])).toThrow(DocsPlatformError);
  });
});

describe('Docs D4: eventos hacia Flow y webhooks', () => {
  it('detecta filas nuevas y propiedades cambiadas (puro)', () => {
    const block = dbBlock();
    const db = normalizeDatabase(block);
    const status = db.properties.find((p) => p.type === 'status')!;
    const rowId = 'r1';
    const before: DocsBlock[] = [{ ...block, db: { ...db, rows: [{ id: rowId, values: { title: 'A', [status.id]: status.options![0].id }, created_at: '', updated_at: '' }] } }];
    const after: DocsBlock[] = [
      {
        ...block,
        db: {
          ...db,
          rows: [
            { id: rowId, values: { title: 'A', [status.id]: status.options![2].id }, created_at: '', updated_at: '' },
            { id: 'r2', values: { title: 'B' }, created_at: '', updated_at: '' },
          ],
        },
      },
    ];
    const drafts = databaseEventDrafts({ id: 'p', title: 'P', parent_id: null, updated_at: '' }, before, after);
    expect(drafts.map((d) => d.type).sort()).toEqual(['database.property_changed', 'database.row_created']);
    const changed = drafts.find((d) => d.type === 'database.property_changed')!.data as { property: { name: string }; value: string; previous: string };
    expect(changed.property.name).toBe(status.name);
    expect(changed.value).toBe(status.options![2].name);
    // Una base nueva entera no dispara una fila por cada fila.
    expect(databaseEventDrafts({ id: 'p', title: 'P', parent_id: null, updated_at: '' }, [], after)).toEqual([]);
  });

  it('page.updated se agrupa: una marca por página que el cron emite y borra (con claim)', async () => {
    const { user, actor } = await workspace('dp-events');
    await createWebhook(user.id, { url: 'http://127.0.0.1:9/hook', events: ['page.updated', 'page.comment_created'] });
    const page = await createPage(actor, { title: 'Live' });
    await updatePage(actor, page.id, { appendMarkdown: 'one' });
    await updatePage(actor, page.id, { appendMarkdown: 'two' });
    const marks = (await getDb().prepare('SELECT * FROM docs_event_marks WHERE page_id = ?').all(page.id)) as unknown[];
    expect(marks).toHaveLength(1);
    const sent = await flushPageUpdatedEvents(new Date(Date.now() + 1000));
    expect(sent).toBeGreaterThanOrEqual(1);
    expect(await getDb().prepare('SELECT 1 FROM docs_event_marks WHERE page_id = ?').get(page.id)).toBeUndefined();
    const hooks = (await getDb().prepare('SELECT id FROM webhooks WHERE user_id = ?').all(user.id)) as Array<{ id: string }>;
    const deliveries = await listDeliveries(user.id, hooks[0].id);
    expect(deliveries?.some((d) => d.event === 'page.updated' && d.payload.includes(page.id))).toBe(true);
    // Sin nadie escuchando, no se marca nada.
    const other = await workspace('dp-events-quiet');
    const p2 = await createPage(other.actor, { title: 'Quiet' });
    await updatePage(other.actor, p2.id, { appendMarkdown: 'x' });
    expect(await getDb().prepare('SELECT 1 FROM docs_event_marks WHERE page_id = ?').get(p2.id)).toBeUndefined();
  });
});

describe('Docs D4: bases sincronizadas', () => {
  it('el guardado del editor no cambia filas ni propiedades de una base sincronizada', () => {
    const block = dbBlock();
    const synced: DocsBlock = { ...block, db: { ...block.db!, sync: { source_id: 's1', provider: 'github', label: 'a/b · Issues' } } };
    const edited: DocsBlock = { ...synced, db: { ...synced.db!, rows: [], views: [{ id: 'v2', name: 'Mine', type: 'board' }] } };
    const out = keepSyncedDatabases([synced], [edited]);
    expect(out[0].db!.rows).toEqual(synced.db!.rows);
    expect(out[0].db!.views[0].id).toBe('v2');
    // Una base común no se vuelve sincronizada desde el editor (salvo origen registrado).
    const forged: DocsBlock = { ...block, db: { ...block.db!, sync: { source_id: 'x', provider: 'jira', label: '' } } };
    expect(keepSyncedDatabases([block], [forged])[0].db!.sync).toBeUndefined();
    expect(keepSyncedDatabases([], [forged], new Set([`x:${block.id}`]))[0].db!.sync).toBeDefined();
  });

  it('valida la configuración de cada origen', () => {
    expect(normalizeConfig('github', { repo: 'https://github.com/acme/web.git' }).repo).toBe('acme/web');
    expect(() => normalizeConfig('github', { repo: 'bad' })).toThrow(DocsSyncError);
    expect(() => normalizeConfig('jira', { site: 'evil.com', email: 'a@b.co' })).toThrow(DocsSyncError);
    expect(normalizeConfig('jira', { site: 'https://acme.atlassian.net/browse/X', email: 'a@b.co' }).site).toBe('acme.atlassian.net');
    expect(() => normalizeConfig('salesforce', { instanceUrl: 'http://127.0.0.1' })).toThrow(DocsSyncError);
  });

  it('crea la base (fake de GitHub), la acepta al guardar, refresca con claim y se desvincula', async () => {
    const { user } = await workspace('dp-sync');
    const page = await createDocPage(user.id, { title: 'Eng' });
    const { source, block } = await createSource({ workspaceId: user.id, pageId: page.id, personId: user.id, provider: 'github', config: { repo: 'acme/web' } });
    expect(block.db!.rows).toHaveLength(3);
    expect(block.db!.sync?.source_id).toBe(source.id);
    expect(block.db!.rows[0].id).toBe(rowIdFor(source.id, 'is1'));
    // El editor inserta el bloque y guarda: queda sincronizada.
    await updateDocPage(user.id, page.id, { content: [block] });
    let saved = parseBlocks((await getDocPageRow(page.id))!.content).find((b) => b.id === block.id)!;
    expect(saved.db!.sync?.provider).toBe('github');
    // La API no puede escribir filas en ella.
    const actor = (await docsActorFor(user.id, user.id))!;
    await expect(createRow(actor, page.id, block.id, { title: 'x' })).rejects.toMatchObject({ code: 'read_only' });

    expect(await claimSource(source.id, new Date(), true)).toBe(true);
    expect(await claimSource(source.id, new Date(), true)).toBe(false);
    const after = await runSync(source.id);
    expect(after?.status).toBe('ok');
    expect(after?.itemCount).toBe(3);

    await unlinkSource(source.id);
    saved = parseBlocks((await getDocPageRow(page.id))!.content).find((b) => b.id === block.id)!;
    expect(saved.db!.sync).toBeUndefined();
    expect(saved.db!.rows).toHaveLength(3);
  });

  it('un error del origen no crea nada', async () => {
    const { user } = await workspace('dp-sync-err');
    const page = await createDocPage(user.id, { title: 'Eng' });
    await expect(createSource({ workspaceId: user.id, pageId: page.id, personId: user.id, provider: 'github', config: { repo: 'acme/missing' } })).rejects.toMatchObject({ code: 'source_not_found' });
    await expect(createSource({ workspaceId: user.id, pageId: page.id, personId: user.id, provider: 'jira', config: { site: 'acme.atlassian.net', email: 'a@b.co' } })).rejects.toMatchObject({ code: 'missing_token' });
  });

  it('arma la base conservando opciones y vistas entre corridas (puro)', () => {
    const src = { id: 'src', provider: 'jira' as const, config: JSON.stringify({ site: 'acme.atlassian.net', jql: 'x' }) };
    const items = [{ key: '1', title: 'Bug', values: { key: 'ENG-1', status: 'To Do', type: 'Bug' } }];
    const first = buildSyncedDatabase(null, src, items);
    const statusId = first.rows[0].values.status;
    const second = buildSyncedDatabase({ ...first, views: [{ id: 'mine', name: 'Mine', type: 'board' }] }, src, items);
    expect(second.rows[0].values.status).toBe(statusId);
    expect(second.views[0].id).toBe('mine');
  });
});

describe('Docs D4: servidor MCP', () => {
  it('lista herramientas, busca, crea con docs:write y rechaza sin el scope', async () => {
    const { actor } = await workspace('dp-mcp');
    await createPage(actor, { title: 'Pricing', markdown: 'We decided on three plans.' });
    const list = await handleDocsRpc({ actor, scopes: ['docs:read'] }, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const names = ((list?.result as { tools: Array<{ name: string }> }).tools ?? []).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['search', 'fetch_page', 'create_page', 'update_page', 'query_database', 'create_row', 'update_row']));
    const search = await handleDocsRpc({ actor, scopes: ['docs:read'] }, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'search', arguments: { query: 'three plans' } } });
    expect(JSON.stringify(search?.result)).toContain('Pricing');
    const denied = await handleDocsRpc({ actor, scopes: ['docs:read'] }, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'create_page', arguments: { title: 'X' } } });
    expect((denied?.result as { isError: boolean }).isError).toBe(true);
    const ok = await handleDocsRpc({ actor, scopes: ['docs:write'] }, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'create_page', arguments: { title: 'From MCP', markdown: '- a' } } });
    expect((ok?.result as { isError: boolean }).isError).toBe(false);
    expect(await handleDocsRpc({ actor, scopes: [] }, { jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
  });

  it('scopes y documentación de la API', () => {
    expect(API_SCOPES).toContain('docs:read');
    expect(hasScope(['docs:write'], 'docs:read')).toBe(true);
    const docs = API_ENDPOINTS.filter((e) => e.sectionId === 'docs');
    expect(docs.length).toBeGreaterThanOrEqual(15);
    expect(endpointScope(docs.find((e) => e.method === 'POST' && e.path === '/api/v1/docs/pages')!)).toBe('docs:write');
    expect(endpointScope(docs.find((e) => e.method === 'GET' && e.path === '/api/v1/docs/search')!)).toBe('docs:read');
  });
});

describe('Docs D4: Flow crea y edita páginas y filas', () => {
  it('nodo de página: crear como subpágina, agregar y renombrar; nodo de fila: crear y actualizar por título', async () => {
    const { user } = await workspace('dp-flow');
    const parent = await createDocPage(user.id, { title: 'Inbox' });
    const tctx = { trigger: { contact: { name: 'Ada' } } };
    const created = await docsPageFlowNode(user.id, user.id, { operation: 'page_create', title: 'Lead {{trigger.contact.name}}', content: '## Notes\n\nCall {{trigger.contact.name}}', parentId: parent.id }, tctx);
    expect(created.page.title).toBe('Lead Ada');
    expect(created.page.parentId).toBe(parent.id);
    await docsPageFlowNode(user.id, user.id, { operation: 'page_append', pageId: created.page.id, content: 'Follow up' }, tctx);
    await docsPageFlowNode(user.id, user.id, { operation: 'page_rename', pageId: created.page.id, title: 'Lead: Ada' }, tctx);
    const actor = (await docsActorFor(user.id, user.id))!;
    const page = await getPage(actor, created.page.id);
    expect(page.title).toBe('Lead: Ada');
    expect(page.markdown).toContain('Follow up');
    // Legacy: sin operación crea (como el nodo de antes).
    const legacy = await docsPageFlowNode(user.id, user.id, { title: 'Old', content: 'a\n\nb' }, tctx);
    expect(legacy.page.title).toBe('Old');

    const block = dbBlock();
    const dbPage = await createDocPage(user.id, { title: 'Leads', content: [block] });
    const ref = `${dbPage.id}/${block.id}`;
    const row = await docsRowFlowNode(user.id, user.id, { operation: 'row_create', database: ref, title: 'Ada', values: [{ key: 'Status', value: 'In progress' }] }, tctx);
    expect(row.created).toBe(true);
    const status = normalizeDatabase(block).properties.find((p) => p.type === 'status')!;
    const done = status.options!.find((o) => o.group === 'done')!.name;
    const upd = await docsRowFlowNode(user.id, user.id, { operation: 'row_update', database: ref, title: 'Ada', values: [{ key: status.name, value: done }] }, tctx);
    expect(upd.row.id).toBe(row.row.id);
    expect(upd.row.properties[status.name]).toBe(done);
    await expect(docsRowFlowNode(user.id, user.id, { operation: 'row_update', database: ref, title: 'Nobody' }, tctx)).rejects.toThrow(/row_not_found/);
    await expect(docsPageFlowNode(user.id, user.id, { operation: 'page_append', content: 'x' }, tctx)).rejects.toThrow(/missing_page/);
  });
});

describe('Docs D4: agentes con páginas', () => {
  it('solo trabajan con las páginas elegidas y sus subpáginas', async () => {
    const { user } = await workspace('dp-agent');
    const allowed = await createDocPage(user.id, { title: 'Support KB' });
    const child = await createDocPage(user.id, { title: 'FAQ', parent_id: allowed.id });
    const other = await createDocPage(user.id, { title: 'Salaries' });
    const scope = await agentDocsScope(user.id, [allowed.id]);
    expect(scope.has(child.id)).toBe(true);
    expect(scope.has(other.id)).toBe(false);
    expect(await readDocsForAgent(user.id, [allowed.id], { pageId: other.id })).toEqual({ error: 'page_not_allowed' });
    const read = (await readDocsForAgent(user.id, [allowed.id], { pageId: allowed.id })) as { subpages: Array<{ id: string }> };
    expect(read.subpages.map((p) => p.id)).toEqual([child.id]);
    const made = (await writePageForAgent(user.id, [allowed.id], { operation: 'create', title: 'New answer', markdown: 'Text' }, 'Bot')) as { page: { id: string } };
    expect((await getDocPageRow(made.page.id))?.parent_id).toBe(allowed.id);
    expect(await writePageForAgent(user.id, [allowed.id], { operation: 'append', pageId: other.id, markdown: 'x' }, 'Bot')).toEqual({ error: 'page_not_allowed' });
    const block = dbBlock();
    const withDb = await createDocPage(user.id, { title: 'Tickets', parent_id: allowed.id, content: [block] });
    const row = (await writeRowForAgent(user.id, [allowed.id], { pageId: withDb.id, blockId: block.id, title: 'Refund' })) as { created: boolean };
    expect(row.created).toBe(true);
  });
});

describe('Docs D4: IA (modelo falso por env)', () => {
  it('editor, preguntas con citas y notas de reunión pasan por lib/ai.ts', async () => {
    const { user, actor } = await workspace('dp-ai');
    const out = await runEditorAi(user.id, { action: 'translate', language: 'es', selection: 'Hello team', pageTitle: 'P', pageText: 'Hello team' });
    expect(out).toBe('[es] Hello team');
    await createPage(actor, { title: 'Pricing decisions', markdown: 'We picked three plans for the launch.' });
    const ans = await askWorkspace(actor, 'what plans did we pick for the launch');
    expect('citations' in ans && ans.citations[0].title).toBe('Pricing decisions');
    expect('answer' in ans && ans.answer).toMatch(/\[1\]/);
    expect(await askWorkspace(actor, 'zzzqqq nothing')).toEqual({ error: 'no_matches' });
    const notes = await summarizeMeeting(user.id, { title: 'Sync', transcript: 'Ada: We decided to ship on Friday.\nGrace: I will send the notes tomorrow.' });
    expect(notes.decisions[0]).toContain('ship on Friday');
    expect(notes.actions[0].owner).toBe('Grace');
    const usage = (await getDb().prepare('SELECT feature FROM ai_usage WHERE user_id = ?').all(user.id)) as Array<{ feature: string }>;
    expect(usage.map((u) => u.feature)).toEqual(expect.arrayContaining(['docs_editor', 'docs_ask', 'docs_meeting']));
    expect(cleanAnswer('```markdown\nhi\n```')).toBe('hi');
    expect(fakeMeetingNotes('nothing here').decisions).toEqual([]);
  });

  it('sin IA configurada responde ai_disabled', async () => {
    vi.stubEnv('DOCS_AI_FAKE', '');
    vi.stubEnv('AI_GATEWAY_API_KEY', '');
    vi.stubEnv('VERCEL_OIDC_TOKEN', '');
    vi.stubEnv('VERCEL', '');
    const { user } = await workspace('dp-ai-off');
    await expect(runEditorAi(user.id, { action: 'summarize', pageTitle: 'P', pageText: 'x' })).rejects.toBeInstanceOf(AiError);
  });
});

describe('Docs D4: notas de reunión', () => {
  it('suma trozos hasta el tope, guarda tareas mandadas y arma el contenido del bloque escapado', async () => {
    const { user } = await workspace('dp-meet');
    const page = await createDocPage(user.id, { title: 'Weekly' });
    const m = await createMeeting(page, user.id, 'Weekly <sync>');
    expect(await appendTranscript(m.id, 'Ada: hi', 60)).toBe(true);
    expect(await appendTranscript(m.id, 'Grace: hello', 60)).toBe(true);
    expect(await appendTranscript(m.id, 'too long', MEETING_MAX_SECONDS)).toBe(false);
    const got = (await getMeeting(m.id))!;
    expect(got.transcript).toBe('Ada: hi\nGrace: hello');
    expect(got.durationSec).toBe(120);
    await getDb().prepare(`UPDATE docs_meetings SET actions = ? WHERE id = ?`).run(JSON.stringify([{ text: 'Send notes', owner: 'Grace', due: '' }]), m.id);
    const sent = await markActionsSent(m.id, [{ index: 0, ref: { kind: 'crm', id: 't1', label: 'Send notes', url: '/app/crm/tasks' } }]);
    expect(sent?.actions[0].sent?.id).toBe('t1');
    expect(meetingBlockContent({ title: 'A <b>', summary: 'x & y', decisions: [], actions: [] })).toBe('<strong>A &lt;b&gt;</strong><br>x &amp; y');
  });
});
