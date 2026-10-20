import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanThumbnail,
  createBoard,
  deleteBoard,
  duplicateBoard,
  getBoard,
  getSharedBoard,
  listBoards,
  renameBoard,
  saveBoardScene,
  setBoardShared,
} from '@/lib/boards';
import { BOARD_MAX_SCENE_BYTES } from '@/lib/boards-types';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; actingUser?: { id: string } },
}));
vi.mock('@/lib/session', () => ({ getCurrentUser: async () => session.user }));

const sceneRoute = await import('@/app/api/boards/[id]/scene/route');
const boardRoute = await import('@/app/api/boards/[id]/route');
const boardsRoute = await import('@/app/api/boards/route');

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
function jsonReq(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never;
}

const rect = (id: string) => ({ id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10 });

beforeEach(() => {
  session.user = null;
});

describe('boards: CRUD y aislamiento por workspace', () => {
  it('crear, renombrar, duplicar y borrar dentro del workspace', async () => {
    const owner = await makeUser('bo');
    const b = await createBoard(owner.id, owner.id, 'Roadmap');
    expect(b).toMatchObject({ name: 'Roadmap', version: 1, shared: false });
    expect(await renameBoard(owner.id, b.id, 'Q3 roadmap')).toBe(true);
    await saveBoardScene(owner.id, owner.id, b.id, { elements: [rect('r1')], appState: {}, files: {} }, 1);
    const copy = await duplicateBoard(owner.id, owner.id, b.id);
    expect(copy?.name).toBe('Q3 roadmap (copy)');
    expect(copy?.scene.elements).toHaveLength(1);
    expect((await listBoards(owner.id)).map((x) => x.name).sort()).toEqual(['Q3 roadmap', 'Q3 roadmap (copy)']);
    expect(await deleteBoard(owner.id, b.id)).toBe(true);
    expect(await getBoard(owner.id, b.id)).toBeNull();
  });

  it('renombrar marca updated_at y updated_by, no toca la versión y se puede volver al nombre anterior', async () => {
    const owner = await makeUser('bren');
    const mate = await makeUser('brenm');
    const b = await createBoard(owner.id, owner.id, 'A');
    const before = (await listBoards(owner.id)).find((x) => x.id === b.id)!.updated_at;
    await new Promise((r) => setTimeout(r, 5));
    session.user = { id: owner.id, email: owner.email, actingUser: { id: mate.id } };
    const r1 = await boardRoute.PATCH(jsonReq('http://x', 'PATCH', { name: ' B ' }), ctx(b.id));
    expect(r1.status).toBe(200);
    expect(await r1.json()).toMatchObject({ ok: true, name: 'B' });
    const after = (await listBoards(owner.id)).find((x) => x.id === b.id)!;
    expect(after.name).toBe('B');
    expect(after.updated_at > before).toBe(true);
    expect(after.updated_by).toBe('brenm');
    // A → B → A: el segundo rename también se guarda.
    const r2 = await boardRoute.PATCH(jsonReq('http://x', 'PATCH', { name: 'A' }), ctx(b.id));
    expect(r2.status).toBe(200);
    const board = await getBoard(owner.id, b.id);
    expect(board?.name).toBe('A');
    expect(board?.version).toBe(1);
  });

  it('otro workspace no ve ni edita; un miembro del team sí', async () => {
    const owner = await makeUser('ws1');
    const mate = await makeUser('mate');
    const stranger = await makeUser('ws2');
    const b = await createBoard(owner.id, owner.id, 'Team board');

    // Miembro actuando en el workspace del owner: user.id = owner, actingUser = mate.
    session.user = { id: owner.id, email: owner.email, actingUser: { id: mate.id } };
    const ok = await sceneRoute.PUT(
      jsonReq('http://x', 'PUT', { version: 1, scene: { elements: [rect('a')], appState: {}, files: {} } }),
      ctx(b.id),
    );
    expect(ok.status).toBe(200);
    expect((await listBoards(owner.id))[0].updated_by).toBe('mate');

    session.user = { id: stranger.id, email: stranger.email };
    expect((await boardRoute.GET(jsonReq('http://x', 'GET'), ctx(b.id))).status).toBe(404);
    expect((await boardRoute.DELETE(jsonReq('http://x', 'DELETE'), ctx(b.id))).status).toBe(404);
    const list = await (await boardsRoute.GET()).json();
    expect(list.boards.map((x: { id: string }) => x.id)).not.toContain(b.id);
    expect(await renameBoard(stranger.id, b.id, 'x')).toBe(false);
    expect(await setBoardShared(stranger.id, b.id, true)).toBe(false);
    const put = await sceneRoute.PUT(
      jsonReq('http://x', 'PUT', { version: 2, scene: { elements: [], appState: {}, files: {} } }),
      ctx(b.id),
    );
    expect(put.status).toBe(404);
  });
});

