import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb, type UserRow } from '@/lib/db';
import { addMember, createTeam } from '@/lib/teams';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createNumber, getNumberRowById, ingestEvents, listChats } from '@/lib/groups';
import { createBroadcast, getBroadcast } from '@/lib/groups-broadcasts';
import { exportAccountData } from '@/lib/privacy';
import { bufferSource, listZipEntries, readZipEntry } from '@/lib/zip-reader';
import { createIssue, createProject, getIssue } from '@/lib/track-data';
import { runAsTrackViewer, setProjectVisibility } from '@/lib/track-access';
import { listScopeTeams } from '@/lib/track-plans';
import { resolveTriage } from '@/lib/track-bulk';
import { createCustomerRequest } from '@/lib/track-customers';
import { trackUpdateNode } from '@/lib/flow-app-nodes';
import { createFolder } from '@/lib/link-folders';
import { createLink, linkCreators, userTags } from '@/lib/links';
import { getUserOverview } from '@/lib/track';
import { createApiKey } from '@/lib/api-auth';
import { createBoard } from '@/lib/boards';
import { makeUser } from './helpers';

/**
 * Privacidad entre personas del mismo workspace, segunda parte: los mismos
 * accesos (equipos de Track, carpetas de Link, líneas) por la API, los
 * resúmenes, Flow y el export.
 */

const v1Requests = await import('@/app/api/v1/track/requests/route');

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

async function workspace(label: string) {
  const owner = await makeUser(`${label}-owner`);
  const ana = await makeUser(`${label}-ana`);
  const beto = await makeUser(`${label}-beto`);
  const team = await createTeam(owner.id, 'Equipo');
  await addMember(team.id, ana.id, 'member');
  await addMember(team.id, beto.id, 'member');
  return { owner, ana, beto, team };
}

async function track(label: string) {
  const w = await workspace(label);
  const pub = await createProject(w.owner.id, w.team.id, { name: 'Abierto' });
  const priv = await createProject(w.owner.id, w.team.id, { name: 'Reservado' });
  await setProjectVisibility(priv.id, 'private', w.ana.id);
  const open = await createIssue(pub.id, w.ana.id, { title: 'Tarea abierta', priority: 'low', description: [] });
  const hidden = await createIssue(priv.id, w.ana.id, { title: 'Tema reservado', priority: 'low', description: [] });
  return { ...w, pub, priv, open, hidden };
}

describe('Track: los pedidos de clientes por la API siguen el acceso a equipos de quien creó la key', () => {
  it('leer y sumar pedidos de un equipo privado: solo quien lo ve', async () => {
    const w = await track('pp-requests');
    await createCustomerRequest(w.owner.id, w.hidden.id, { customerName: 'Cliente Inventado', customerEmail: 'cliente@example.com', body: 'pedido inventado' }, w.ana.id);
    const betoKey = (await createApiKey(w.owner.id, 'beto', w.beto.id)).key;
    const anaKey = (await createApiKey(w.owner.id, 'ana', w.ana.id)).key;
    const get = (key: string) => new Request(`http://x/api/v1/track/requests?issue=${w.hidden.id}`, { headers: { authorization: `Bearer ${key}` } });
    const post = (key: string, body: unknown) =>
      new Request('http://x/api/v1/track/requests', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });

    expect((await v1Requests.GET(get(betoKey))).status).toBe(404);
    const forAna = await v1Requests.GET(get(anaKey));
    expect(forAna.status).toBe(200);
    expect(JSON.stringify(await forAna.json())).toContain('Cliente Inventado');

    const body = { projectId: w.priv.id, title: 'Pedido nuevo', body: 'texto inventado', customer: { name: 'Otra Persona' } };
    expect((await v1Requests.POST(post(betoKey, body))).status).toBe(404);
    expect((await v1Requests.POST(post(betoKey, { ...body, issue: w.hidden.identifier }))).status).toBe(404);
    const count = async () => Number(((await getDb().prepare('SELECT COUNT(*) AS c FROM track_issues WHERE project_id = ?').get(w.priv.id)) as { c: number }).c);
    expect(await count()).toBe(1);
    expect((await v1Requests.POST(post(anaKey, body))).status).toBe(201);
    expect(await count()).toBe(2);
    // En un equipo abierto, cualquiera del workspace.
    expect((await v1Requests.POST(post(betoKey, { ...body, projectId: w.pub.id }))).status).toBe(201);
  });
});

