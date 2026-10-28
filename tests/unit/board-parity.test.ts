import { beforeEach, describe, expect, it, vi } from 'vitest';
import { backfillSearchText, createBoard, getBoard, getGuestBoard, getSharedBoard, listBoards, listTrash, purgeExpiredTrash, saveBoardScene, searchBoards, sceneSearchText, setBoardShared, snippet } from '@/lib/boards';
import { boardViewer, getBoardAccess, setBoardAccessMode, setBoardGuestLink, setBoardMember } from '@/lib/board-access';
import { createBoardFolder, deleteBoardFolder, listBoardFolders } from '@/lib/board-folders';
import {
  BOARD_LIVE_MAX_BYTES,
  actorKey,
  bindSocket,
  boardEventsSince,
  fetchEventsSince,
  cleanElements,
  cleanPresence,
  flushPresence,
  guestLiveActor,
  handleLiveSend,
  liveAllowed,
  liveConnectionFilter,
  memberLiveActor,
  presenceSnapshot,
  presenceWrites,
  pruneBoardEvents,
  publishBoardEvent,
  stillAllowed,
  subscribePresence,
  takeTokens,
} from '@/lib/board-live';
import { listBoardAudit, boardAuditCsv, csvCell } from '@/lib/board-audit';
import { parseExcalidrawFile, readExcalidrawFile, sanitizeElements } from '@/lib/board-import';
import { apiCreateBoard } from '@/lib/board-platform';
import { GENERATED_HTML_CSP, cleanHtml, cleanMermaid, fakeClusters, fakeDiagram, normalizeClusters } from '@/lib/board-ai';
import { markReceived, newSocketId, prunePeers, takeChanged, toCollaborator, uniquePeople, visibleBounds, type Peer } from '@/lib/board-collab';
import { nextSlide, orderFrames, slideKey } from '@/lib/board-present';
import { buildImagePdf, jpegSize } from '@/lib/pdf-images';
import { clusterLayout } from '@/lib/board-cluster';
import { getDb } from '@/lib/db';
import { addMember, createTeam, removeMember } from '@/lib/teams';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; actingUser?: { id: string }; role?: 'owner' | 'admin' | 'member' },
}));
vi.mock('@/lib/session', () => ({ getCurrentUser: async () => session.user }));

const boardRoute = await import('@/lib/routes/boards/[id]/route');
const trashRoute = await import('@/lib/routes/boards/[id]/trash/route');
const boardsRoute = await import('@/app/api/boards/route');
const liveRoute = await import('@/app/api/boards/live/route');
const importRoute = await import('@/app/api/boards/import/route');
const auditRoute = await import('@/app/api/boards/audit/route');
const aiRoute = await import('@/lib/routes/boards/[id]/ai/route');
const foldersRoute = await import('@/app/api/boards/folders/route');
const folderRoute = await import('@/lib/routes/boards/folders/[folderId]/route');

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
function req(url: string, method = 'GET', body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  }) as never;
}

async function workspace(label: string) {
  const owner = await makeUser(`${label}o`);
  const a = await makeUser(`${label}a`);
  const b = await makeUser(`${label}b`);
  const team = await createTeam(owner.id, `T ${label}`);
  await addMember(team.id, a.id, 'member');
  await addMember(team.id, b.id, 'member');
  return { owner, a, b, team };
}
const as = (ws: { owner: { id: string; email: string } }, person: { id: string; email: string }) => ({
  id: ws.owner.id,
  email: ws.owner.email,
  actingUser: person.id === ws.owner.id ? undefined : { id: person.id },
  role: person.id === ws.owner.id ? ('owner' as const) : ('member' as const),
});

const sticky = (id: string, text: string, x = 0, y = 0) => [
  { id, type: 'rectangle', x, y, width: 200, height: 150, version: 1, boundElements: [{ type: 'text', id: `${id}-t` }], customData: { sticky: true } },
  { id: `${id}-t`, type: 'text', x: x + 10, y: y + 10, width: 100, height: 20, text, originalText: text, containerId: id, version: 1 },
];

beforeEach(() => {
  session.user = null;
});

