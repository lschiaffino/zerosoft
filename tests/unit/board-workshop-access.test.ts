import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBoard, getGuestBoard, listBoards } from '@/lib/boards';
import {
  accessAtLeast,
  boardAudience,
  boardViewer,
  getBoardAccess,
  personCanViewBoard,
  resolveBoardAccess,
  setBoardAccessMode,
  setBoardGuestLink,
  setBoardMember,
} from '@/lib/board-access';
import {
  applyTimer,
  canVote,
  castVote,
  closeVoting,
  getVoting,
  nextTimer,
  startVoting,
  tallyVotes,
  timerView,
} from '@/lib/board-workshop';
import { boardIssueDescription, createIssuesFromStickies, listBoardTrackCards } from '@/lib/board-track';
import { createProject } from '@/lib/track-data';
import { addMember, createTeam } from '@/lib/teams';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; actingUser?: { id: string }; role?: 'owner' | 'admin' | 'member'; team?: { id: string } | null },
}));
vi.mock('@/lib/session', () => ({ getCurrentUser: async () => session.user }));

const boardRoute = await import('@/lib/routes/boards/[id]/route');
const sceneRoute = await import('@/lib/routes/boards/[id]/scene/route');
const accessRoute = await import('@/lib/routes/boards/[id]/access/route');
const workshopRoute = await import('@/lib/routes/boards/[id]/workshop/route');
const embedRoute = await import('@/lib/routes/boards/[id]/embed/route');
const guestSceneRoute = await import('@/lib/routes/boards/guest/[token]/scene/route');
const guestRoute = await import('@/lib/routes/boards/guest/[token]/route');

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const tctx = (token: string) => ({ params: Promise.resolve({ token }) });
function jsonReq(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never;
}

/** Workspace con un team: dueño + dos miembros. */
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

beforeEach(() => {
  session.user = null;
});

describe('board-access: regla pura', () => {
  it('workspace: todos editan; quien la creó y los admins gestionan', () => {
    const board = { access: 'workspace', created_by: 'c' };
    expect(resolveBoardAccess(board, { personId: 'c', isAdmin: false }, null)).toBe('manage');
    expect(resolveBoardAccess(board, { personId: 'x', isAdmin: true }, null)).toBe('manage');
    expect(resolveBoardAccess(board, { personId: 'x', isAdmin: false }, null)).toBe('edit');
  });

  it('restricted: solo invitados con su rol', () => {
    const board = { access: 'restricted', created_by: 'c' };
    expect(resolveBoardAccess(board, { personId: 'x', isAdmin: false }, null)).toBeNull();
    expect(resolveBoardAccess(board, { personId: 'x', isAdmin: false }, 'view')).toBe('view');
    expect(resolveBoardAccess(board, { personId: 'x', isAdmin: false }, 'edit')).toBe('edit');
    expect(resolveBoardAccess(board, { personId: 'c', isAdmin: false }, null)).toBe('manage');
  });

  it('accessAtLeast y boardViewer', () => {
    expect(accessAtLeast('manage', 'edit')).toBe(true);
    expect(accessAtLeast('view', 'edit')).toBe(false);
    expect(accessAtLeast(null, 'view')).toBe(false);
    expect(boardViewer({ id: 'ws' })).toEqual({ workspaceId: 'ws', personId: 'ws', isAdmin: true });
    expect(boardViewer({ id: 'ws', actingUser: { id: 'p' }, role: 'member' }).isAdmin).toBe(false);
    expect(boardViewer({ id: 'ws', actingUser: { id: 'p' }, role: 'admin' }).isAdmin).toBe(true);
  });
});

