import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { createBoard, deleteBoard, duplicateBoard, getBoard, getSharedBoard, restoreSnapshotAsCopy, saveBoardScene, setBoardShared } from '@/lib/boards';
import { boardFileHref, parseBoardFileHref, parseDataUrl, retargetFiles, swapUploadedFiles, withShareToken } from '@/lib/board-file-refs';
import { externalizeSceneFiles, getBoardFile } from '@/lib/board-files';
import { SNAPSHOT_EVERY_MS, listSnapshots, maybeSnapshot } from '@/lib/board-history';
import { BOARD_TEMPLATES, buildTemplateScene, templatePreview, wrap } from '@/lib/board-templates';
import { getBoardLibrary, saveBoardLibrary } from '@/lib/board-library';
import { isAllowedLibraryUrl } from '@/lib/boards-types';
import { sceneToView, viewToScene } from '@/lib/board-view';
import { makeUser } from './helpers';

// Storage en memoria: lo que "sube" saveUpload se lee de acá (fs/promises.readFile).
const storage = vi.hoisted(() => ({ files: new Map<string, Buffer>(), deleted: [] as string[], uploads: 0 }));

vi.mock('@/lib/uploads', async (orig) => ({
  ...(await orig<typeof import('@/lib/uploads')>()),
  saveUpload: async (folder: string, filename: string, _type: string, buffer: Buffer) => {
    storage.uploads += 1;
    const url = `/uploads/${folder}/${crypto.randomUUID()}-${filename}`;
    storage.files.set(url, buffer);
    return url;
  },
  deleteUploads: async (urls: string[]) => {
    storage.deleted.push(...urls);
  },
}));

vi.mock('fs/promises', async (orig) => {
  const real = await orig<typeof import('fs/promises')>();
  const readFile = async (p: string, ...rest: unknown[]) => {
    const rel = String(p).split(`${path.sep}public`).pop() ?? '';
    const hit = storage.files.get(rel.split(path.sep).join('/'));
    if (hit) return hit;
    return (real.readFile as (...a: unknown[]) => Promise<Buffer>)(p, ...rest);
  };
  return { ...real, default: { ...real, readFile }, readFile };
});

const session = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; actingUser?: { id: string }; team?: null },
}));
vi.mock('@/lib/session', () => ({ getCurrentUser: async () => session.user }));

const fileRoute = await import('@/app/api/boards/[id]/files/[fileId]/route');
const uploadRoute = await import('@/app/api/boards/[id]/files/route');
const boardsRoute = await import('@/app/api/boards/route');
const historyRoute = await import('@/app/api/boards/[id]/history/route');
const restoreRoute = await import('@/app/api/boards/[id]/history/[snapshotId]/route');
const commentsRoute = await import('@/app/api/boards/[id]/comments/route');
const threadRoute = await import('@/app/api/boards/[id]/comments/[threadId]/route');
const commentRoute = await import('@/app/api/boards/[id]/comments/[threadId]/[commentId]/route');
const libraryRoute = await import('@/app/api/boards/library/route');
const { resolveMentions } = await import('@/lib/board-comments');
const { filterMembers, insertMention, mentionQuery } = await import('@/lib/board-mentions');

function req(url: string, method = 'GET', body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never;
}
const { NextRequest } = await import('next/server');
const nreq = (url: string) => new NextRequest(url) as never;

const PNG = 'data:image/png;base64,' + Buffer.from('fake-png-bytes').toString('base64');
const image = (id: string, fileId: string) => ({ id, type: 'image', x: 0, y: 0, width: 10, height: 10, fileId });
const rect = (id: string) => ({ id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10 });

beforeEach(() => {
  session.user = null;
});