describe('board: papelera', () => {
  it('borrar manda a la papelera: no se ve, los links no andan, se restaura y se borra para siempre', async () => {
    const ws = await workspace('tr');
    const b = await createBoard(ws.owner.id, ws.a.id, 'Plan');
    const share = await setBoardShared(ws.owner.id, b.id, true);
    const guest = await setBoardGuestLink(ws.owner.id, b.id, true);
    session.user = as(ws, ws.a);
    expect((await boardRoute.DELETE(req('http://x', 'DELETE'), ctx(b.id))).status).toBe(204);
    expect(await getBoard(ws.owner.id, b.id)).toBeNull();
    expect((await listBoards(ws.owner.id)).map((x) => x.id)).not.toContain(b.id);
    expect(await getSharedBoard(share as string)).toBeNull();
    expect(await getGuestBoard(guest as string)).toBeNull();
    expect(await getBoardAccess(boardViewer(as(ws, ws.b)), b.id)).toBeNull();
    // En la papelera de cualquiera del workspace (era del workspace).
    const trash = await (await boardsRoute.GET(req('http://x/api/boards?trash=1'))).json();
    expect(trash.boards.map((x: { id: string }) => x.id)).toContain(b.id);
    // Restaurar vuelve todo, links incluidos.
    expect((await trashRoute.POST(req('http://x', 'POST'), ctx(b.id))).status).toBe(200);
    expect((await getSharedBoard(share as string))?.id).toBe(b.id);
    // Borrar para siempre solo desde la papelera.
    expect((await trashRoute.DELETE(req('http://x', 'DELETE'), ctx(b.id))).status).toBe(404);
    await boardRoute.DELETE(req('http://x', 'DELETE'), ctx(b.id));
    // Borrar para siempre es del owner y los admins: un miembro no puede.
    expect((await trashRoute.DELETE(req('http://x', 'DELETE'), ctx(b.id))).status).toBe(403);
    session.user = as(ws, ws.owner);
    expect((await trashRoute.DELETE(req('http://x', 'DELETE'), ctx(b.id))).status).toBe(204);
    expect((await getDb().prepare('SELECT 1 AS x FROM boards WHERE id = ?').get(b.id)) ?? null).toBeNull();
    const audit = (await listBoardAudit(ws.owner.id)).map((e) => e.action);
    expect(audit).toEqual(expect.arrayContaining(['board.trashed', 'board.restored', 'board.purged']));
  });

  it('una restringida en la papelera solo la ve y restaura quien la gestiona; otro workspace nunca', async () => {
    const ws = await workspace('trr');
    const other = await makeUser('trrx');
    const b = await createBoard(ws.owner.id, ws.a.id, 'Secret');
    await setBoardAccessMode(ws.owner.id, b.id, 'restricted');
    await setBoardMember(ws.owner.id, b.id, ws.b.id, 'edit', ws.a.id);
    session.user = as(ws, ws.a);
    await boardRoute.DELETE(req('http://x', 'DELETE'), ctx(b.id));
    expect((await listTrash(ws.owner.id, boardViewer(as(ws, ws.b)))).map((x) => x.id)).toContain(b.id);
    session.user = as(ws, ws.b);
    expect((await trashRoute.POST(req('http://x', 'POST'), ctx(b.id))).status).toBe(403);
    session.user = { id: other.id, email: other.email };
    expect((await trashRoute.POST(req('http://x', 'POST'), ctx(b.id))).status).toBe(404);
    session.user = as(ws, ws.a);
    expect((await trashRoute.POST(req('http://x', 'POST'), ctx(b.id))).status).toBe(200);
  });

  it('la poda borra lo que lleva más de 30 días', async () => {
    const u = await makeUser('trp');
    const b = await createBoard(u.id, u.id, 'Old');
    await getDb().prepare('UPDATE boards SET deleted_at = ? WHERE id = ?').run(new Date(Date.now() - 31 * 86400_000).toISOString(), b.id);
    expect(await purgeExpiredTrash()).toBeGreaterThanOrEqual(1);
    expect(await getDb().prepare('SELECT 1 AS x FROM boards WHERE id = ?').get(b.id)).toBeUndefined();
  });
});

describe('board: carpetas y búsqueda por contenido', () => {
  it('carpetas: crear, mover, contar y borrar sin borrar las pizarras', async () => {
    const u = await makeUser('fo');
    session.user = { id: u.id, email: u.email };
    const res = await foldersRoute.POST(req('http://x', 'POST', { name: ' Discovery ' }));
    expect(res.status).toBe(201);
    const folder = await res.json();
    const b = await createBoard(u.id, u.id, 'In folder');
    expect((await boardRoute.PATCH(req('http://x', 'PATCH', { folderId: folder.id }), ctx(b.id))).status).toBe(200);
    expect((await boardRoute.PATCH(req('http://x', 'PATCH', { folderId: 'nope' }), ctx(b.id))).status).toBe(400);
    const viewer = boardViewer({ id: u.id });
    expect((await listBoardFolders(u.id, viewer))[0]).toMatchObject({ name: 'Discovery', count: 1 });
    expect((await listBoards(u.id, viewer)).find((x) => x.id === b.id)?.folder_id).toBe(folder.id);
    // Otro workspace no mueve a una carpeta ajena.
    const other = await makeUser('fox');
    const ob = await createBoard(other.id, other.id, 'X');
    session.user = { id: other.id, email: other.email };
    expect((await boardRoute.PATCH(req('http://x', 'PATCH', { folderId: folder.id }), ctx(ob.id))).status).toBe(400);
    expect(await deleteBoardFolder(other.id, folder.id)).toBe(false);
    expect(await deleteBoardFolder(u.id, folder.id)).toBe(true);
    expect((await getBoard(u.id, b.id))?.folder_id).toBeNull();
    const created = await createBoardFolder(u.id, u.id, 'Again');
    expect(created.ok).toBe(true);
  });

  it('busca dentro del contenido (stickies, textos, frames) con la línea que coincidió', async () => {
    const u = await makeUser('se');
    const b = await createBoard(u.id, u.id, 'Workshop');
    await saveBoardScene(u.id, u.id, b.id, { elements: [...sticky('s1', 'Pricing page is confusing'), { id: 'f', type: 'frame', name: 'Onboarding slide', x: 0, y: 0, width: 10, height: 10 }], appState: {}, files: {} }, 1);
    const viewer = boardViewer({ id: u.id });
    const hits = await searchBoards(u.id, viewer, 'pricing');
    expect(hits[0]).toMatchObject({ id: b.id, match: 'Pricing page is confusing' });
    expect((await searchBoards(u.id, viewer, 'onboarding'))[0]?.id).toBe(b.id);
    expect(await searchBoards(u.id, viewer, '100%_')).toEqual([]);
    expect((await searchBoards(u.id, viewer, 'workshop'))[0].match).toBeUndefined();
    expect(sceneSearchText([{ type: 'text', text: 'a  b\nc' }, { type: 'text', text: 'x', isDeleted: true }])).toBe('a b c');
    expect(snippet('one\ntwo words here', 'WORDS')).toBe('two words here');
  });
});