describe('Track: planes, triage y Flow no nombran ni tocan equipos privados que la persona no ve', () => {
  it('los equipos para un plan son los que la persona ve', async () => {
    const w = await track('pp-plans');
    const scope = { teamId: w.team.id, ownerId: w.owner.id };
    const names = async (person: UserRow) => (await runAsTrackViewer(person.id, () => listScopeTeams(scope))).map((t) => t.name);
    expect(await names(w.beto)).toEqual(['Abierto']);
    expect((await names(w.ana)).sort()).toEqual(['Abierto', 'Reservado']);
  });

  it('marcar un duplicado en triage: el original tiene que ser de un equipo visible', async () => {
    const w = await track('pp-triage');
    await getDb().prepare('UPDATE track_issues SET triage = 1 WHERE id = ?').run(w.open.id);
    const inTriage = (await getIssue(w.open.id))!;
    const asBeto = await runAsTrackViewer(w.beto.id, () => resolveTriage(inTriage, { action: 'duplicate', duplicateOfId: w.hidden.id } as never, w.beto.id));
    expect(asBeto).toEqual({ ok: false, reason: 'invalid_duplicate' });
    const relations = (await getDb().prepare('SELECT COUNT(*) AS c FROM track_issue_relations WHERE issue_id = ? OR related_issue_id = ?').get(w.open.id, w.open.id)) as { c: number };
    expect(Number(relations.c)).toBe(0);
    expect(((await getIssue(w.open.id))!).triage).toBe(1);
  });

  it('un flow cambia issues de un equipo privado solo con el acceso de quien lo creó', async () => {
    const w = await track('pp-flow');
    const cfg = { issue: w.hidden.identifier, comment: 'comentario inventado' };
    await expect(trackUpdateNode(w.owner.id, w.beto.id, cfg, {})).rejects.toThrow('issue_not_found');
    const comments = async () => Number(((await getDb().prepare('SELECT COUNT(*) AS c FROM track_issue_comments WHERE issue_id = ?').get(w.hidden.id)) as { c: number }).c);
    expect(await comments()).toBe(0);
    const ok = await trackUpdateNode(w.owner.id, w.ana.id, cfg, {});
    expect(ok.issue.id).toBe(w.hidden.id);
    expect(await comments()).toBe(1);
    // Los equipos abiertos siguen igual.
    expect((await trackUpdateNode(w.owner.id, w.beto.id, { issue: w.open.identifier, comment: 'otro comentario' }, {})).issue.id).toBe(w.open.id);
  });
});

describe('Link: el resumen y los filtros siguen el acceso por carpeta', () => {
  it('links, etiquetas y autores de una carpeta sin acceso no aparecen', async () => {
    const w = await workspace('pp-links');
    const folder = await createFolder(w.owner.id, { name: 'Dirección', defaultAccess: 'none' });
    if (!folder.ok) throw new Error(folder.code);
    const hidden = await createLink(w.owner.id, { url: 'https://example.com/reservado', folderId: folder.folder.id, createdBy: w.owner.id, tags: ['directorio'] });
    const open = await createLink(w.owner.id, { url: 'https://example.com/abierto', createdBy: w.ana.id, tags: ['equipo'] });
    if (!hidden.ok || !open.ok) throw new Error('link');
    const member = { id: w.beto.id, admin: false };
    const admin = { id: w.owner.id, admin: true };

    const forMember = await getUserOverview(w.owner.id, member);
    expect(forMember.activeLinks).toBe(1);
    expect(forMember.recent.map((l) => l.id)).toEqual([open.link.id]);
    expect(forMember.topLinks.map((l) => l.id)).toEqual([open.link.id]);
    const forAdmin = await getUserOverview(w.owner.id, admin);
    expect(forAdmin.activeLinks).toBe(2);
    expect(forAdmin.recent.map((l) => l.id).sort()).toEqual([open.link.id, hidden.link.id].sort());

    expect(await userTags(w.owner.id, member)).toEqual(['equipo']);
    expect(await userTags(w.owner.id, admin)).toEqual(['directorio', 'equipo']);
    expect((await linkCreators(w.owner.id, member)).map((c) => c.id)).toEqual([w.ana.id]);
    expect((await linkCreators(w.owner.id, admin)).map((c) => c.id).sort()).toEqual([w.ana.id, w.owner.id].sort());
  });
});