describe('board: imágenes fuera de la escena', () => {
  it('helpers de referencias: parse, retarget, token y swap', () => {
    expect(parseDataUrl(PNG)).toMatchObject({ mime: 'image/png' });
    expect(parseDataUrl('data:image/png,notbase64')).toBeNull();
    const href = boardFileHref('b1', 'f1');
    expect(parseBoardFileHref(href)).toEqual({ boardId: 'b1', fileId: 'f1' });
    expect(parseBoardFileHref(`${href}?t=abc`)).toEqual({ boardId: 'b1', fileId: 'f1' });
    expect(parseBoardFileHref('https://evil.example/api/boards/b1/files/f1')).toBeNull();
    const files = { f1: { id: 'f1', dataURL: href }, f2: { id: 'f2', dataURL: PNG } };
    expect((retargetFiles(files, 'b2').f1 as { dataURL: string }).dataURL).toBe(boardFileHref('b2', 'f1'));
    expect((withShareToken(files, 'b1', 'tok').f1 as { dataURL: string }).dataURL).toBe(`${href}?t=tok`);
    const swapped = swapUploadedFiles(files, new Map([['f2', '/api/boards/b1/files/f2']]));
    expect((swapped.f2 as { dataURL: string }).dataURL).toBe('/api/boards/b1/files/f2');
  });

  it('al guardar, el base64 va al storage y la escena queda con la URL propia (una sola subida por imagen)', async () => {
    const u = await makeUser('bf');
    const b = await createBoard(u.id, u.id, 'img');
    const before = storage.uploads;
    const scene = { elements: [image('i1', 'f1')], appState: {}, files: { f1: { id: 'f1', mimeType: 'image/png', dataURL: PNG } } };
    expect(await saveBoardScene(u.id, u.id, b.id, scene, 1)).toMatchObject({ ok: true });
    const saved = await getBoard(u.id, b.id);
    expect((saved!.scene.files.f1 as { dataURL: string }).dataURL).toBe(boardFileHref(b.id, 'f1'));
    expect(storage.uploads).toBe(before + 1);
    // Un cliente viejo que manda el mismo base64 de nuevo no vuelve a subirlo.
    await saveBoardScene(u.id, u.id, b.id, scene, 2);
    expect(storage.uploads).toBe(before + 1);
    const row = await getBoardFile(b.id, 'f1');
    expect(row?.url.startsWith('/uploads/boards/')).toBe(true);
    // Una escena vieja guardada en línea se migra recién en el próximo guardado.
    const legacy = await createBoard(u.id, u.id, 'legacy');
    await getDb()
      .prepare('UPDATE boards SET scene = ? WHERE id = ?')
      .run(JSON.stringify({ elements: [image('i', 'f9')], appState: {}, files: { f9: { id: 'f9', mimeType: 'image/png', dataURL: PNG } } }), legacy.id);
    expect(((await getBoard(u.id, legacy.id))!.scene.files.f9 as { dataURL: string }).dataURL).toBe(PNG);
    const fresh = await getBoard(u.id, legacy.id);
    await saveBoardScene(u.id, u.id, legacy.id, fresh!.scene, 1);
    expect(((await getBoard(u.id, legacy.id))!.scene.files.f9 as { dataURL: string }).dataURL).toBe(boardFileHref(legacy.id, 'f9'));
  });

  it('descarta URLs ajenas y copia la fila al pegar desde otra pizarra del mismo workspace', async () => {
    const u = await makeUser('bp');
    const other = await makeUser('bpo');
    const a = await createBoard(u.id, u.id, 'A');
    const b = await createBoard(u.id, u.id, 'B');
    const foreign = await createBoard(other.id, other.id, 'F');
    await externalizeSceneFiles(u.id, a.id, { f1: { id: 'f1', mimeType: 'image/png', dataURL: PNG } });
    await externalizeSceneFiles(other.id, foreign.id, { f2: { id: 'f2', mimeType: 'image/png', dataURL: PNG } });
    const out = await externalizeSceneFiles(u.id, b.id, {
      f1: { id: 'f1', dataURL: boardFileHref(a.id, 'f1') },
      f2: { id: 'f2', dataURL: boardFileHref(foreign.id, 'f2') },
      f3: { id: 'f3', dataURL: 'https://tracker.example/pixel.png' },
    });
    expect(Object.keys(out)).toEqual(['f1']);
    expect((out.f1 as { dataURL: string }).dataURL).toBe(boardFileHref(b.id, 'f1'));
    expect(await getBoardFile(b.id, 'f1')).toBeTruthy();
  });

  it('subida previa: POST /files devuelve la URL; SVG se rechaza', async () => {
    const u = await makeUser('bup');
    const b = await createBoard(u.id, u.id, 'up');
    session.user = { id: u.id, email: u.email };
    const ok = await uploadRoute.POST(req('http://x', 'POST', { id: 'fz', dataURL: PNG }), { params: Promise.resolve({ id: b.id }) });
    expect(ok.status).toBe(201);
    expect(await ok.json()).toEqual({ id: 'fz', url: boardFileHref(b.id, 'fz') });
    const svg = await uploadRoute.POST(
      req('http://x', 'POST', { id: 'fs', dataURL: 'data:image/svg+xml;base64,' + Buffer.from('<svg/>').toString('base64') }),
      { params: Promise.resolve({ id: b.id }) },
    );
    expect(svg.status).toBe(415);
  });

  it('servir: workspace sí, otro workspace no, link público solo con token vigente', async () => {
    const u = await makeUser('bsv');
    const stranger = await makeUser('bsvx');
    const b = await createBoard(u.id, u.id, 'serve');
    await saveBoardScene(u.id, u.id, b.id, { elements: [image('i', 'f1')], appState: {}, files: { f1: { id: 'f1', mimeType: 'image/png', dataURL: PNG } } }, 1);
    const params = { params: Promise.resolve({ id: b.id, fileId: 'f1' }) };
    session.user = { id: u.id, email: u.email };
    const own = await fileRoute.GET(nreq(`http://x${boardFileHref(b.id, 'f1')}`), params);
    expect(own.status).toBe(200);
    expect(own.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await own.arrayBuffer()).toString()).toBe('fake-png-bytes');
    session.user = { id: stranger.id, email: stranger.email };
    expect((await fileRoute.GET(nreq(`http://x${boardFileHref(b.id, 'f1')}`), params)).status).toBe(404);
    session.user = null;
    const token = (await setBoardShared(u.id, b.id, true)) as string;
    const shared = await getSharedBoard(token);
    const url = (shared!.scene.files.f1 as { dataURL: string }).dataURL;
    expect(url).toBe(boardFileHref(b.id, 'f1', token));
    expect((await fileRoute.GET(nreq(`http://x${url}`), params)).status).toBe(200);
    await setBoardShared(u.id, b.id, false);
    expect((await fileRoute.GET(nreq(`http://x${url}`), params)).status).toBe(404);
  });

  it('duplicar comparte el archivo; se borra del storage recién cuando ninguna pizarra lo usa', async () => {
    const u = await makeUser('bdel');
    const b = await createBoard(u.id, u.id, 'orig');
    await saveBoardScene(u.id, u.id, b.id, { elements: [image('i', 'f1')], appState: {}, files: { f1: { id: 'f1', mimeType: 'image/png', dataURL: PNG } } }, 1);
    const url = (await getBoardFile(b.id, 'f1'))!.url;
    const copy = await duplicateBoard(u.id, u.id, b.id);
    expect((copy!.scene.files.f1 as { dataURL: string }).dataURL).toBe(boardFileHref(copy!.id, 'f1'));
    expect((await getBoardFile(copy!.id, 'f1'))?.url).toBe(url);
    await deleteBoard(u.id, b.id);
    expect(storage.deleted).not.toContain(url);
    await deleteBoard(u.id, copy!.id);
    expect(storage.deleted).toContain(url);
  });
});

