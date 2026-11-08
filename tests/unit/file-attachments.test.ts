import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ user: null as null | { id: string; email: string; actingUser?: { id: string } } }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
}));
const blob = vi.hoisted(() => ({ head: vi.fn(), signed: [] as string[] }));
vi.mock('@vercel/blob', () => ({
  head: blob.head,
  get: vi.fn(),
  del: vi.fn(),
  put: vi.fn(async (pathname: string) => ({ url: `https://store.public.blob.vercel-storage.com/${pathname}` })),
}));
vi.mock('@vercel/blob/client', () => ({
  handleUpload: async (opts: { body: { payload: { pathname: string } }; onBeforeGenerateToken: (p: string) => Promise<unknown> }) => {
    await opts.onBeforeGenerateToken(opts.body.payload.pathname);
    blob.signed.push(opts.body.payload.pathname);
    return { type: 'blob.generate-client-token', clientToken: 'x' };
  },
}));

const fa = await import('@/lib/file-attachments');

const RECORD = '0b7f0a8e-1111-4222-8333-444455556666';
const files = fa.fileAttachments({ app: 'testapp', envPrefix: 'TESTAPP' });
const ctx = (extra: Record<string, string> = {}) => ({ params: Promise.resolve({ id: RECORD, ...extra }) });

type SavedRow = { id: string; ref: string; filename: string; contentType: string; size: number };
const rows = new Map<string, SavedRow>();
const routes = fa.attachmentRoutes<SavedRow>({
  files,
  authorize: async ({ params, user }) => (params.id === RECORD && user.id === 'owner' ? RECORD : null),
  save: async ({ file }) => {
    const row = { id: crypto.randomUUID(), ...file };
    rows.set(row.id, row);
    return row;
  },
  find: async ({ fileId }) => {
    const r = rows.get(fileId);
    return r ? { url: r.ref, filename: r.filename, contentType: r.contentType } : null;
  },
});

function req(url: string, init?: RequestInit) {
  return new NextRequest(new URL(url, 'http://localhost'), init as never);
}

describe('file-attachments: pathnames', () => {
  it('solo acepta un segmento bajo <app>/<registro>/', () => {
    expect(fa.prefixFor(files, RECORD)).toBe(`testapp/${RECORD}/`);
    expect(fa.isAllowedPathname(files, `testapp/${RECORD}/abc-informe.pdf`, RECORD)).toBe(true);
    expect(fa.isAllowedPathname(files, `testapp/${RECORD}/abc-setup.exe`, RECORD)).toBe(true);
    expect(fa.isAllowedPathname(files, `testapp/otro/abc.pdf`, RECORD)).toBe(false);
    expect(fa.isAllowedPathname(files, `track/${RECORD}/abc.pdf`, RECORD)).toBe(false);
    expect(fa.isAllowedPathname(files, `testapp/${RECORD}/../x.pdf`, RECORD)).toBe(false);
    expect(fa.isAllowedPathname(files, `testapp/${RECORD}/a/b.pdf`, RECORD)).toBe(false);
    expect(fa.isAllowedPathname(files, `testapp/${RECORD}/a..pdf`, RECORD)).toBe(false);
    expect(fa.isAllowedPathname(files, `testapp/${RECORD}/`, RECORD)).toBe(false);
    expect(fa.isAllowedPathname(files, 42, RECORD)).toBe(false);
    expect(() => fa.prefixFor(files, '../x')).toThrow();
  });

  it('safeSegment arma un nombre que pasa el guard', () => {
    const seg = fa.safeSegment('../../Mi informe (final).tar.gz');
    expect(fa.isAllowedPathname(files, `testapp/${RECORD}/${seg}`, RECORD)).toBe(true);
  });
});