describe('board: tiempo real (feed por pizarra y permisos por evento)', () => {
  it('quien solo ve manda cursor pero no elementos ni "traer a todos"; la identidad la pone el servidor', async () => {
    const ws = await workspace('lv');
    const b = await createBoard(ws.owner.id, ws.a.id, 'Live');
    await setBoardAccessMode(ws.owner.id, b.id, 'restricted');
    await setBoardMember(ws.owner.id, b.id, ws.b.id, 'view', ws.a.id);
    const viewerB = await memberLiveActor(as(ws, ws.b), b.id);
    expect(viewerB?.level).toBe('view');
    expect(await handleLiveSend(viewerB!, { socketId: 'sockB12345', presence: { pointer: { x: 1, y: 2, tool: 'pointer' } } })).toMatchObject({ ok: true });
    expect(await handleLiveSend(viewerB!, { socketId: 'sockB12345', elements: [{ id: 'e', type: 'rectangle' }] })).toMatchObject({ ok: false, status: 403 });
    expect(await handleLiveSend(viewerB!, { socketId: 'sockB12345', summon: true, presence: { bounds: [0, 0, 10, 10] } })).toMatchObject({ ok: false, status: 403 });
    const editorA = await memberLiveActor(as(ws, ws.a), b.id);
    const before = (await boardEventsSince(b.id, 0)).cursor;
    await handleLiveSend(editorA!, { socketId: 'sockA12345', elements: [{ id: 'e', type: 'rectangle', link: 'javascript:alert(1)' }], user: { name: 'Evil' } });
    const { events } = await boardEventsSince(b.id, before);
    expect(events).toHaveLength(1);
    expect(events[0].user).toMatchObject({ id: ws.a.id, guest: false });
    expect(events[0].user?.name).not.toBe('Evil');
    expect((events[0].payload.elements as Array<{ link: unknown }>)[0].link).toBeNull();
    // Quien no está invitado ni la ve.
    const stranger = await makeUser('lvx');
    expect(await memberLiveActor({ id: stranger.id }, b.id)).toBeNull();
  });

  it('cada conexión recibe solo su pizarra y se corta cuando pierde el acceso', async () => {
    const ws = await workspace('lc');
    const b1 = await createBoard(ws.owner.id, ws.a.id, 'One');
    const b2 = await createBoard(ws.owner.id, ws.a.id, 'Two');
    const actorB = await memberLiveActor(as(ws, ws.b), b1.id);
    let revoked = false;
    const filter = liveConnectionFilter(actorB!, () => (revoked = true));
    const raw = (boardId: string, kind = 'update') => ({ id: 1, boardId, workspaceId: ws.owner.id, socketId: 's', kind, user: null, payload: {}, at: '' }) as never;
    expect(await filter([raw(b1.id), raw(b2.id)])).toHaveLength(1);
    await setBoardAccessMode(ws.owner.id, b1.id, 'restricted');
    expect(await filter([raw(b1.id, 'access')])).toEqual([]);
    expect(revoked).toBe(true);
  });

  it('invitado del link: entra con el token vigente, deja de entrar al apagarlo; GET/POST de la ruta', async () => {
    const u = await makeUser('lg');
    const b = await createBoard(u.id, u.id, 'Guest live');
    const token = (await setBoardGuestLink(u.id, b.id, true)) as string;
    expect((await guestLiveActor(token))?.boardId).toBe(b.id);
    const post = await liveRoute.POST(req(`http://x/api/boards/live?guest=${token}`, 'POST', { socketId: 'guest12345', presence: { pointer: { x: 0, y: 0 } } }));
    expect(post.status).toBe(200);
    expect(((await post.json()) as { socketId: string }).socketId).toMatch(/^[a-f0-9]{10}-guest12345$/);
    const poll = await liveRoute.GET(req(`http://x/api/boards/live?guest=${token}&poll=1&cursor=1`));
    expect(poll.status).toBe(200);
    expect(((await poll.json()) as { events: Array<{ user: { guest: boolean } }> }).events.some((e) => e.user.guest)).toBe(true);
    await setBoardGuestLink(u.id, b.id, false);
    expect(await guestLiveActor(token)).toBeNull();
    expect((await liveRoute.GET(req(`http://x/api/boards/live?guest=${token}&poll=1`))).status).toBe(404);
    // Sin sesión y sin token: nada.
    expect((await liveRoute.GET(req(`http://x/api/boards/live?board=${b.id}&poll=1`))).status).toBe(401);
  });

  it('valida lo que llega y poda lo viejo', async () => {
    expect(cleanElements([{ id: 'a' }])).toBeNull();
    expect(cleanElements([])).toBeNull();
    expect(cleanPresence({ pointer: { x: Infinity, y: 1 }, bounds: [0, 0, -1, 5], selected: ['a', 3] })).toEqual({ selected: ['a'] });
    expect(takeTokens('k', 1, 1, 2, 0)).toBe(true);
    expect(takeTokens('k', 1, 1, 2, 0)).toBe(true);
    expect(takeTokens('k', 1, 1, 2, 0)).toBe(false);
    expect(takeTokens('k', 1, 1, 2, 1000)).toBe(true);
    await publishBoardEvent({ boardId: 'b', workspaceId: 'w', socketId: 'server', kind: 'access' });
    await getDb().prepare("UPDATE board_events SET created_at = '2000-01-01T00:00:00.000Z' WHERE board_id = 'b'").run();
    expect(await pruneBoardEvents()).toBeGreaterThanOrEqual(1);
  });
});