describe('board: historial', () => {
  it('una foto por hora como mucho, con el estado anterior al guardado', async () => {
    const u = await makeUser('bh');
    const b = await createBoard(u.id, u.id, 'hist');
    // Pizarra vacía: nada que guardar.
    expect(await maybeSnapshot(u.id, b.id)).toBe(false);
    await saveBoardScene(u.id, u.id, b.id, { elements: [rect('a')], appState: {}, files: {} }, 1);
    // Segundo guardado: foto de la escena con "a".
    await saveBoardScene(u.id, u.id, b.id, { elements: [rect('a'), rect('b')], appState: {}, files: {} }, 2);
    await saveBoardScene(u.id, u.id, b.id, { elements: [rect('c')], appState: {}, files: {} }, 3);
    let snaps = await listSnapshots(u.id, b.id);
    expect(snaps).toHaveLength(1);
    expect(snaps[0]).toMatchObject({ version: 2, element_count: 1 });
    // Una hora después, el próximo guardado saca otra.
    const later = new Date(Date.now() + SNAPSHOT_EVERY_MS + 1000);
    expect(await maybeSnapshot(u.id, b.id, later)).toBe(true);
    // Sin cambios desde la última foto: no repite.
    expect(await maybeSnapshot(u.id, b.id, new Date(later.getTime() + SNAPSHOT_EVERY_MS + 1000))).toBe(false);
    snaps = await listSnapshots(u.id, b.id);
    expect(snaps.map((s) => s.version)).toEqual([4, 2]);
  });

  it('restaurar como copia: pizarra nueva con esa versión, la original intacta', async () => {
    const u = await makeUser('bhr');
    const stranger = await makeUser('bhrx');
    const b = await createBoard(u.id, u.id, 'Plan');
    await saveBoardScene(u.id, u.id, b.id, { elements: [image('i', 'f1')], appState: {}, files: { f1: { id: 'f1', mimeType: 'image/png', dataURL: PNG } } }, 1);
    await saveBoardScene(u.id, u.id, b.id, { elements: [rect('z')], appState: {}, files: {} }, 2);
    session.user = { id: u.id, email: u.email };
    const list = await (await historyRoute.GET(req('http://x'), { params: Promise.resolve({ id: b.id }) })).json();
    expect(list.snapshots).toHaveLength(1);
    const snapId = list.snapshots[0].id as string;
    const res = await restoreRoute.POST(req('http://x', 'POST', { name: 'Plan (old)' }), { params: Promise.resolve({ id: b.id, snapshotId: snapId }) });
    expect(res.status).toBe(201);
    const copy = await res.json();
    expect(copy.name).toBe('Plan (old)');
    expect(copy.id).not.toBe(b.id);
    expect(copy.scene.elements).toHaveLength(1);
    expect(copy.scene.files.f1.dataURL).toBe(boardFileHref(copy.id, 'f1'));
    expect(await getBoardFile(copy.id, 'f1')).toBeTruthy();
    expect((await getBoard(u.id, b.id))!.scene.elements).toEqual([rect('z')]);
    expect(await restoreSnapshotAsCopy(stranger.id, stranger.id, b.id, snapId, 'x')).toBeNull();
    session.user = { id: stranger.id, email: stranger.email };
    expect((await historyRoute.GET(req('http://x'), { params: Promise.resolve({ id: b.id }) })).status).toBe(404);
  });
});

