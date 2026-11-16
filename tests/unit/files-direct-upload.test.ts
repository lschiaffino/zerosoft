import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Subida directa (lib/files/direct-upload.ts): solo a la carpeta de subidas en
 * curso de la persona; al finalizar queda privada (cifrada o en el store
 * privado) y el original se borra.
 */
type FakeUser = { id: string; actingUser?: { id: string }; role: string };
const session = vi.hoisted(() => ({ user: null as null | FakeUser }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: FakeUser) => u.actingUser?.id ?? u.id,
  userCanUseApp: () => true,
}));
const blob = vi.hoisted(() => ({
  objects: new Map<string, { data: Buffer; contentType: string }>(),
  puts: [] as Array<{ pathname: string; access: string; data: Buffer }>,
  deleted: [] as string[],
  copies: [] as Array<{ from: string; to: string }>,
}));
const URL_OF = (p: string) => `https://abc123.public.blob.vercel-storage.com/${p}`;
vi.mock('@vercel/blob', () => ({
  head: async (p: string) => {
    const pathname = p.replace(/^https:\/\/[^/]+\//, '');
    const o = blob.objects.get(pathname);
    return o ? { pathname, url: URL_OF(pathname), size: o.data.length, contentType: o.contentType } : null;
  },
  get: async (url: string) => {
    const o = blob.objects.get(url.replace(/^https:\/\/[^/]+\//, ''));
    return o ? { statusCode: 200, stream: new Response(new Uint8Array(o.data)).body } : null;
  },
  put: async (pathname: string, body: AsyncIterable<Uint8Array> | Buffer, opts: { access: string }) => {
    const chunks: Buffer[] = [];
    if (Buffer.isBuffer(body)) chunks.push(body);
    else for await (const c of body) chunks.push(Buffer.from(c));
    const data = Buffer.concat(chunks);
    const name = `${pathname}-x`;
    blob.objects.set(name, { data, contentType: 'application/octet-stream' });
    blob.puts.push({ pathname, access: opts.access, data });
    return { url: URL_OF(name), pathname: name };
  },
  copy: async (from: string, to: string) => {
    const o = blob.objects.get(from.replace(/^https:\/\/[^/]+\//, ''))!;
    blob.objects.set(to, o);
    blob.copies.push({ from, to });
    return { url: URL_OF(to), pathname: to };
  },
  del: async (u: string | string[]) => {
    for (const x of Array.isArray(u) ? u : [u]) {
      blob.deleted.push(x);
      blob.objects.delete(x.replace(/^https:\/\/[^/]+\//, ''));
    }
  },
  list: async () => ({ blobs: [], hasMore: false }),
}));

const du = await import('@/lib/files/direct-upload');
const store = await import('@/lib/files/store');
const finalizeRoute = await import('@/app/api/files/upload/finalize/route');
const uploadRoute = await import('@/app/api/files/upload/route');

const WS = 'ws-direct-test';
const PERSON = 'person-direct-test';

describe('subida directa privada', () => {
  const prev = { ...process.env };
  beforeEach(() => {
    blob.objects.clear();
    blob.puts.length = 0;
    blob.deleted.length = 0;
    blob.copies.length = 0;
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_abc123_x';
    delete process.env.FILES_BLOB_READ_WRITE_TOKEN;
    process.env.RATE_LIMIT_DISABLED = 'true';
    session.user = { id: WS, actingUser: { id: PERSON }, role: 'member' };
  });
  afterEach(() => {
    process.env = { ...prev };
  });

  it('solo acepta la carpeta de subidas en curso de esa persona', () => {
    const prefix = du.incomingPrefix(PERSON);
    expect(du.isIncomingPathname(`${prefix}${crypto.randomUUID()}-foto.jpg`, PERSON)).toBe(true);
    expect(du.isIncomingPathname(`${du.incomingPrefix('otra')}${crypto.randomUUID()}-foto.jpg`, PERSON)).toBe(false);
    expect(du.isIncomingPathname(`chat/${crypto.randomUUID()}-foto.jpg`, PERSON)).toBe(false);
    expect(du.isIncomingPathname(`${prefix}../x`, PERSON)).toBe(false);
  });

  it('sin store privado: cifra, registra y borra el original en claro', async () => {
    const pathname = `${du.incomingPrefix(PERSON)}${crypto.randomUUID()}-video.mp4`;
    const data = Buffer.from('video-secreto'.repeat(10_000));
    blob.objects.set(pathname, { data, contentType: 'video/mp4' });
    const res = await finalizeRoute.POST(new Request('http://localhost/api/files/upload/finalize', { method: 'POST', body: JSON.stringify({ pathname, purpose: 'lines-media', name: 'video.mp4' }) }));
    expect(res.status).toBe(201);
    const out = (await res.json()) as { url: string; size: number };
    expect(out.url).toMatch(/^\/api\/files\//);
    expect(out.size).toBe(data.length);
    expect(blob.objects.has(pathname)).toBe(false);
    const sealed = blob.puts[0];
    expect(sealed.access).toBe('public');
    expect(sealed.data.subarray(0, 4).toString()).toBe('ZSF1');
    expect(sealed.data.includes(Buffer.from('video-secreto'))).toBe(false);
    const row = (await store.fileRowForUrl(out.url))!;
    expect(row).toMatchObject({ workspace_id: WS, user_id: PERSON, app: 'groups', access: 'user' });
    expect(JSON.stringify(out)).not.toContain('blob.vercel-storage.com');
  });

  it('con store privado: se mueve a files/ sin cifrar ni pasar por la función', async () => {
    process.env.FILES_BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_priv_x';
    const pathname = `${du.incomingPrefix(PERSON)}${crypto.randomUUID()}-plan.pdf`;
    blob.objects.set(pathname, { data: Buffer.from('%PDF'), contentType: 'application/pdf' });
    const row = await du.finalizeDirectUpload({ pathname, purpose: 'docs', name: 'plan.pdf', workspaceId: WS, personId: PERSON });
    expect(row.ref).toMatch(/^fsp:files\/docs\//);
    expect(row.access).toBe('internal');
    expect(blob.copies).toHaveLength(1);
    expect(blob.puts).toHaveLength(0);
    expect(blob.objects.has(pathname)).toBe(false);
  });

  it('rechaza la carpeta de otra persona, lo que pasa el tope y tipos ejecutables', async () => {
    const other = `${du.incomingPrefix('otra')}${crypto.randomUUID()}-x.pdf`;
    blob.objects.set(other, { data: Buffer.from('x'), contentType: 'application/pdf' });
    await expect(du.finalizeDirectUpload({ pathname: other, purpose: 'docs', name: 'x.pdf', workspaceId: WS, personId: PERSON })).rejects.toMatchObject({ code: 'forbidden' });
    const html = `${du.incomingPrefix(PERSON)}${crypto.randomUUID()}-x.png`;
    blob.objects.set(html, { data: Buffer.from('<script>'), contentType: 'text/html' });
    await expect(du.finalizeDirectUpload({ pathname: html, purpose: 'docs', name: 'x.png', workspaceId: WS, personId: PERSON })).rejects.toMatchObject({ code: 'file_type_not_allowed' });
    expect(blob.objects.has(html)).toBe(false);
    const big = `${du.incomingPrefix(PERSON)}${crypto.randomUUID()}-x.mp4`;
    blob.objects.set(big, { data: Buffer.alloc(16 * 1024 * 1024 + 1), contentType: 'video/mp4' });
    await expect(du.finalizeDirectUpload({ pathname: big, purpose: 'inbox-schedule', name: 'x.mp4', workspaceId: WS, personId: PERSON })).rejects.toMatchObject({ code: 'file_too_large' });
  });

  it('sin sesión: 401; config dice cómo subir', async () => {
    session.user = null;
    expect((await uploadRoute.GET(new Request('http://localhost/api/files/upload'))).status).toBe(401);
    expect((await finalizeRoute.POST(new Request('http://localhost/x', { method: 'POST', body: '{}' }))).status).toBe(401);
    session.user = { id: WS, actingUser: { id: PERSON }, role: 'member' };
    const cfg = (await (await uploadRoute.GET(new Request('http://localhost/api/files/upload?purpose=docs'))).json()) as { mode: string; access: string; prefix: string; max: number };
    expect(cfg).toMatchObject({ mode: 'sealed-blob', access: 'public', prefix: du.incomingPrefix(PERSON), max: 100 * 1024 * 1024 });
  });
});

describe('subida directa de archivos de importación', () => {
  it('cada propósito solo acepta su extensión', () => {
    expect(du.tokenConstraints('inbox-import', 'incoming/x/abc-export.ndjson').maximumSizeInBytes).toBe(2 * 1024 * 1024 * 1024);
    expect(() => du.tokenConstraints('inbox-import', 'incoming/x/abc-export.html')).toThrow(/file_type_not_allowed/);
    expect(() => du.tokenConstraints('inbox-import', 'incoming/x/abc-export.zip')).toThrow(/file_type_not_allowed/);
    expect(du.tokenConstraints('import-zip', 'incoming/x/abc-notion.zip').allowedContentTypes).toContain('application/zip');
    expect(() => du.tokenConstraints('import-zip', 'incoming/x/abc-notion.ndjson')).toThrow(/file_type_not_allowed/);
  });
});