describe('file-attachments: cómo se sirve', () => {
  it('ejecutables, HTML, SVG y desconocidos van como descarga octet-stream', () => {
    for (const [name, type] of [
      ['setup.exe', 'application/x-msdownload'],
      ['page.html', 'text/html'],
      ['logo.svg', 'image/svg+xml'],
      ['script.js', 'text/javascript'],
      ['data.bin', 'application/octet-stream'],
      ['sin-extension', ''],
      // La extensión manda: un .png declarado como HTML no se muestra.
      ['foto.png', 'text/html'],
      // Un .exe declarado como imagen tampoco.
      ['trucho.exe', 'image/png'],
    ]) {
      const s = fa.servingFor(name, type);
      expect(s.inline, name).toBe(false);
      expect(s.headers['Content-Type']).toBe('application/octet-stream');
      expect(s.headers['Content-Disposition']).toMatch(/^attachment;/);
      expect(s.headers['X-Content-Type-Options']).toBe('nosniff');
      expect(s.headers['Content-Security-Policy']).toContain('sandbox');
    }
  });

  it('imágenes raster, PDF, texto, audio y video se muestran con el tipo de la lista', () => {
    const png = fa.servingFor('captura.png', 'image/png');
    expect(png).toMatchObject({ inline: true, contentType: 'image/png', preview: 'image' });
    expect(png.headers['Content-Disposition']).toMatch(/^inline;/);
    expect(png.headers['Content-Security-Policy']).toBe("default-src 'none'; sandbox");
    expect(png.headers['X-Content-Type-Options']).toBe('nosniff');

    const pdf = fa.servingFor('informe.pdf', 'application/pdf');
    expect(pdf).toMatchObject({ inline: true, contentType: 'application/pdf', preview: 'pdf' });
    expect(pdf.headers['Content-Security-Policy']).toContain("default-src 'none'");

    expect(fa.servingFor('notas.txt', 'text/plain').contentType).toBe('text/plain; charset=utf-8');
    expect(fa.servingFor('audio.mp3', '').preview).toBe('audio');
    expect(fa.servingFor('video.mp4', 'video/mp4').preview).toBe('video');
    // Sin extensión, por el tipo declarado (si es de la lista).
    expect(fa.servingFor('image', 'image/png').inline).toBe(true);
  });

  it('?download=1 fuerza la descarga', () => {
    const s = fa.servingFor('captura.png', 'image/png', { download: true });
    expect(s.inline).toBe(false);
    expect(s.headers['Content-Disposition']).toMatch(/^attachment;/);
    expect(s.headers['Content-Type']).toBe('application/octet-stream');
  });

  it('el nombre con comillas o no ASCII no rompe el header', () => {
    const s = fa.servingFor('año "final".exe', '');
    expect(s.headers['Content-Disposition']).toContain("filename*=UTF-8''a%C3%B1o");
    expect(s.headers['Content-Disposition']).not.toContain('"final"');
  });
});