describe('board: plantillas', () => {
  const t = (k: string) => `[${k}]`;

  it('cada plantilla es una escena válida con textos traducidos y vínculos coherentes', () => {
    for (const key of BOARD_TEMPLATES) {
      let n = 0;
      const scene = buildTemplateScene(key, t, () => `${key}-${++n}`);
      const els = scene.elements as Array<Record<string, unknown> & { id: string; type: string }>;
      expect(els.length).toBeGreaterThan(5);
      const ids = new Set(els.map((e) => e.id));
      expect(ids.size).toBe(els.length);
      expect(els.some((e) => e.type === 'text' && String(e.originalText).startsWith(`[${key}.`))).toBe(true);
      for (const e of els) {
        if (e.containerId) {
          const box = els.find((x) => x.id === e.containerId)!;
          expect((box.boundElements as Array<{ id: string }>).some((x) => x.id === e.id)).toBe(true);
        }
        if (e.type === 'arrow') {
          for (const end of ['startBinding', 'endBinding'] as const) {
            const target = els.find((x) => x.id === (e[end] as { elementId: string }).elementId)!;
            expect((target.boundElements as Array<{ id: string }>).some((x) => x.id === e.id)).toBe(true);
          }
        }
      }
      expect(templatePreview(scene).shapes.length).toBeGreaterThan(0);
    }
  });

  it('wrap corta por palabras', () => {
    expect(wrap('who does what by when', 10)).toBe('who does\nwhat by\nwhen');
  });

  it('POST /api/boards con template crea la pizarra con la escena en el idioma pedido', async () => {
    const u = await makeUser('btpl');
    session.user = { id: u.id, email: u.email };
    const res = await boardsRoute.POST(req('http://x', 'POST', { name: 'Kanban', template: 'kanban', locale: 'es' }));
    expect(res.status).toBe(201);
    const board = await res.json();
    expect(board.name).toBe('Kanban');
    const texts = (board.scene.elements as Array<{ type: string; originalText?: string }>).filter((e) => e.type === 'text').map((e) => e.originalText);
    expect(texts).toContain('Por hacer');
    expect((await boardsRoute.POST(req('http://x', 'POST', { template: 'nope' }))).status).toBe(400);
  });
});

