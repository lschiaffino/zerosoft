import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { addMember, createTeam } from '@/lib/teams';
import { createDocPage } from '@/lib/docs';
import { createTeamspace, setSubtreeTeamspace, setTeamspaceMember } from '@/lib/docs-access';
import { createPage, updatePage, DocsPlatformError } from '@/lib/docs-platform';
import { docsActorFor } from '@/lib/docs-platform-access';
import { emitCommentCreated, flushPageUpdatedEvents } from '@/lib/docs-events';
import { createWebhook, listDeliveries } from '@/lib/webhooks';
import { createFlow, getRunWithSteps, listRuns, updateFlow } from '@/lib/flow';
import { createSource, getSource, updateSource } from '@/lib/docs-sync';
import { handleDocsRpc } from '@/lib/docs-mcp';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  vi.stubEnv('ALLOW_PRIVATE_WEBHOOKS', 'true');
  vi.stubEnv('DOCS_SYNC_FAKE', '1');
  vi.stubEnv('DOCS_EVENT_WINDOW_SEC', '0');
});

/** Workspace con Bob (miembro del teamspace privado) y Dave (admin, no miembro). */
async function privateSetup(label: string) {
  const owner = await makeUser(`${label}-o`);
  const bob = await makeUser(`${label}-bob`);
  const dave = await makeUser(`${label}-dave`);
  const team = await createTeam(owner.id, 'Team');
  await addMember(team.id, bob.id, 'member');
  await addMember(team.id, dave.id, 'admin');
  const ts = await createTeamspace(owner.id, bob.id, { name: 'Secret', access: 'private' });
  await setTeamspaceMember(ts.id, bob.id, 'owner');
  const page = await createDocPage(owner.id, { title: 'Salaries' });
  await setSubtreeTeamspace(owner.id, [page.id], ts.id);
  const bobActor = (await docsActorFor(owner.id, bob.id))!;
  const daveActor = (await docsActorFor(owner.id, dave.id))!;
  return { owner, bob, dave, page, bobActor, daveActor };
}

const hookId = async (ws: string, url: string) =>
  ((await getDb().prepare('SELECT id FROM webhooks WHERE user_id = ? AND url = ?').get(ws, url)) as { id: string }).id;

describe('D4 QA: eventos de Docs solo para quien puede abrir la página', () => {
  it('webhooks de un admin que no es del teamspace privado no reciben ediciones ni comentarios', async () => {
    const { owner, bob, dave, page, bobActor } = await privateSetup('ev');
    await createWebhook(owner.id, { url: 'http://127.0.0.1:9/dave', events: ['page.updated', 'page.comment_created'], createdBy: dave.id });
    await createWebhook(owner.id, { url: 'http://127.0.0.1:9/bob', events: ['page.updated', 'page.comment_created'], createdBy: bob.id });
    await updatePage(bobActor, page.id, { appendMarkdown: 'Ada: 100k' });
    await flushPageUpdatedEvents(new Date(Date.now() + 1000));
    await emitCommentCreated(owner.id, page as never, { id: 'c1', body: 'secret comment', block_id: null, user_id: bob.id });
    const forDave = await listDeliveries(owner.id, await hookId(owner.id, 'http://127.0.0.1:9/dave'));
    const forBob = await listDeliveries(owner.id, await hookId(owner.id, 'http://127.0.0.1:9/bob'));
    expect(forDave).toEqual([]);
    expect(forBob?.map((d) => d.event).sort()).toEqual(['page.comment_created', 'page.updated']);
  });

  it('un flow de quien no puede leer la página no corre, y el texto es el de quien lo creó', async () => {
    const { owner, bob, dave, page, bobActor } = await privateSetup('flow');
    const graph = {
      nodes: [{ id: 't', type: 'trigger.event', position: { x: 0, y: 0 }, config: { event: 'page.updated' } }],
      edges: [],
    };
    const fDave = await createFlow(owner.id, dave.id, { name: 'Dave', graph });
    const fBob = await createFlow(owner.id, bob.id, { name: 'Bob', graph });
    if (!fDave.ok || !fBob.ok) throw new Error('flow');
    await updateFlow(owner.id, fDave.flow.id, { enabled: true }, dave.id);
    await updateFlow(owner.id, fBob.flow.id, { enabled: true }, bob.id);
    await updatePage(bobActor, page.id, { appendMarkdown: 'Grace: 120k' });
    await flushPageUpdatedEvents(new Date(Date.now() + 1000));
    expect(await listRuns(owner.id, fDave.flow.id)).toHaveLength(0);
    const runs = await listRuns(owner.id, fBob.flow.id);
    expect(runs).toHaveLength(1);
    expect(JSON.stringify(runs[0].input)).toContain('Grace: 120k');

    // Corridas: los datos solo para quien creó el flow y admins que pueden abrir la página.
    const forDave = await getRunWithSteps(owner.id, runs[0].id, { personId: dave.id, admin: true });
    expect(forDave?.dataHidden).toBe(true);
    expect(JSON.stringify(forDave?.input)).not.toContain('120k');
    const forBob = await getRunWithSteps(owner.id, runs[0].id, { personId: bob.id, admin: false });
    expect(JSON.stringify(forBob?.input)).toContain('120k');
    const member = await makeUser('flow-m');
    const listed = await listRuns(owner.id, fBob.flow.id, 30, { personId: member.id, admin: false });
    expect(listed[0].dataHidden).toBe(true);
  });
});

