import { mkdtemp, readdir, readFile, realpath, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Archivos privados (lib/files): cifrado por bloques, storage, /api/files con
 * sesión y permiso, rangos, URLs firmadas y las URLs de antes.
 */

type FakeUser = { id: string; actingUser?: { id: string }; role: string; apps?: '*' | string[]; blockedApps?: string[] };
const session = vi.hoisted(() => ({ user: null as null | FakeUser }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: FakeUser) => u.actingUser?.id ?? u.id,
  userCanUseApp: (u: FakeUser, app: string) => !u.blockedApps?.includes(app) && (u.apps === undefined || u.apps === '*' || u.apps.includes(app)),
}));
const scopes = vi.hoisted(() => ({ allow: new Set<string>() }));
vi.mock('@/lib/files/scopes', () => ({
  scopeAllows: async (scope: string, user: FakeUser) => scopes.allow.has(`${scope}|${user.actingUser?.id ?? user.id}`),
}));

const sealed = await import('@/lib/files/sealed');
const store = await import('@/lib/files/store');
const { GET: fileGET } = await import('@/app/api/files/[id]/[[...name]]/route');
const { GET: legacyGET } = await import('@/app/api/files/legacy/[...path]/route');
const { saveUpload } = await import('@/lib/uploads');
const { getDb } = await import('@/lib/db');

const OWNER = 'ws-owner-files';
const OTHER = 'ws-other-files';
const owner = (person = OWNER): FakeUser => ({ id: OWNER, actingUser: person === OWNER ? undefined : { id: person }, role: person === OWNER ? 'owner' : 'member' });

function bytes(n: number, seed = 7): Buffer {
  const b = Buffer.alloc(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    b[i] = x & 0xff;
  }
  return b;
}

async function body(res: Response): Promise<Buffer> {
  return Buffer.from(await res.arrayBuffer());
}

function get(url: string, headers: Record<string, string> = {}) {
  const id = store.fileIdFromUrl(url.split('?')[0])!;
  return fileGET(new Request(new URL(url, 'http://localhost'), { headers }), { params: Promise.resolve({ id }) });
}

async function* chunks(buf: Buffer, size: number): AsyncGenerator<Uint8Array> {
  for (let i = 0; i < buf.length; i += size) yield new Uint8Array(buf.subarray(i, i + size));
}

describe('ZSF1: cifrado por bloques', () => {
  const C = sealed.CHUNK;
  it.each([0, 1, C - 1, C, C + 1, 3 * C + 5])('ida y vuelta de %i bytes (buffer y stream)', async (n) => {
    const plain = bytes(n);
    const a = sealed.sealBuffer(plain);
    expect(a.length).toBe(sealed.sealedSize(n));
    expect(sealed.plainSize(a.length)).toBe(n);
    expect(sealed.openBuffer(a).equals(plain)).toBe(true);
    const parts: Buffer[] = [];
    let size = -1;
    for await (const p of sealed.sealStream(chunks(plain, 1000), { onSize: (s) => (size = s) })) parts.push(p);
    const b = Buffer.concat(parts);
    expect(size).toBe(n);
    expect(b.length).toBe(sealed.sealedSize(n));
    expect(sealed.openBuffer(b).equals(plain)).toBe(true);
    // Mismo texto, distinto cifrado (sal al azar).
    if (n > 0) expect(a.subarray(sealed.HEADER).equals(b.subarray(sealed.HEADER))).toBe(false);
  });

  it('el texto no aparece en lo cifrado', () => {
    const plain = Buffer.from('foto privada '.repeat(1000));
    expect(sealed.sealBuffer(plain).includes(Buffer.from('foto privada'))).toBe(false);
  });

  it('detecta cambios, bloques cortados al final y bloques reordenados', () => {
    const plain = bytes(3 * C);
    const s = sealed.sealBuffer(plain);
    const flipped = Buffer.from(s);
    flipped[sealed.HEADER + 10] ^= 1;
    expect(() => sealed.openBuffer(flipped)).toThrow();
    // Cortar el último bloque entero: el que queda último no estaba marcado como último.
    expect(() => sealed.openBuffer(s.subarray(0, s.length - (C + sealed.TAG)))).toThrow();
    const swapped = Buffer.concat([
      s.subarray(0, sealed.HEADER),
      s.subarray(sealed.HEADER + C + sealed.TAG, sealed.HEADER + 2 * (C + sealed.TAG)),
      s.subarray(sealed.HEADER, sealed.HEADER + C + sealed.TAG),
      s.subarray(sealed.HEADER + 2 * (C + sealed.TAG)),
    ]);
    expect(() => sealed.openBuffer(swapped)).toThrow();
  });

  it('descifra cualquier rango pidiendo solo sus bloques', async () => {
    const plain = bytes(5 * C + 123);
    const s = sealed.sealBuffer(plain);
    for (const [start, end] of [
      [0, 0],
      [0, plain.length - 1],
      [C - 1, C],
      [2 * C + 7, 4 * C + 9],
      [plain.length - 10, plain.length - 1],
      [5 * C, 5 * C + 122],
    ]) {
      const r = sealed.sealedRangeFor(start, end, s.length);
      const out: Buffer[] = [];
      for await (const p of sealed.openRangeStream(s.subarray(0, sealed.HEADER), chunks(s.subarray(r.from, r.to + 1), 777), { start, end, first: r.first, sealedTotal: s.length })) out.push(p);
      expect(Buffer.concat(out).equals(plain.subarray(start, end + 1))).toBe(true);
    }
  });

  it('rota la clave: lo de antes se lee con FILES_KEY_OLD', () => {
    const prevKey = process.env.FILES_KEY;
    process.env.FILES_KEY = 'clave-vieja';
    const s = sealed.sealBuffer(Buffer.from('hola'));
    process.env.FILES_KEY = 'clave-nueva';
    expect(() => sealed.openBuffer(s)).toThrow();
    process.env.FILES_KEY_OLD = 'clave-vieja';
    expect(sealed.openBuffer(s).toString()).toBe('hola');
    delete process.env.FILES_KEY_OLD;
    if (prevKey === undefined) delete process.env.FILES_KEY;
    else process.env.FILES_KEY = prevKey;
  });
});