describe('board-access: pizarras restringidas', () => {
  it('lista, abre, edita y menciona solo quien tiene acceso', async () => {
    const ws = await workspace('ra');
    const board = await createBoard(ws.owner.id, ws.a.id, 'Privada');
    expect(await setBoardAccessMode(ws.owner.id, board.id, 'restricted')).toBe(true);
    const va = boardViewer(as(ws, ws.a));
    const vb = boardViewer(as(ws, ws.b));
    expect((await listBoards(ws.owner.id, va)).map((x) => x.id)).toContain(board.id);
    expect((await listBoards(ws.owner.id, vb)).map((x) => x.id)).not.toContain(board.id);
    // El dueño del workspace (admin) la ve igual.
    expect(await getBoardAccess(boardViewer(as(ws, ws.owner)), board.id)).toBe('manage');

    session.user = as(ws, ws.b);
    expect((await boardRoute.GET(jsonReq('http://x', 'GET'), ctx(board.id))).status).toBe(404);

    // Invitada para ver: abre, pero no guarda la escena.
    expect(await setBoardMember(ws.owner.id, board.id, ws.b.id, 'view', ws.a.id)).toBe('ok');
    const opened = await boardRoute.GET(jsonReq('http://x', 'GET'), ctx(board.id));
    expect(opened.status).toBe(200);
    expect((await opened.json()).my_access).toBe('view');
    const put = await sceneRoute.PUT(jsonReq('http://x', 'PUT', { version: 1, scene: { elements: [], appState: {}, files: {} } }), ctx(board.id));
    expect(put.status).toBe(403);
    expect((await boardAudience(ws.owner.id, board.id)).map((m) => m.id).sort()).toEqual([ws.owner.id, ws.a.id, ws.b.id].sort());

    // Con rol de edición, guarda.
    await setBoardMember(ws.owner.id, board.id, ws.b.id, 'edit', ws.a.id);
    const put2 = await sceneRoute.PUT(jsonReq('http://x', 'PUT', { version: 1, scene: { elements: [], appState: {}, files: {} } }), ctx(board.id));
    expect(put2.status).toBe(200);

    // Sacarla corta el acceso; alguien de afuera del workspace no se puede invitar.
    await setBoardMember(ws.owner.id, board.id, ws.b.id, null, ws.a.id);
    expect(await getBoardAccess(vb, board.id)).toBeNull();
    const stranger = await makeUser('rastr');
    expect(await setBoardMember(ws.owner.id, board.id, stranger.id, 'edit', ws.a.id)).toBe('not_member');
  });

  it('PATCH /access: solo quien gestiona; GET no le muestra candidatos ni link a quien no gestiona', async () => {
    const ws = await workspace('rb');
    const board = await createBoard(ws.owner.id, ws.a.id, 'Taller');
    session.user = as(ws, ws.b);
    const denied = await accessRoute.PATCH(jsonReq('http://x', 'PATCH', { mode: 'restricted' }), ctx(board.id));
    expect(denied.status).toBe(403);
    const info = await (await accessRoute.GET(jsonReq('http://x', 'GET'), ctx(board.id))).json();
    expect(info).toMatchObject({ mode: 'workspace', level: 'edit', candidates: [], guest_token: null });

    session.user = as(ws, ws.a);
    const res = await accessRoute.PATCH(jsonReq('http://x', 'PATCH', { mode: 'restricted', member: { userId: ws.b.id, role: 'view' }, guest: true }), ctx(board.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe('restricted');
    expect(body.members.map((m: { id: string; role: string }) => [m.id, m.role])).toEqual([[ws.b.id, 'view']]);
    expect(typeof body.guest_token).toBe('string');
  });

  it('bloque /board de Docs: la vista previa solo para quien ve la pizarra', async () => {
    const ws = await workspace('rc');
    const board = await createBoard(ws.owner.id, ws.a.id, 'Embebida');
    expect(await personCanViewBoard(ws.b.id, board.id)).toBe(true);
    await setBoardAccessMode(ws.owner.id, board.id, 'restricted');
    expect(await personCanViewBoard(ws.b.id, board.id)).toBe(false);
    expect(await personCanViewBoard(ws.owner.id, board.id)).toBe(true);
    const outsider = await makeUser('rcout');
    expect(await personCanViewBoard(outsider.id, board.id)).toBe(false);

    session.user = as(ws, ws.b);
    expect((await embedRoute.GET(jsonReq('http://x', 'GET'), ctx(board.id))).status).toBe(404);
    session.user = as(ws, ws.a);
    const ok = await embedRoute.GET(jsonReq('http://x', 'GET'), ctx(board.id));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ id: board.id, name: 'Embebida' });
    session.user = null;
    expect((await embedRoute.GET(jsonReq('http://x', 'GET'), ctx(board.id))).status).toBe(401);
  });
});