describe('board: arreglos del QA (abuso, suplantación, revalidación, presencia efímera)', () => {
  it('un invitado no puede inundar el feed: tope por actor e IP, 32 KB por evento y bytes por minuto', async () => {
    const u = await makeUser('fl');
    const b = await createBoard(u.id, u.id, 'Flood');
    const token = (await setBoardGuestLink(u.id, b.id, true)) as string;
    const guest = (await guestLiveActor(token))!;
    // Una pestaña: ~40 de golpe. Cambiando de pestaña en cada pedido: el tope del link (10×).
    let same = 0;
    for (let i = 0; i < 100; i++) if (liveAllowed(guest, 'samesock01', '9.9.9.9', 5_000_000)) same++;
    expect(same).toBeLessThanOrEqual(40);
    let rotating = 0;
    for (let i = 0; i < 1000; i++) if (liveAllowed(guest, `rot${String(i).padStart(7, '0')}`, `10.0.${i % 250}.1`, 5_000_000)) rotating++;
    expect(rotating).toBeLessThanOrEqual(400);
    // Una persona con sesión no cuenta por IP: una oficina detrás de la misma IP no se traba.
    const own = (await memberLiveActor({ id: u.id }, b.id))!;
    expect(liveAllowed(own, 'x0000001', '9.9.9.9', 5_000_000)).toBe(true);
    // Un evento de más de 32 KB no entra (lo lleva el guardado).
    const big = [{ id: 'big', type: 'freedraw', points: Array.from({ length: 4000 }, (_, i) => [i, i]) }];
    expect(JSON.stringify(big).length).toBeGreaterThan(BOARD_LIVE_MAX_BYTES);
    expect(await handleLiveSend(guest, { socketId: 'flood00001', elements: big }, 6_000_000)).toMatchObject({ ok: false, status: 413 });
    // Bytes por minuto: tras ~512 KB seguidos, corta con 429.
    const chunk = [{ id: 'c', type: 'freedraw', points: Array.from({ length: 1500 }, (_, i) => [i, i]) }];
    let codes: number[] = [];
    for (let i = 0; i < 40; i++) {
      const r = await handleLiveSend(guest, { socketId: 'flood00001', elements: chunk }, 7_000_000);
      codes = [...codes, r.ok ? 200 : r.status];
    }
    expect(codes).toContain(429);
    const rows = (await getDb().prepare('SELECT COALESCE(SUM(LENGTH(payload)), 0) AS n FROM board_events WHERE board_id = ?').get(b.id)) as { n: number };
    expect(Number(rows.n)).toBeLessThan(700 * 1024);
  });

  it('el id de pestaña queda atado a quien lo usa: otro no puede hablar, irse ni moverse en su nombre', async () => {
    const ws = await workspace('sp');
    const b = await createBoard(ws.owner.id, ws.a.id, 'Spoof');
    const a = (await memberLiveActor(as(ws, ws.a), b.id))!;
    const m = (await memberLiveActor(as(ws, ws.b), b.id))!;
    const seen: Array<{ kind: string; socketId: string }> = [];
    const off = subscribePresence(b.id, (evs) => seen.push(...evs.map((e) => ({ kind: e.kind, socketId: e.socketId }))));
    const ra = await handleLiveSend(a, { socketId: 'victim0001', presence: { bounds: [0, 0, 10, 10] } });
    const rm = await handleLiveSend(m, { socketId: 'victim0001', presence: { bounds: [500, 500, 600, 600] } });
    expect(ra.ok && rm.ok).toBe(true);
    const sa = (ra as { socketId: string }).socketId;
    const sm = (rm as { socketId: string }).socketId;
    expect(sa).not.toBe(sm);
    expect(sa).toBe(bindSocket(actorKey(a), 'victim0001'));
    // "Irse" con el id de otro solo saca la pestaña propia.
    await handleLiveSend(m, { socketId: 'victim0001', leave: true });
    expect(seen.filter((e) => e.kind === 'leave').map((e) => e.socketId)).toEqual([sm]);
    expect(presenceSnapshot(b.id).map((e) => e.socketId)).toEqual([sa]);
    off();
  });

  it('la presencia no va a board_events y se escribe coalescida (una fila por pizarra e instancia)', async () => {
    const u = await makeUser('pr');
    const b = await createBoard(u.id, u.id, 'Presence');
    const actor = (await memberLiveActor({ id: u.id }, b.id))!;
    const before = (await getDb().prepare('SELECT COUNT(*) AS n FROM board_events WHERE board_id = ?').get(b.id)) as { n: number };
    for (let i = 0; i < 50; i++) await handleLiveSend(actor, { socketId: `tab${i % 5}abcdef`, presence: { pointer: { x: i, y: i, tool: 'pointer' } } });
    await flushPresence();
    const after = (await getDb().prepare('SELECT COUNT(*) AS n FROM board_events WHERE board_id = ?').get(b.id)) as { n: number };
    expect(Number(after.n)).toBe(Number(before.n));
    // 50 movimientos de 5 pestañas: una fila, escrita una vez (o dos si justo pasó el ciclo de 250 ms).
    const rows = (await getDb().prepare('SELECT COUNT(*) AS n, MAX(seq) AS seq FROM board_presence WHERE board_id = ?').get(b.id)) as { n: number; seq: number };
    expect(Number(rows.n)).toBe(1);
    expect(Number(rows.seq)).toBeLessThanOrEqual(2);
    expect(presenceSnapshot(b.id)).toHaveLength(5);
    expect(presenceWrites()).toBeGreaterThan(0);
  });

  it('una conexión abierta se revalida desde la base: sacar a alguien del team la corta', async () => {
    const ws = await workspace('rv');
    const b = await createBoard(ws.owner.id, ws.owner.id, 'Reval');
    const actor = (await memberLiveActor(as(ws, ws.b), b.id))!;
    expect(await stillAllowed(actor)).toBe(true);
    let revoked = false;
    const filter = liveConnectionFilter(actor, () => (revoked = true));
    const cursor = Number(((await getDb().prepare('SELECT MAX(id) AS id FROM board_events').get()) as { id: number | null }).id ?? 0);
    // Sacarla del team publica un aviso para todo el workspace y la conexión se corta ya.
    await removeMember(ws.team.id, ws.b.id);
    const events = await fetchEventsSince(cursor);
    expect(events.some((e) => e.boardId === '*' && e.kind === 'access')).toBe(true);
    expect(await filter(events)).toEqual([]);
    expect(revoked).toBe(true);
    expect(await stillAllowed(actor)).toBe(false);
  });

  it('el cron llena el texto buscable de las pizarras de antes (con claim por fila)', async () => {
    const u = await makeUser('bf');
    const b = await createBoard(u.id, u.id, 'Vieja');
    const scene = JSON.stringify({ elements: [{ id: 't', type: 'text', text: 'Pendiente viejo', originalText: 'Pendiente viejo' }], appState: {}, files: {} });
    await getDb().prepare("UPDATE boards SET scene = ?, search_text = '', search_indexed = 0 WHERE id = ?").run(scene, b.id);
    expect(await backfillSearchText({ limit: 500 })).toBeGreaterThanOrEqual(1);
    const row = (await getDb().prepare('SELECT search_text, search_indexed FROM boards WHERE id = ?').get(b.id)) as { search_text: string; search_indexed: number };
    expect(row).toEqual({ search_text: 'Pendiente viejo', search_indexed: 1 });
    expect((await searchBoards(u.id, boardViewer({ id: u.id }), 'pendiente'))[0]?.id).toBe(b.id);
  });

  it('el cursor del atraso es de la pizarra, no del feed entero', async () => {
    const u = await makeUser('cu');
    const b1 = await createBoard(u.id, u.id, 'C1');
    const b2 = await createBoard(u.id, u.id, 'C2');
    await publishBoardEvent({ boardId: b1.id, workspaceId: u.id, socketId: 'server', kind: 'access' });
    const c1 = (await boardEventsSince(b1.id, 0)).cursor;
    await publishBoardEvent({ boardId: b2.id, workspaceId: u.id, socketId: 'server', kind: 'access' });
    expect((await boardEventsSince(b1.id, 0)).cursor).toBe(c1);
  });

  it('links con tabs o entidades, HTML de IA y CSP; carpetas ajenas y carpetas inventadas por la API', async () => {
    expect(sanitizeElements([{ link: 'java\tscript:alert(1)' }])[0].link).toBeNull();
    expect(sanitizeElements([{ link: '&#106;avascript:alert(1)' }])[0].link).toBeNull();
    expect(sanitizeElements([{ link: '%6Aavascript:x' }])[0].link).toBeNull();
    expect(sanitizeElements([{ link: 'https://ok.example/a b' }])[0].link).toBe('https://ok.example/a b');
    const gen = sanitizeElements([{ id: 'i', type: 'iframe', customData: { generationData: { status: 'done', html: '<script>x</script>' }, keep: 1 } }]);
    expect(gen).toEqual([]);
    const gen2 = sanitizeElements([{ id: 'm', type: 'magicframe', customData: { generationData: { html: 'x' }, keep: 2 } }]);
    expect(gen2[0].customData).toEqual({ keep: 2 });
    expect(cleanHtml('<!DOCTYPE html><html><head><title>x</title></head><body></body></html>')).toContain(`<head><meta http-equiv="Content-Security-Policy" content="${GENERATED_HTML_CSP}">`);
    expect(GENERATED_HTML_CSP).toContain("default-src 'none'");

    const ws = await workspace('fp');
    session.user = as(ws, ws.a);
    const folder = await (await foldersRoute.POST(req('http://x', 'POST', { name: 'De A' }))).json();
    session.user = as(ws, ws.b);
    expect((await folderRoute.PATCH!(req('http://x', 'PATCH', { name: 'x' }), { params: Promise.resolve({ folderId: folder.id }) })).status).toBe(403);
    expect((await folderRoute.DELETE!(req('http://x', 'DELETE'), { params: Promise.resolve({ folderId: folder.id }) })).status).toBe(403);
    session.user = as(ws, ws.owner);
    expect((await folderRoute.PATCH!(req('http://x', 'PATCH', { name: 'Del owner' }), { params: Promise.resolve({ folderId: folder.id }) })).status).toBe(200);

    const before = (await listBoards(ws.owner.id)).length;
    await expect(apiCreateBoard({ ws: ws.owner.id, personId: ws.owner.id, role: 'owner', via: 'api' }, { name: 'x', folderId: 'nope' })).rejects.toThrow();
    expect((await listBoards(ws.owner.id)).length).toBe(before);
  });

  it('frames de presentación sin magicframes, import con demasiados elementos y título del PDF', async () => {
    expect(orderFrames([{ id: 'm', type: 'magicframe', x: 0, y: 0, width: 10, height: 10 }, { id: 'f', type: 'frame', x: 0, y: 0, width: 10, height: 10 }]).map((f) => (f as { id: string }).id)).toEqual(['f']);
    expect(readExcalidrawFile({ type: 'excalidraw', elements: Array.from({ length: 50_001 }, (_, i) => ({ id: `e${i}`, type: 'rectangle' })) })).toEqual({ ok: false, error: 'too_many_elements' });
    const pdf = new TextDecoder('latin1').decode(buildImagePdf([], `${'a'.repeat(119)}(`));
    expect(pdf).toContain(`/Title (${'a'.repeat(119)}\\()`);
  });
});