describe('file-attachments: rutas en modo local', () => {
  const env = { ...process.env };
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'zs-files-'));
    process.env.UPLOADS_DIR = dir;
    process.env.RATE_LIMIT_DISABLED = 'true';
    delete process.env.VERCEL;
    delete process.env.TESTAPP_BLOB_READ_WRITE_TOKEN;
    delete process.env.FILES_BLOB_READ_WRITE_TOKEN;
  });
  afterAll(() => {
    process.env = env;
    rmSync(dir, { recursive: true, force: true });
  });
  beforeEach(() => {
    session.user = { id: 'owner', email: 'o@x.test' };
  });

  it('sin sesión 401; sin permiso sobre el registro 404 (y no guarda nada)', async () => {
    session.user = null;
    expect((await routes.upload.GET(req(`/x/upload`), ctx())).status).toBe(401);
    session.user = { id: 'otro', email: 'x@x.test' };
    const res = await routes.upload.POST(req(`/x/upload?name=a.txt`, { method: 'POST', body: 'hola' }), ctx());
    expect(res.status).toBe(404);
    expect((await routes.upload.GET(req(`/x/upload`), ctx())).status).toBe(404);
    expect((await routes.upload.GET(req(`/x/upload`), ctx({ id: 'otro-registro' }))).status).toBe(404);
  });

  it('config: modo local con el prefijo del registro', async () => {
    const res = await routes.upload.GET(req('/x/upload'), ctx());
    expect(await res.json()).toMatchObject({ mode: 'local', prefix: `testapp/${RECORD}/` });
  });

  it('ida y vuelta: guarda cifrado en disco, sirve el original como descarga y borra', async () => {
    const plain = Buffer.concat([Buffer.from('MZ ejecutable de prueba '), Buffer.alloc(300_000, 7)]);
    const res = await routes.upload.POST(
      req(`/x/upload?name=${encodeURIComponent('setup.exe')}`, {
        method: 'POST',
        body: plain,
        headers: { 'content-type': 'application/x-msdownload' },
      }),
      ctx(),
    );
    expect(res.status).toBe(201);
    const row = (await res.json()) as SavedRow;
    expect(row).toMatchObject({ filename: 'setup.exe', contentType: 'application/x-msdownload', size: plain.length });
    expect(row.ref).toMatch(/^local:[0-9a-f-]{36}\.bin$/);

    // En disco no está el texto plano.
    const folder = path.join(dir, 'testapp-files');
    const stored = readFileSync(path.join(folder, row.ref.slice(6)));
    expect(stored.subarray(0, 4).toString()).toBe('ZSA1');
    expect(stored.includes(Buffer.from('MZ ejecutable'))).toBe(false);
    // El store de siempre lo puede leer (mismo formato que seal()).
    expect((await files.store.read(row.ref))?.equals(plain)).toBe(true);

    const got = await routes.file.GET(req(`/x/${row.id}`), ctx({ fileId: row.id }));
    expect(got.status).toBe(200);
    expect(got.headers.get('content-disposition')).toMatch(/^attachment;/);
    expect(got.headers.get('content-type')).toBe('application/octet-stream');
    expect(got.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await got.arrayBuffer()).equals(plain)).toBe(true);

    // Otro usuario no lo ve.
    session.user = { id: 'otro', email: 'x@x.test' };
    expect((await routes.file.GET(req(`/x/${row.id}`), ctx({ fileId: row.id }))).status).toBe(404);

    await fa.deleteStoredFiles(files, [row.ref]);
    expect(readdirSync(folder).filter((n) => n.startsWith(row.ref.slice(6, 42)))).toHaveLength(0);
  });

  it('una imagen se sirve en línea con su tipo', async () => {
    const res = await routes.upload.POST(
      req('/x/upload?name=captura.png', { method: 'POST', body: Buffer.from([0x89, 0x50, 0x4e, 0x47]), headers: { 'content-type': 'image/png' } }),
      ctx(),
    );
    const row = (await res.json()) as SavedRow;
    const got = await routes.file.GET(req(`/x/${row.id}`), ctx({ fileId: row.id }));
    expect(got.headers.get('content-type')).toBe('image/png');
    expect(got.headers.get('content-disposition')).toMatch(/^inline;/);
    expect(got.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
  });

  it('corta arriba de FILES_LOCAL_MAX_BYTES con 413 y no deja archivos a medias', async () => {
    process.env.FILES_LOCAL_MAX_BYTES = '1000';
    try {
      const res = await routes.upload.POST(req('/x/upload?name=big.bin', { method: 'POST', body: Buffer.alloc(5000) }), ctx());
      expect(res.status).toBe(413);
      expect(readdirSync(path.join(dir, 'testapp-files')).filter((n) => n.endsWith('.part'))).toHaveLength(0);
    } finally {
      delete process.env.FILES_LOCAL_MAX_BYTES;
    }
  });

  it('un cuerpo más corto que su Content-Length (cortado en el camino) se rechaza y no queda en disco', async () => {
    const folder = path.join(dir, 'testapp-files');
    const before = readdirSync(folder).length;
    const r = req('/x/upload?name=big.bin', { method: 'POST', body: Buffer.alloc(1000, 3), headers: { 'content-length': '5000' } });
    expect(r.headers.get('content-length')).toBe('5000');
    const res = await routes.upload.POST(r, ctx());
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'incomplete_upload' });
    expect(readdirSync(folder)).toHaveLength(before);
    // Con el largo correcto, se guarda.
    const okRes = await routes.upload.POST(
      req('/x/upload?name=ok.bin', { method: 'POST', body: Buffer.alloc(1000, 3), headers: { 'content-length': '1000' } }),
      ctx(),
    );
    expect(okRes.status).toBe(201);
  });

  it('sin el middleware, el acceso por app se chequea en la ruta: sin Track en el workspace ajeno, 401', async () => {
    const path = `/api/track/issues/${RECORD}/attachments/upload`;
    session.user = { id: 'owner', email: 'o@x.test', actingUser: { id: 'miembro' }, role: 'member', apps: ['crm'] } as never;
    expect((await routes.upload.GET(req(path), ctx())).status).toBe(401);
    session.user = { id: 'owner', email: 'o@x.test', actingUser: { id: 'miembro' }, role: 'member', apps: ['track'] } as never;
    expect((await routes.upload.GET(req(path), ctx())).status).toBe(200);
  });

  it('un archivo vacío no se guarda', async () => {
    const res = await routes.upload.POST(req('/x/upload?name=vacio.txt', { method: 'POST', body: new Uint8Array(0) }), ctx());
    expect(res.status).toBe(400);
  });
});