describe('board-access: link de invitado con edición', () => {
  it('el invitado guarda sin sesión hasta que se apaga el link', async () => {
    const ws = await workspace('rg');
    const board = await createBoard(ws.owner.id, ws.a.id, 'Con invitados');
    const token = await setBoardGuestLink(ws.owner.id, board.id, true);
    expect(typeof token).toBe('string');
    expect(await setBoardGuestLink(ws.owner.id, board.id, true)).toBe(token);
    const guest = await getGuestBoard(token as string);
    expect(guest?.board.id).toBe(board.id);
    expect(guest?.board.share_token).toBeNull();

    const fetched = await guestRoute.GET(jsonReq('http://x', 'GET'), tctx(token as string));
    expect((await fetched.json()).my_access).toBe('edit');
    const scene = { elements: [{ id: 'g1', type: 'rectangle', x: 0, y: 0, width: 5, height: 5 }], appState: {}, files: {} };
    const put = await guestSceneRoute.PUT(jsonReq('http://x', 'PUT', { version: 1, scene }), tctx(token as string));
    expect(put.status).toBe(200);
    expect((await getGuestBoard(token as string))?.board.scene.elements).toHaveLength(1);

    expect(await setBoardGuestLink(ws.owner.id, board.id, false)).toBeNull();
    expect(await getGuestBoard(token as string)).toBeNull();
    const after = await guestSceneRoute.PUT(jsonReq('http://x', 'PUT', { version: 2, scene }), tctx(token as string));
    expect(after.status).toBe(404);
  });
});

describe('board-workshop: timer compartido', () => {
  const t0 = Date.parse('2026-10-21T10:00:00Z');
  const empty = { timer_ends_at: null, timer_seconds: null, timer_paused_left: null };

  it('arranca, pausa, sigue, suma tiempo y termina', () => {
    const started = nextTimer(empty, { action: 'start', seconds: 300 }, t0);
    expect(timerView(started, t0 + 60_000)).toMatchObject({ status: 'running', total: 300, remaining_ms: 240_000 });
    const paused = nextTimer(started, { action: 'pause' }, t0 + 60_000);
    expect(timerView(paused, t0 + 999_999)).toMatchObject({ status: 'paused', remaining_ms: 240_000 });
    const resumed = nextTimer(paused, { action: 'resume' }, t0 + 120_000);
    expect(timerView(resumed, t0 + 120_000).remaining_ms).toBe(240_000);
    const plus = nextTimer(resumed, { action: 'add', seconds: 60 }, t0 + 120_000);
    expect(timerView(plus, t0 + 120_000).remaining_ms).toBe(300_000);
    expect(timerView(plus, t0 + 120_000 + 301_000).status).toBe('done');
    expect(timerView(nextTimer(plus, { action: 'stop' }, t0), t0).status).toBe('idle');
    // Pausar algo que no corre no cambia nada.
    expect(nextTimer(empty, { action: 'pause' }, t0)).toEqual(empty);
  });

  it('se guarda en la pizarra y la ruta pide poder editar', async () => {
    const ws = await workspace('wt');
    const board = await createBoard(ws.owner.id, ws.a.id, 'Timer');
    const view = await applyTimer(ws.owner.id, board.id, { action: 'start', seconds: 120 });
    expect(view?.status).toBe('running');

    await setBoardAccessMode(ws.owner.id, board.id, 'restricted');
    await setBoardMember(ws.owner.id, board.id, ws.b.id, 'view', ws.a.id);
    session.user = as(ws, ws.b);
    const denied = await workshopRoute.POST(jsonReq('http://x', 'POST', { timer: { action: 'stop' } }), ctx(board.id));
    expect(denied.status).toBe(403);
    const state = await (await workshopRoute.GET(jsonReq('http://x', 'GET'), ctx(board.id))).json();
    expect(state.timer.status).toBe('running');
    expect(typeof state.now).toBe('number');
  });
});