describe('board: importar .excalidraw', () => {
  it('lee el formato, saca links peligrosos y rechaza bibliotecas; la ruta crea la pizarra', async () => {
    const file = { type: 'excalidraw', version: 2, elements: [{ id: 'a', type: 'rectangle', link: ' javascript:x' }, { id: 'd', type: 'text', isDeleted: true }], appState: { viewBackgroundColor: '#fff' }, files: { f1: { dataURL: 'https://evil/x.png' } } };
    const scene = parseExcalidrawFile(JSON.stringify(file))!;
    expect(scene.elements).toHaveLength(1);
    expect((scene.elements[0] as { link: unknown }).link).toBeNull();
    expect(scene.files).toEqual({});
    expect(parseExcalidrawFile({ type: 'excalidrawlib', libraryItems: [] })).toBeNull();
    expect(parseExcalidrawFile('nope')).toBeNull();
    expect(sanitizeElements([{ link: 'https://ok' }])[0].link).toBe('https://ok');

    const u = await makeUser('im');
    session.user = { id: u.id, email: u.email };
    const res = await importRoute.POST(req('http://x', 'POST', { name: 'Old flow.excalidraw', file: JSON.stringify(file) }));
    expect(res.status).toBe(201);
    const board = await res.json();
    expect(board.name).toBe('Old flow');
    expect((await getBoard(u.id, board.id))?.scene.elements).toHaveLength(1);
    expect((await importRoute.POST(req('http://x', 'POST', { name: 'x', file: '{"type":"excalidrawlib"}' }))).status).toBe(400);
  });
});