describe('Lines: el detalle de un envío respeta los teléfonos ocultos', () => {
  it('un chat sin nombre se muestra enmascarado a quien no ve los teléfonos', async () => {
    const w = await workspace('pp-lines');
    const n = await createNumber(w.owner.id, w.owner.id, { provider: 'fake', name: 'Línea' });
    await connectNumber(w.owner.id, n.id);
    const fake = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
    if (fake) fake.connectedAt = Date.now() - 5000;
    await ingestEvents((await getNumberRowById(n.id))!, [
      { type: 'message', chatId: '120363000000000002@g.us', isGroup: true, fromMe: false, senderPhone: '5490000000002', senderName: 'Alguien', providerMessageId: 'm-1', body: 'texto de prueba' },
    ]);
    const chat = (await listChats(w.owner.id, w.owner.id)).rows[0];
    await getDb().prepare("UPDATE groups_chats SET name = '', phone = '5490000000002' WHERE id = ?").run(chat.id);
    const b = await createBroadcast(w.owner.id, w.owner.id, { chatIds: [chat.id], body: 'aviso inventado', scheduledAt: new Date(Date.now() + 86_400_000).toISOString() });

    const plain = await getBroadcast(w.owner.id, b.id);
    expect(plain?.recipients[0].chatName).toBe('+5490000000002');
    const masked = await getBroadcast(w.owner.id, b.id, { mask: true });
    expect(masked?.recipients[0].chatName).not.toContain('5490000000002');
    expect(masked?.recipients[0].chatName).not.toContain('00000000');
  });
});

describe('Export de datos: sigue lo que la persona ve en la app', () => {
  it('el audit log de un equipo privado y las notas privadas de una pizarra de otra persona no salen', async () => {
    const w = await track('pp-export');
    const ws = w.team.id;
    const log = getDb().prepare(
      "INSERT INTO track_audit_log (id, workspace_id, actor_id, via, action, entity_type, entity_id, entity_label, project_id, data) VALUES (?, ?, ?, 'app', 'issue.created', 'issue', ?, ?, ?, '{}')",
    );
    await log.run(crypto.randomUUID(), ws, w.ana.id, w.hidden.id, 'Registro reservado', w.priv.id);
    await log.run(crypto.randomUUID(), ws, w.ana.id, w.open.id, 'Registro abierto', w.pub.id);
    const board = await createBoard(w.owner.id, w.owner.id, 'Pizarra');
    const draft = getDb().prepare('INSERT INTO board_private_drafts (board_id, author, elements, updated_at) VALUES (?, ?, ?, ?)');
    await draft.run(board.id, w.ana.id, JSON.stringify([{ id: 'e1', type: 'rectangle', text: 'borrador de Ana' }]), new Date().toISOString());
    await draft.run(board.id, w.owner.id, JSON.stringify([{ id: 'e2', type: 'rectangle', text: 'borrador propio' }]), new Date().toISOString());

    const exp = await exportAccountData(w.owner);
    const all = await Promise.all((await listZipEntries(bufferSource(exp.zip))).map(async (e) => (await readZipEntry(bufferSource(exp.zip), e, 5e6)).toString('utf8')));
    const text = all.join('\n');
    expect(text).toContain('Registro abierto');
    expect(text).not.toContain('Registro reservado');
    expect(text).toContain('borrador propio');
    expect(text).not.toContain('borrador de Ana');
  });
});