describe('file-attachments: Blob privado', () => {
  const env = { ...process.env };
  beforeAll(() => {
    process.env.RATE_LIMIT_DISABLED = 'true';
  });
  afterAll(() => {
    process.env = env;
  });
  beforeEach(() => {
    session.user = { id: 'owner', email: 'o@x.test' };
    delete process.env.TESTAPP_BLOB_READ_WRITE_TOKEN;
    delete process.env.FILES_BLOB_READ_WRITE_TOKEN;
    delete process.env.VERCEL;
    blob.head.mockReset();
  });

  it('modo según el entorno', () => {
    const legacyFiles = fa.fileAttachments({ app: 'track', envPrefix: 'TESTAPP', legacyFolder: 'track' });
    // Fuera de Vercel: disco local, con o sin store público.
    expect(fa.storageMode(legacyFiles)).toBe('local');
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_public';
    expect(fa.storageMode(legacyFiles)).toBe('local');
    // En Vercel sin store privado: lo de antes si la app lo pide, si no, sin almacenamiento.
    process.env.VERCEL = '1';
    expect(fa.storageMode(legacyFiles)).toBe('legacy');
    expect(fa.storageMode(files)).toBe('unavailable');
    delete process.env.BLOB_READ_WRITE_TOKEN;
    expect(fa.storageMode(legacyFiles)).toBe('unavailable');
    // Con store privado, siempre privado (cualquier tipo y tamaño).
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_public';
    process.env.TESTAPP_BLOB_READ_WRITE_TOKEN = 'own';
    expect(fa.storageMode(legacyFiles)).toBe('blob');
    expect(fa.maxBytesFor(legacyFiles, 'legacy')).toBe(fa.LEGACY_MAX_BYTES);
    expect(fa.maxBytesFor(legacyFiles, 'blob')).toBe(5 * 1024 * 1024 * 1024);
  });

  it('modo legacy: avisa el tope en la config, sube con saveUpload como antes y rechaza tipos y tamaños de más', async () => {
    process.env.VERCEL = '1';
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_public';
    process.env.RATE_LIMIT_DISABLED = 'true';
    const legacyFiles = fa.fileAttachments({ app: 'track', envPrefix: 'TESTAPP', legacyFolder: 'track' });
    const saved: unknown[] = [];
    const legacy = fa.attachmentRoutes({
      files: legacyFiles,
      authorize: async () => RECORD,
      save: async ({ file }) => {
        saved.push(file);
        return { id: 'row', ...file };
      },
      find: async () => null,
    });
    const cfg = await legacy.upload.GET(req('/x/upload'), ctx());
    expect(await cfg.json()).toMatchObject({ mode: 'legacy', maxBytes: fa.LEGACY_MAX_BYTES });

    const up = (name: string, body: Buffer, type: string) =>
      legacy.upload.POST(req(`/x/upload?name=${name}`, { method: 'POST', body, headers: { 'content-type': type } }), ctx());
    const ok = await up('informe.pdf', Buffer.from('%PDF-1.4'), 'application/pdf');
    expect(ok.status).toBe(201);
    expect(await ok.json()).toMatchObject({ ref: expect.stringMatching(/^https:\/\/store\.public\.blob\.vercel-storage\.com\/track\//), filename: 'informe.pdf', size: 8 });
    expect((await up('setup.exe', Buffer.from('MZ'), 'application/x-msdownload')).status).toBe(415);
    expect((await up('grande.zip', Buffer.alloc(fa.LEGACY_MAX_BYTES + 1), 'application/zip')).status).toBe(413);
    expect(saved).toHaveLength(1);
  });

  it('en Vercel sin ningún store: storage_not_configured', async () => {
    process.env.VERCEL = '1';
    delete process.env.BLOB_READ_WRITE_TOKEN;
    expect(fa.storageMode(files)).toBe('unavailable');
    const res = await routes.upload.GET(req('/x/upload'), ctx());
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'storage_not_configured' });
  });

  it('usa el token de la app o el compartido', () => {
    process.env.FILES_BLOB_READ_WRITE_TOKEN = 'shared';
    expect(fa.storageMode(files)).toBe('blob');
    expect(fa.privateToken(files)).toBe('shared');
    process.env.TESTAPP_BLOB_READ_WRITE_TOKEN = 'own';
    expect(fa.privateToken(files)).toBe('own');
  });

  it('firma solo pathnames bajo el prefijo del registro', async () => {
    process.env.FILES_BLOB_READ_WRITE_TOKEN = 'shared';
    const sign = (pathname: string) =>
      routes.upload.POST(
        req('/x/upload', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'blob.generate-client-token', payload: { pathname, clientPayload: null, multipart: true } }),
        }),
        ctx(),
      );
    expect((await sign(`testapp/${RECORD}/abc-setup.exe`)).status).toBe(200);
    expect((await sign(`testapp/otro/abc-setup.exe`)).status).toBe(403);
    expect((await sign(`testapp/${RECORD}/../x`)).status).toBe(403);
    expect(blob.signed).toEqual([`testapp/${RECORD}/abc-setup.exe`]);
  });

  it('finalize toma tamaño y tipo del store y rechaza pathnames ajenos sin consultar', async () => {
    process.env.FILES_BLOB_READ_WRITE_TOKEN = 'shared';
    const pathname = `testapp/${RECORD}/abc-video-Xy12.mp4`;
    blob.head.mockResolvedValue({ pathname, size: 123_456_789, contentType: 'video/mp4' });
    const fin = (body: unknown) =>
      routes.finalize.POST(req('/x/finalize', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), ctx());

    const res = await fin({ pathname, filename: 'video.mp4' });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ ref: `blobp:${pathname}`, size: 123_456_789, contentType: 'video/mp4', filename: 'video.mp4' });

    blob.head.mockClear();
    expect((await fin({ pathname: `testapp/otro/x.mp4`, filename: 'x' })).status).toBe(403);
    expect(blob.head).not.toHaveBeenCalled();

    blob.head.mockRejectedValue(new Error('not found'));
    expect((await fin({ pathname: `testapp/${RECORD}/nada.bin`, filename: 'x' })).status).toBe(404);
  });
});