describe('/api/files: sesión, permiso y rangos', () => {
  let tmp: string;
  const prev = { dir: process.env.UPLOADS_DIR, blob: process.env.BLOB_READ_WRITE_TOKEN, vercel: process.env.VERCEL };

  beforeAll(async () => {
    tmp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'zs-files-')));
    process.env.UPLOADS_DIR = tmp;
    delete process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.FILES_BLOB_READ_WRITE_TOKEN;
    delete process.env.BLOB_PRIVATE_READ_WRITE_TOKEN;
    delete process.env.VERCEL;
  });
  afterAll(async () => {
    for (const [k, v] of [['UPLOADS_DIR', prev.dir], ['BLOB_READ_WRITE_TOKEN', prev.blob], ['VERCEL', prev.vercel]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await rm(tmp, { recursive: true, force: true });
  });
  beforeEach(() => {
    session.user = null;
    scopes.allow.clear();
  });

  it('una foto del workspace: sin sesión 401, otro workspace 404, el equipo 200', async () => {
    const photo = bytes(5000);
    const url = await saveUpload('chat', 'foto.jpg', 'image/jpeg', photo, { workspaceId: OWNER, userId: OWNER, app: 'chat', access: 'workspace' });
    expect(url).toMatch(/^\/api\/files\/[A-Za-z0-9_-]{22}\/[A-Za-z0-9._-]+$/);
    expect((await get(url)).status).toBe(401);
    session.user = { id: OTHER, role: 'owner' };
    expect((await get(url)).status).toBe(404);
    session.user = owner('teammate-1');
    const res = await get(url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('cache-control')).toMatch(/^private/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await body(res)).equals(photo)).toBe(true);
    // Sin la app (o con la app bloqueada): 404.
    session.user = { ...owner('teammate-2'), apps: ['track'] };
    expect((await get(url)).status).toBe(404);
  });

  it('rangos: 206 con los bytes justos, 416 fuera del archivo', async () => {
    const audio = bytes(3 * sealed.CHUNK + 999, 3);
    const url = await saveUpload('chat', 'nota.ogg', 'audio/ogg', audio, { workspaceId: OWNER, userId: OWNER, access: 'workspace' });
    session.user = owner();
    const r1 = await get(url, { range: 'bytes=100-199' });
    expect(r1.status).toBe(206);
    expect(r1.headers.get('content-range')).toBe(`bytes 100-199/${audio.length}`);
    expect((await body(r1)).equals(audio.subarray(100, 200))).toBe(true);
    const r2 = await get(url, { range: `bytes=${sealed.CHUNK - 5}-` });
    expect(r2.status).toBe(206);
    expect((await body(r2)).equals(audio.subarray(sealed.CHUNK - 5))).toBe(true);
    const r3 = await get(url, { range: 'bytes=-10' });
    expect((await body(r3)).equals(audio.subarray(audio.length - 10))).toBe(true);
    expect((await get(url, { range: `bytes=${audio.length + 5}-` })).status).toBe(416);
    expect(r1.headers.get('accept-ranges')).toBe('bytes');
  });

  it("'user': solo la persona dueña (Inbox)", async () => {
    const url = await saveUpload('inbox', 'doc.pdf', 'application/pdf', Buffer.from('%PDF-1'), { workspaceId: OWNER, userId: 'person-a' });
    session.user = owner('person-b');
    expect((await get(url)).status).toBe(404);
    session.user = owner('person-a');
    expect((await get(url)).status).toBe(200);
  });

  it("'internal': nunca por /api/files, ni para el dueño", async () => {
    const url = await saveUpload('docs', 'nota.pdf', 'application/pdf', Buffer.from('%PDF-2'), { workspaceId: OWNER, userId: OWNER });
    session.user = owner();
    expect((await get(url)).status).toBe(404);
  });

  it('scope: un compañero sin acceso a ese chat no lo ve', async () => {
    const url = await saveUpload('chat', 'avatar.png', 'image/png', Buffer.from('png'), {
      workspaceId: OWNER,
      userId: null,
      app: 'groups',
      access: 'workspace',
      scope: 'groups-chat:chat-123',
    });
    session.user = owner('teammate-x');
    expect((await get(url)).status).toBe(404);
    scopes.allow.add('groups-chat:chat-123|teammate-x');
    expect((await get(url)).status).toBe(200);
  });

  it("'public': sin sesión, por nuestro dominio", async () => {
    const url = await saveUpload('workspace', 'logo.png', 'image/png', Buffer.from('logo'), { workspaceId: OWNER, userId: OWNER });
    const res = await get(url);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toMatch(/^public/);
  });

  it('URL firmada: vale sin sesión hasta que vence; alterada o vencida, 404', async () => {
    const url = await saveUpload('docs', 'contrato.pdf', 'application/pdf', Buffer.from('%PDF-3'), { workspaceId: OWNER, userId: OWNER });
    const row = (await store.fileRowForUrl(url))!;
    const signed = store.signedFileUrl(row, 'http://localhost', 300);
    expect((await get(signed)).status).toBe(200);
    expect((await get(signed.replace(/sig=./, 'sig=A'))).status).toBe(404);
    const other = (await store.fileRowForUrl(await saveUpload('docs', 'b.pdf', 'application/pdf', Buffer.from('%PDF-4'), { workspaceId: OWNER, userId: OWNER })))!;
    // La firma de un archivo no sirve para otro.
    const q = signed.split('?')[1];
    expect((await get(`/api/files/${other.id}/b.pdf?${q}`)).status).toBe(404);
    const past = Math.floor(Date.now() / 1000) - 10;
    expect((await get(`${url}?exp=${past}&sig=${'a'.repeat(43)}`)).status).toBe(404);
    // Relativa (visitante del widget de Chat).
    expect((await get(store.signedRelativeUrl(url))).status).toBe(200);
  });

  it('ownedFileRow: solo archivos del workspace (o de la persona)', async () => {
    const url = await saveUpload('chat', 'x.png', 'image/png', Buffer.from('x'), { workspaceId: OWNER, userId: 'p1' });
    expect(await store.ownedFileRow(url, { workspaceId: OWNER })).not.toBeNull();
    expect(await store.ownedFileRow(url, { userId: 'p1' })).not.toBeNull();
    expect(await store.ownedFileRow(url, { workspaceId: OTHER })).toBeNull();
    expect(await store.ownedFileRow(url, null)).toBeNull();
  });

  it('archivos grandes en stream, cifrados en disco', async () => {
    const big = bytes(2 * 1024 * 1024 + 17, 11);
    const row = await store.putFile(chunks(big, 64 * 1024 + 3), { workspaceId: OWNER, folder: 'rec', access: 'workspace', name: 'video.webm', mime: 'video/webm' });
    expect(row.size).toBe(big.length);
    const disk = await readFile(path.join(tmp, 'files', `${row.id}.zsf`));
    expect(disk.subarray(0, 4).toString()).toBe('ZSF1');
    expect(disk.length).toBe(sealed.sealedSize(big.length));
    expect((await store.readFileBytes(row))!.equals(big)).toBe(true);
    await expect(
      store.putFile(chunks(big, 1000), { workspaceId: OWNER, folder: 'rec', access: 'workspace', name: 'x.webm', mime: 'video/webm', max: 1000 }),
    ).rejects.toMatchObject({ code: 'file_too_large' });
    // El archivo cortado no queda.
    expect((await readdir(path.join(tmp, 'files'))).some((n) => n.endsWith('.part'))).toBe(false);
  });

  it('URLs de antes: /api/files/legacy/<pathname> sirve solo lo registrado, con su permiso', async () => {
    const legacy = 'https://abc123.public.blob.vercel-storage.com/chat/11111111-2222-4333-8444-555555555555-foto.jpg';
    expect(store.legacyKeyFor(legacy)).toBe('chat/11111111-2222-4333-8444-555555555555-foto.jpg');
    const ctx = { params: Promise.resolve({ path: ['chat', '11111111-2222-4333-8444-555555555555-foto.jpg'] }) };
    session.user = owner();
    expect((await legacyGET(new Request('http://localhost/x'), ctx)).status).toBe(404);
    const row = await store.registerLegacyFile(legacy, { workspaceId: OWNER, folder: 'chat', access: 'workspace', name: 'foto.jpg', mime: 'image/jpeg', size: 3 });
    expect(row?.ref).toBe(`legacy:${legacy}`);
    // Idempotente.
    expect((await store.registerLegacyFile(legacy, { workspaceId: OWNER, folder: 'chat', access: 'workspace', name: 'foto.jpg', mime: 'image/jpeg' }))?.id).toBe(row!.id);
    session.user = null;
    expect((await legacyGET(new Request('http://localhost/x'), { params: Promise.resolve({ path: ['chat', '11111111-2222-4333-8444-555555555555-foto.jpg'] }) })).status).toBe(401);
    session.user = { id: OTHER, role: 'owner' };
    expect((await legacyGET(new Request('http://localhost/x'), { params: Promise.resolve({ path: ['chat', '11111111-2222-4333-8444-555555555555-foto.jpg'] }) })).status).toBe(404);
  });

  it('ninguna respuesta de /api/files tiene una URL del storage', async () => {
    const url = await saveUpload('chat', 'foto.png', 'image/png', Buffer.from('png'), { workspaceId: OWNER, userId: OWNER, access: 'workspace' });
    session.user = owner();
    const res = await get(url);
    const text = JSON.stringify([...res.headers.entries()]) + (await body(res)).toString('latin1');
    expect(text).not.toContain('blob.vercel-storage.com');
    session.user = null;
    const denied = await get(url);
    expect(JSON.stringify([...denied.headers.entries()]) + (await denied.text())).not.toContain('blob.vercel-storage.com');
  });

  it('borrar saca la fila y los bytes', async () => {
    const url = await saveUpload('chat', 'z.png', 'image/png', Buffer.from('z'), { workspaceId: OWNER, userId: OWNER, access: 'workspace' });
    const row = (await store.fileRowForUrl(url))!;
    await store.deleteFileUrls([url]);
    expect(await store.getFileRow(row.id)).toBeNull();
    session.user = owner();
    expect((await get(url)).status).toBe(404);
    const left = (await getDb().prepare('SELECT COUNT(*) AS n FROM stored_files WHERE id = ?').get(row.id)) as { n: number };
    expect(Number(left.n)).toBe(0);
  });
});