describe('board-workshop: votación con puntos', () => {
  it('reglas puras', () => {
    expect(canVote({ a: 2 }, 'b', 1, 3)).toBe(true);
    expect(canVote({ a: 2, b: 1 }, 'c', 1, 3)).toBe(false);
    expect(canVote({}, 'a', -1, 3)).toBe(false);
    expect(canVote({ a: 1 }, 'a', -1, 3)).toBe(true);
    expect(tallyVotes([
      { element_id: 'x', count: 1 },
      { element_id: 'y', count: 2 },
      { element_id: 'x', count: 2 },
      { element_id: 'z', count: 0 },
    ])).toEqual([
      { element_id: 'x', count: 3 },
      { element_id: 'y', count: 2 },
    ]);
  });

  it('votos ocultos hasta cerrar, tope por persona y quien ve puede votar', async () => {
    const ws = await workspace('wv');
    const board = await createBoard(ws.owner.id, ws.a.id, 'Votos');
    await startVoting(ws.owner.id, board.id, ws.a.id, 2);
    expect(await castVote(board.id, ws.a.id, 's1', 1)).toBe('ok');
    expect(await castVote(board.id, ws.a.id, 's1', 1)).toBe('ok');
    expect(await castVote(board.id, ws.a.id, 's2', 1)).toBe('limit');
    expect(await castVote(board.id, ws.a.id, 's1', -1)).toBe('ok');

    await setBoardAccessMode(ws.owner.id, board.id, 'restricted');
    await setBoardMember(ws.owner.id, board.id, ws.b.id, 'view', ws.a.id);
    session.user = as(ws, ws.b);
    const voted = await workshopRoute.POST(jsonReq('http://x', 'POST', { vote: { action: 'vote', elementId: 's2', delta: 1 } }), ctx(board.id));
    expect(voted.status).toBe(200);
    const open = (await voted.json()).voting;
    expect(open).toMatchObject({ status: 'open', mine: { s2: 1 }, left: 1, voters: 2, results: null });
    const cannotClose = await workshopRoute.POST(jsonReq('http://x', 'POST', { vote: { action: 'close' } }), ctx(board.id));
    expect(cannotClose.status).toBe(403);

    expect(await closeVoting(board.id)).toBe(true);
    const closed = await getVoting(board.id, ws.b.id);
    expect(closed?.results).toEqual([
      { element_id: 's1', count: 1 },
      { element_id: 's2', count: 1 },
    ]);
    expect(await castVote(board.id, ws.b.id, 's1', 1)).toBe('closed');
    // Una votación nueva descarta la anterior.
    await startVoting(ws.owner.id, board.id, ws.a.id, 3);
    expect((await getVoting(board.id, ws.b.id))?.mine).toEqual({});
  });
});

describe('board-track: stickies → issues', () => {
  it('crea un issue por sticky con link a la pizarra y no duplica', async () => {
    const ws = await workspace('tk');
    const project = await createProject(ws.owner.id, ws.team.id, { name: 'Producto', color: '#5e6ad2' });
    const board = await createBoard(ws.owner.id, ws.a.id, 'Retro [Q3]');
    const res = await createIssuesFromStickies({
      workspaceId: ws.owner.id,
      teamId: ws.team.id,
      personId: ws.a.id,
      boardId: board.id,
      boardName: 'Retro [Q3]',
      projectId: project.id,
      items: [
        { elementId: 'e1', text: 'Arreglar login\nPasa en Safari' },
        { elementId: 'e2', text: 'Mejorar onboarding' },
      ],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.created.map((c) => c.title)).toEqual(['Arreglar login', 'Mejorar onboarding']);
    const again = await createIssuesFromStickies({
      workspaceId: ws.owner.id,
      teamId: ws.team.id,
      personId: ws.a.id,
      boardId: board.id,
      boardName: 'Retro',
      projectId: project.id,
      items: [{ elementId: 'e1', text: 'Otra vez' }],
    });
    expect(again.ok && again.created.length).toBe(0);
    expect(again.ok && again.skipped).toBe(1);
    const cards = await listBoardTrackCards(board.id);
    expect(cards.map((c) => c.element_id).sort()).toEqual(['e1', 'e2']);
    expect(cards[0].status_name).toBeTruthy();

    // Un proyecto de otro workspace no sirve.
    const other = await workspace('tk2');
    const foreign = await createProject(other.owner.id, other.team.id, { name: 'Ajeno', color: '#5e6ad2' });
    const denied = await createIssuesFromStickies({
      workspaceId: ws.owner.id,
      teamId: ws.team.id,
      personId: ws.a.id,
      boardId: board.id,
      boardName: 'Retro',
      projectId: foreign.id,
      items: [{ elementId: 'e3', text: 'x' }],
    });
    expect(denied).toEqual({ ok: false, code: 'project_not_found' });
  });

  it('la descripción lleva el texto y el link de vuelta', () => {
    expect(boardIssueDescription('Hacer X', 'b1', 'Retro [Q3]', 'Desde la pizarra')).toBe(
      'Hacer X\n\nDesde la pizarra: [Retro Q3](/app/board/b1)',
    );
  });
});