describe('board: comentarios', () => {
  it('menciones por nombre completo o email, sin falsos positivos', () => {
    const members = [
      { id: 'a', name: 'Ana', email: 'ana@x.com' },
      { id: 'ap', name: 'Ana Paula', email: 'ap@x.com' },
      { id: 'b', name: null, email: 'bob@x.com' },
    ];
    expect(resolveMentions('hola @Ana Paula, mirá esto', members)).toEqual(['ap']);
    expect(resolveMentions('@ana y @bob@x.com.', members).sort()).toEqual(['a', 'b']);
    expect(resolveMentions('mail ana@x.com sin arroba', members)).toEqual([]);
    expect(resolveMentions('@Anabel', members)).toEqual([]);
  });

  it('autocompletado: consulta, filtro e inserción', () => {
    expect(mentionQuery('hola @an', 8)).toEqual({ start: 5, query: 'an' });
    expect(mentionQuery('mail a@b', 8)).toBeNull();
    const members = [{ id: '1', name: 'Ana', email: 'ana@x.com' }, { id: '2', name: null, email: 'bob@x.com' }];
    expect(filterMembers(members, 'BO').map((m) => m.id)).toEqual(['2']);
    expect(insertMention('hola @an', 8, members[0])).toEqual({ value: 'hola @Ana ', caret: 10 });
  });

  it('hilo anclado: crear, responder, resolver, reabrir respondiendo, mover y borrar; avisos de mención y respuesta', async () => {
    const owner = await makeUser('bco');
    const mate = await makeUser('bcm');
    const stranger = await makeUser('bcx');
    const { createTeam, addMember } = await import('@/lib/teams');
    const team = await createTeam(owner.id, 'Team');
    await addMember(team.id, mate.id);
    await getDb().prepare('UPDATE users SET name = ? WHERE id = ?').run('Mate Person', mate.id);
    const b = await createBoard(owner.id, owner.id, 'Comments');
    const p = (extra: Record<string, string> = {}) => ({ params: Promise.resolve({ id: b.id, ...extra }) }) as never;

    session.user = { id: owner.id, email: owner.email };
    const created = await commentsRoute.POST(req('http://x', 'POST', { x: 120.5, y: -40, body: 'Revisá esto @Mate Person' }), p());
    expect(created.status).toBe(201);
    const thread = await created.json();
    expect(thread).toMatchObject({ x: 120.5, y: -40, resolved_at: null });
    expect(thread.comments[0].body_html).toContain('track-mention');
    const mention = (await getDb()
      .prepare("SELECT * FROM notifications WHERE user_id = ? AND source_type = 'board_comment'")
      .all(mate.id)) as Array<{ type: string; href: string }>;
    expect(mention).toHaveLength(1);
    expect(mention[0]).toMatchObject({ type: 'mention', href: `/app/board/${b.id}?comment=${thread.id}` });

    // El miembro responde: la autora recibe aviso de respuesta.
    session.user = { id: owner.id, email: owner.email, actingUser: { id: mate.id } };
    const reply = await threadRoute.POST(req('http://x', 'POST', { body: 'Listo' }), p({ threadId: thread.id }));
    expect((await reply.json()).comments).toHaveLength(2);
    const replied = (await getDb()
      .prepare("SELECT type FROM notifications WHERE user_id = ? AND source_type = 'board_comment'")
      .all(owner.id)) as Array<{ type: string }>;
    expect(replied.map((r) => r.type)).toEqual(['comment']);

    const resolved = await (await threadRoute.PATCH(req('http://x', 'PATCH', { resolved: true }), p({ threadId: thread.id }))).json();
    expect(resolved.resolved_at).toBeTruthy();
    expect(resolved.resolved_by_name).toBe('Mate Person');
    const moved = await (await threadRoute.PATCH(req('http://x', 'PATCH', { x: 1, y: 2 }), p({ threadId: thread.id }))).json();
    expect(moved).toMatchObject({ x: 1, y: 2 });
    session.user = { id: owner.id, email: owner.email };
    const reopened = await (await threadRoute.POST(req('http://x', 'POST', { body: 'Una más' }), p({ threadId: thread.id }))).json();
    expect(reopened.resolved_at).toBeNull();

    const list = await (await commentsRoute.GET(req('http://x'), p())).json();
    expect(list.threads).toHaveLength(1);
    expect(list.members.map((m: { id: string }) => m.id).sort()).toEqual([owner.id, mate.id].sort());

    // Solo la autora borra su comentario; al borrar todos se va el hilo.
    const [first, second, third] = reopened.comments as Array<{ id: string }>;
    expect((await commentRoute.DELETE(req('http://x', 'DELETE'), p({ threadId: thread.id, commentId: second.id }))).status).toBe(403);
    expect(await (await commentRoute.DELETE(req('http://x', 'DELETE'), p({ threadId: thread.id, commentId: first.id }))).json()).toEqual({ threadDeleted: false });
    await commentRoute.DELETE(req('http://x', 'DELETE'), p({ threadId: thread.id, commentId: third.id }));
    session.user = { id: owner.id, email: owner.email, actingUser: { id: mate.id } };
    expect(await (await commentRoute.DELETE(req('http://x', 'DELETE'), p({ threadId: thread.id, commentId: second.id }))).json()).toEqual({ threadDeleted: true });

    // Otro workspace no ve ni comenta.
    session.user = { id: stranger.id, email: stranger.email };
    expect((await commentsRoute.GET(req('http://x'), p())).status).toBe(404);
    expect((await commentsRoute.POST(req('http://x', 'POST', { x: 0, y: 0, body: 'hola' }), p())).status).toBe(404);
  });
});