describe('store público de la suite: nunca bytes legibles', () => {
  it('con BLOB_READ_WRITE_TOKEN sube cifrado (ZSF1) y devuelve /api/files', async () => {
    const puts: Array<{ pathname: string; body: unknown; opts: { access: string } }> = [];
    vi.doMock('@vercel/blob', () => ({
      put: async (pathname: string, b: unknown, opts: { access: string }) => {
        puts.push({ pathname, body: b, opts });
        return { url: `https://abc123.public.blob.vercel-storage.com/${pathname}` };
      },
      del: async () => undefined,
      get: async () => null,
    }));
    vi.resetModules();
    const prevTok = process.env.BLOB_READ_WRITE_TOKEN;
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_test_x';
    try {
      const up = await import('@/lib/uploads');
      const url = await up.saveUpload('chat', 'foto.jpg', 'image/jpeg', Buffer.from('JPEG-secreto'), { workspaceId: OWNER, userId: OWNER });
      expect(url).toMatch(/^\/api\/files\//);
      expect(puts).toHaveLength(1);
      const sent = puts[0].body as Buffer;
      expect(Buffer.isBuffer(sent)).toBe(true);
      expect(sent.subarray(0, 4).toString()).toBe('ZSF1');
      expect(sent.includes(Buffer.from('secreto'))).toBe(false);
      expect(puts[0].opts.access).toBe('public');
      expect(puts[0].pathname).not.toContain('foto');
    } finally {
      if (prevTok === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
      else process.env.BLOB_READ_WRITE_TOKEN = prevTok;
      vi.doUnmock('@vercel/blob');
      vi.resetModules();
    }
  });
});