describe('board: audit log y IA', () => {
  it('el registro es solo para owner y admins, con CSV sin fórmulas', async () => {
    const ws = await workspace('au');
    session.user = as(ws, ws.a);
    expect((await auditRoute.GET(req('http://x/api/boards/audit'))).status).toBe(403);
    session.user = as(ws, ws.owner);
    const res = await auditRoute.GET(req('http://x/api/boards/audit?format=csv'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(csvCell('=SUM(A1)')).toBe(`"'=SUM(A1)"`);
    expect(boardAuditCsv([]).startsWith('created_at')).toBe(true);
  });

  it('IA apagada: 503 ai_disabled; sin permiso de edición: 403', async () => {
    const ws = await workspace('ai');
    const b = await createBoard(ws.owner.id, ws.a.id, 'AI');
    await setBoardAccessMode(ws.owner.id, b.id, 'restricted');
    await setBoardMember(ws.owner.id, b.id, ws.b.id, 'view', ws.a.id);
    session.user = as(ws, ws.b);
    expect((await aiRoute.POST(req('http://x', 'POST', { kind: 'diagram', prompt: 'login flow' }), ctx(b.id))).status).toBe(403);
    session.user = as(ws, ws.a);
    const prev = process.env.AI_ENABLED;
    process.env.AI_ENABLED = 'false';
    const res = await aiRoute.POST(req('http://x', 'POST', { kind: 'diagram', prompt: 'login flow' }), ctx(b.id));
    process.env.AI_ENABLED = prev;
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'ai_disabled' });
  });

  it('limpia la salida del modelo y normaliza los grupos', () => {
    expect(cleanMermaid('Here:\n```mermaid\nflowchart TD\nA-->B\n```')).toBe('flowchart TD\nA-->B');
    expect(cleanMermaid('no diagram')).toBeNull();
    expect(fakeDiagram('sign up, verify email, then dashboard')).toContain('N1 --> N2');
    expect(cleanHtml('```html\n<!DOCTYPE html><html></html>\n```')).toMatch(/^<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy"/);
    expect(cleanHtml('just text')).toBeNull();
    const notes = [
      { id: 'a', text: 'Price high' },
      { id: 'b', text: 'Price unclear' },
      { id: 'c', text: 'Slow app' },
    ];
    expect(fakeClusters(notes).groups).toHaveLength(2);
    const norm = normalizeClusters({ groups: [{ title: 'Pricing', ids: ['a', 'a', 'zzz'] }], summary: ' ok ' }, notes, 'Other');
    expect(norm).toEqual({ groups: [{ title: 'Pricing', ids: ['a'] }, { title: 'Other', ids: ['b', 'c'] }], summary: 'ok' });
  });
});

describe('board: lógica pura del cliente', () => {
  it('manda solo lo que cambió y no devuelve lo recibido', () => {
    const sent = new Map<string, number>();
    markReceived([{ id: 'a', version: 2 }], sent);
    expect(takeChanged([{ id: 'a', version: 2 }, { id: 'b', version: 1 }], sent).map((e) => e.id)).toEqual(['b']);
    expect(takeChanged([{ id: 'a', version: 3, isDeleted: true }], sent).map((e) => e.id)).toEqual(['a']);
    expect(takeChanged([{ id: 'a', version: 3 }], sent)).toEqual([]);
  });

  it('presencia: vence, cuenta personas una vez y arma el colaborador de Excalidraw', () => {
    const peers = new Map<string, Peer>([
      ['s1', { socketId: 's1', user: { id: 'u1', name: 'Ana', guest: false }, lastSeen: 0, selected: ['x'] }],
      ['s2', { socketId: 's2', user: { id: 'u1', name: 'Ana', guest: false }, lastSeen: 50_000 }],
      ['s3', { socketId: 's3', user: { id: null, name: null, guest: true }, lastSeen: 50_000, idle: true }],
    ]);
    expect(uniquePeople(peers.values())).toHaveLength(2);
    expect(toCollaborator(peers.get('s1')!, 'Guest')).toMatchObject({ username: 'Ana', selectedElementIds: { x: true }, userState: 'active' });
    expect(toCollaborator(peers.get('s3')!, 'Guest')).toMatchObject({ username: 'Guest', userState: 'away' });
    expect(prunePeers(peers, 40_000)).toBe(true);
    expect([...peers.keys()]).toEqual(['s2', 's3']);
    expect(newSocketId()).toMatch(/^[A-Za-z0-9]{20}$/);
    expect(visibleBounds({ scrollX: -100, scrollY: -50, width: 800, height: 600, zoom: { value: 2 } })).toEqual([100, 50, 500, 350]);
  });

  it('presentación: frames en orden de lectura y teclas', () => {
    const f = (id: string, x: number, y: number) => ({ id, type: 'frame', x, y, width: 100, height: 80 });
    expect(orderFrames([f('c', 0, 200), f('b', 150, 5), f('a', 0, 0), { id: 'r', type: 'rectangle', x: 0, y: 0, width: 1, height: 1 }]).map((e) => (e as { id: string }).id)).toEqual(['a', 'b', 'c']);
    expect(slideKey('ArrowRight')).toBe('next');
    expect(slideKey('Escape')).toBe('exit');
    expect(slideKey('x')).toBeNull();
    expect(nextSlide(0, 3, 'prev')).toBe(0);
    expect(nextSlide(2, 3, 'next')).toBe(2);
    expect(nextSlide(1, 3, 'last')).toBe(2);
  });

  it('PDF de imágenes: una página por imagen, xref válida', () => {
    // JPEG mínimo con un SOF0 de 4×2.
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x04, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xd9]);
    expect(jpegSize(jpeg)).toEqual({ width: 4, height: 2 });
    expect(jpegSize(new Uint8Array([1, 2, 3]))).toBeNull();
    const pdf = new TextDecoder('latin1').decode(buildImagePdf([{ jpeg, width: 4, height: 2 }, { jpeg, width: 4, height: 2 }], 'Deck (v2)'));
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('/Count 2');
    expect(pdf).toContain('/Title (Deck \\(v2\\))');
    const xrefAt = Number(pdf.match(/startxref\n(\d+)/)![1]);
    expect(pdf.slice(xrefAt, xrefAt + 4)).toBe('xref');
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('agrupar: una columna por tema, sin pisarse', () => {
    const boxes = ['a', 'b', 'c'].map((id, i) => ({ id, x: i * 10, y: 100, width: 200, height: 150 }));
    const l = clusterLayout([{ title: 'One', ids: ['a', 'b', 'c'] }, { title: 'Two', ids: [] }], boxes);
    expect(l.headers).toHaveLength(1);
    expect(l.moves.get('a')).toEqual({ x: 0, y: 156 });
    expect(l.moves.get('b')!.x).toBe(224);
    expect(l.moves.get('c')).toEqual({ x: 0, y: 330 });
  });
});

describe('board: API REST y MCP', async () => {
  const v1List = await import('@/app/api/v1/boards/route');
  const v1Board = await import('@/lib/routes/v1/boards/[id]/route');
  const v1Elements = await import('@/lib/routes/v1/boards/[id]/elements/route');
  const mcp = await import('@/app/api/v1/boards/mcp/route');
  const { createApiKey } = await import('@/lib/api-auth');
  const bearer = (url: string, key: string, method = 'GET', body?: unknown) =>
    new Request(url, { method, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }) as never;

  it('la key actúa como su persona: crea, suma stickies y flechas, lee el resumen y no ve restringidas ajenas', async () => {
    const ws = await workspace('api');
    const { key } = await createApiKey(ws.owner.id, 'k', ws.b.id, ['boards:read', 'boards:write']);
    const created = await v1List.POST(bearer('http://x/api/v1/boards', key, 'POST', { name: 'API board', template: 'kanban' }));
    expect(created.status).toBe(201);
    const id = (await created.json()).data.id as string;
    const add = await v1Elements.POST!(
      bearer('http://x', key, 'POST', { stickies: [{ text: 'From the API', color: 'green' }], elements: [{ kind: 'ellipse', text: 'A' }, { kind: 'rectangle', text: 'B' }], connect: [{ from: 1, to: 2 }] }),
      ctx(id),
    );
    expect(add.status).toBe(201);
    expect((await add.json()).data.added.map((e: { type: string }) => e.type)).toEqual(expect.arrayContaining(['rectangle', 'ellipse', 'arrow']));
    const got = await (await v1Board.GET!(bearer('http://x', key), ctx(id))).json();
    expect(got.data.outline.stickies.some((s: { text: string }) => s.text === 'From the API')).toBe(true);
    const found = await (await v1List.GET(bearer('http://x/api/v1/boards?q=from%20the%20api', key))).json();
    expect(found.data[0]).toMatchObject({ id, match: 'From the API' });
    // Restringida de otra persona: 404 (no se confirma que exista).
    const secret = await createBoard(ws.owner.id, ws.a.id, 'Secret');
    await setBoardAccessMode(ws.owner.id, secret.id, 'restricted');
    expect((await v1Board.GET!(bearer('http://x', key), ctx(secret.id))).status).toBe(404);
    // Solo lectura: no escribe.
    const ro = (await createApiKey(ws.owner.id, 'ro', ws.b.id, ['boards:read'])).key;
    expect((await v1Board.PATCH!(bearer('http://x', ro, 'PATCH', { name: 'x' }), ctx(id))).status).toBe(403);
    expect((await v1Board.DELETE!(bearer('http://x', key, 'DELETE'), ctx(id))).status).toBe(204);
    expect((await v1Board.GET!(bearer('http://x', key), ctx(id))).status).toBe(404);
    expect((await listBoardAudit(ws.owner.id)).some((e) => e.via === 'api' && e.action === 'board.created')).toBe(true);
  });

  it('MCP: tools/list y tools/call con el scope de cada herramienta', async () => {
    const u = await makeUser('mcp');
    const { key } = await createApiKey(u.id, 'm', u.id, ['boards:read']);
    const call = async (body: unknown) => (await mcp.POST(bearer('http://x', key, 'POST', body))).json();
    const list = await call({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(list.result.tools.map((t: { name: string }) => t.name)).toContain('add_stickies');
    const denied = await call({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'create_board', arguments: { name: 'x' } } });
    expect(denied.result.isError).toBe(true);
    const ok = await call({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_boards', arguments: {} } });
    expect(ok.result.isError).toBe(false);
  });
});