describe('board: biblioteca de formas', () => {
  it('se guarda por workspace y valida lo que entra', async () => {
    const u = await makeUser('blib');
    const mate = await makeUser('blibm');
    const other = await makeUser('blibo');
    session.user = { id: u.id, email: u.email, actingUser: { id: mate.id } };
    const items = [{ id: 'item1', status: 'published', elements: [rect('r')], created: 1 }];
    const put = await libraryRoute.PUT(req('http://x', 'PUT', { libraryItems: items }));
    expect(put.status).toBe(200);
    session.user = { id: u.id, email: u.email };
    expect((await (await libraryRoute.GET()).json()).libraryItems).toEqual(items);
    expect(await getBoardLibrary(other.id)).toEqual([]);
    expect(await saveBoardLibrary(u.id, u.id, [{ nope: true }])).toEqual({ ok: false, code: 'invalid_input' });
  });

  it('solo instala links del catálogo oficial', () => {
    expect(isAllowedLibraryUrl('https://libraries.excalidraw.com/libraries/x/y.excalidrawlib')).toBe(true);
    expect(isAllowedLibraryUrl('https://raw.githubusercontent.com/excalidraw/excalidraw-libraries/main/libraries/a.excalidrawlib')).toBe(true);
    expect(isAllowedLibraryUrl('http://libraries.excalidraw.com/x')).toBe(false);
    expect(isAllowedLibraryUrl('https://evil.example/libraries.excalidraw.com')).toBe(false);
    expect(isAllowedLibraryUrl('https://raw.githubusercontent.com/evil/repo/x')).toBe(false);
  });
});

describe('board: coordenadas del lienzo', () => {
  it('escena ↔ vista son inversas', () => {
    const v = { scrollX: 30, scrollY: -10, zoom: 2 };
    expect(sceneToView({ x: 10, y: 20 }, v)).toEqual({ x: 80, y: 20 });
    expect(viewToScene(sceneToView({ x: 10, y: 20 }, v), v)).toEqual({ x: 10, y: 20 });
  });
});