describe('boards: escena', () => {
  it('guarda solo el subset de appState', async () => {
    const u = await makeUser('as');
    const b = await createBoard(u.id, u.id, 'x');
    await saveBoardScene(
      u.id,
      u.id,
      b.id,
      { elements: [rect('a')], appState: { viewBackgroundColor: '#fff', zoom: { value: 3 }, collaborators: [] }, files: {} },
      1,
    );
    expect((await getBoard(u.id, b.id))?.scene.appState).toEqual({ viewBackgroundColor: '#fff' });
  });

  it('conflicto de versión: el segundo guardado sobre la misma base recibe 409', async () => {
    const u = await makeUser('cv');
    session.user = { id: u.id, email: u.email };
    const b = await createBoard(u.id, u.id, 'x');
    const body = (els: unknown[], version: number) =>
      jsonReq('http://x', 'PUT', { version, scene: { elements: els, appState: {}, files: {} } });
    const first = await sceneRoute.PUT(body([rect('a')], 1), ctx(b.id));
    expect(await first.json()).toMatchObject({ version: 2 });
    const stale = await sceneRoute.PUT(body([rect('b')], 1), ctx(b.id));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: 'conflict', version: 2 });
    // La escena guardada es la del primero (no se pisó).
    expect((await getBoard(u.id, b.id))?.scene.elements).toEqual([rect('a')]);
    const next = await sceneRoute.PUT(body([rect('c')], 2), ctx(b.id));
    expect(next.status).toBe(200);
  });

  it('tope de tamaño: 413 si la escena supera el límite', async () => {
    const u = await makeUser('big');
    session.user = { id: u.id, email: u.email };
    const b = await createBoard(u.id, u.id, 'x');
    const huge = 'data:image/png;base64,' + 'A'.repeat(BOARD_MAX_SCENE_BYTES);
    const res = await sceneRoute.PUT(
      jsonReq('http://x', 'PUT', {
        version: 1,
        scene: { elements: [], appState: {}, files: { f1: { id: 'f1', mimeType: 'image/png', dataURL: huge } } },
      }),
      ctx(b.id),
    );
    expect(res.status).toBe(413);
    // Justo por debajo del slack del body pero por encima del tope de escena: también 413.
    const almost = 'A'.repeat(BOARD_MAX_SCENE_BYTES - 1000);
    const lib = await saveBoardScene(u.id, u.id, b.id, { elements: [], appState: {}, files: { f: { dataURL: almost + 'X'.repeat(2000) } } }, 1);
    expect(lib).toMatchObject({ ok: false, code: 'too_large' });
    expect((await getBoard(u.id, b.id))?.version).toBe(1);
  });

  it('miniatura: acepta SVG chico, rechaza scripts', () => {
    expect(cleanThumbnail('<svg xmlns="http://www.w3.org/2000/svg"></svg>')).toContain('<svg');
    expect(cleanThumbnail('<svg><script>alert(1)</script></svg>')).toBeNull();
    expect(cleanThumbnail('<svg onload="x()"></svg>')).toBeNull();
    expect(cleanThumbnail('<img src=x>')).toBeNull();
  });
});

describe('boards: link público', () => {
  it('activa, lee por token y desactiva', async () => {
    const u = await makeUser('bs');
    const b = await createBoard(u.id, u.id, 'Shared');
    const token = (await setBoardShared(u.id, b.id, true)) as string;
    expect(token).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(await setBoardShared(u.id, b.id, true)).toBe(token); // idempotente
    expect((await getSharedBoard(token))?.name).toBe('Shared');
    await setBoardShared(u.id, b.id, false);
    expect(await getSharedBoard(token)).toBeNull();
  });
});