describe('D4 QA: Flow escribe en Docs con los permisos de quien lo configuró', () => {
  it('quien edita un nodo de Docs pasa a ser created_by; editar otra cosa no lo cambia', async () => {
    const owner = await makeUser('fcb-o');
    const admin = await makeUser('fcb-a');
    const team = await createTeam(owner.id, 'T');
    await addMember(team.id, admin.id, 'admin');
    const graph = (title: string) => ({
      nodes: [
        { id: 't', type: 'trigger.manual', position: { x: 0, y: 0 }, config: { sample: '{}' } },
        { id: 'd', type: 'app.docs_page', position: { x: 0, y: 100 }, config: { operation: 'page_create', title } },
      ],
      edges: [{ id: 'e', source: 't', target: 'd' }],
    });
    const f = await createFlow(owner.id, owner.id, { name: 'F', graph: graph('A') });
    if (!f.ok) throw new Error('flow');
    const renamed = await updateFlow(owner.id, f.flow.id, { name: 'F2' }, admin.id);
    expect(renamed.ok && (renamed.flow as { createdBy?: string | null }).createdBy).not.toBe(admin.id);
    await updateFlow(owner.id, f.flow.id, { graph: graph('B') }, admin.id);
    const row = (await getDb().prepare('SELECT created_by FROM flow_flows WHERE id = ?').get(f.flow.id)) as { created_by: string };
    expect(row.created_by).toBe(admin.id);
  });
});

describe('D4 QA: bases sincronizadas', () => {
  it('otra persona que cambia el origen tiene que usar su propio token y pasa a ser la dueña', async () => {
    const owner = await makeUser('sync-o');
    const other = await makeUser('sync-x');
    const team = await createTeam(owner.id, 'T');
    await addMember(team.id, other.id, 'admin');
    const page = await createDocPage(owner.id, { title: 'Eng' });
    const { source } = await createSource({
      workspaceId: owner.id,
      pageId: page.id,
      personId: owner.id,
      provider: 'jira',
      config: { site: 'acme.atlassian.net', email: 'a@acme.com', jql: 'project = A' },
      secret: { token: 'owner-token' },
    });
    await expect(updateSource(source.id, { config: { site: 'evil.atlassian.net' } }, other.id)).rejects.toMatchObject({ code: 'new_token_required' });
    const after = await updateSource(source.id, { config: { site: 'other.atlassian.net' }, secret: { token: 'other-token' } }, other.id);
    expect(after?.config.site).toBe('other.atlassian.net');
    const row = (await getSource(source.id))!;
    expect(row.created_by).toBe(other.id);
    // El token guardado es solo el nuevo (el del creador no queda mezclado).
    const { open } = await import('@/lib/secret-box');
    expect(JSON.parse(open(row.secret!))).toEqual({ token: 'other-token' });
    // El mismo creador sí puede cambiar el JQL sin volver a poner el token.
    await expect(updateSource(source.id, { config: { jql: 'project = B' } }, other.id)).resolves.toBeTruthy();
  });

  it('una página bloqueada no se escribe al sincronizar', async () => {
    const owner = await makeUser('sync-lock');
    const page = await createDocPage(owner.id, { title: 'Eng' });
    const { source, block } = await createSource({ workspaceId: owner.id, pageId: page.id, personId: owner.id, provider: 'github', config: { repo: 'acme/web' } });
    const { updateDocPage } = await import('@/lib/docs');
    await updateDocPage(owner.id, page.id, { content: [block] });
    await getDb().prepare('UPDATE docs_pages SET locked = 1 WHERE id = ?').run(page.id);
    const { claimSource, runSync } = await import('@/lib/docs-sync');
    await claimSource(source.id, new Date(), true);
    const res = await runSync(source.id);
    expect(res?.status).toBe('error');
    expect(res?.error).toBe('page_locked');
  });
});

describe('D4 QA: API y MCP', () => {
  it('PATCH sin campos responde missing_fields', async () => {
    const owner = await makeUser('api-mf');
    const actor = (await docsActorFor(owner.id, owner.id))!;
    const page = await createPage(actor, { title: 'X' });
    await expect(updatePage(actor, page.id, {})).rejects.toMatchObject({ code: 'missing_fields' });
    const res = await handleDocsRpc({ actor, scopes: ['docs:write'] }, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'update_page', arguments: { pageId: page.id } } });
    expect(JSON.stringify(res?.result)).toContain('missing_fields');
    expect(DocsPlatformError).toBeTruthy();
  });

  it('quien salió del workspace no actúa en él', async () => {
    const owner = await makeUser('gone-o');
    const gone = await makeUser('gone-x');
    expect(await docsActorFor(owner.id, gone.id)).toBeNull();
  });
});
