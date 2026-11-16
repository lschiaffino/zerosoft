import { mkdtemp, mkdir, readdir, readFile, realpath, rm, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  deleteUploads,
  isAllowedUpload,
  legacyUploadsRoot,
  localUploadPath,
  migrateLegacyUploads,
  readUploadBytes,
  saveUpload,
  uploadsRoot,
} from '@/lib/uploads';
import { localUploadHeaders, localUploadResponse } from '@/lib/upload-serve';

describe('uploads: tipos permitidos', () => {
  it.each([
    ['foto.png', 'image/png'],
    ['doc.pdf', 'application/pdf'],
    ['planilla.csv', 'text/csv'],
    ['archivo.zip', 'application/zip'],
    ['informe.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['nota.m4a', 'audio/mp4'],
    ['upload', 'image/png'],
  ])('permite %s', (name, mime) => expect(isAllowedUpload(name, mime)).toBe(true));

  it.each([
    ['x.html', 'text/html'],
    ['x.svg', 'image/svg+xml'],
    ['x.png', 'text/html'],
    ['x.HTM', 'application/octet-stream'],
    ['x.js', 'text/javascript'],
    ['x.xml', 'application/xml'],
    // Lo que no está en la lista no pasa, aunque el tipo declarado sea inocente.
    ['x.xht', 'application/octet-stream'],
    ['x.xhtm', 'image/png'],
    ['x.rdf', ''],
    ['x.mml', ''],
    ['x.xsd', ''],
    ['x.mht', ''],
    ['x.exe', 'application/octet-stream'],
    ['upload', 'application/octet-stream'],
    ['x.png', 'application/xhtml+xml'],
  ])('bloquea %s (%s)', (name, mime) => expect(isAllowedUpload(name, mime)).toBe(false));
});

describe('uploads: disco local fuera de public/', () => {
  let tmp: string;
  let cwd: string;
  const prevDir = process.env.UPLOADS_DIR;

  beforeAll(async () => {
    tmp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'zs-uploads-')));
    cwd = process.cwd();
    // cwd de mentira: public/uploads viejo y data/uploads quedan en el tmp.
    process.chdir(tmp);
    delete process.env.UPLOADS_DIR;
    delete process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.FILES_BLOB_READ_WRITE_TOKEN;
    delete process.env.VERCEL;
    // Archivo de una versión anterior, antes de la migración.
    await mkdir(path.join(tmp, 'public', 'uploads', 'docs'), { recursive: true });
    await writeFile(path.join(tmp, 'public', 'uploads', 'docs', 'old-a.pdf'), 'viejo');
  });

  afterAll(async () => {
    process.chdir(cwd);
    if (prevDir === undefined) delete process.env.UPLOADS_DIR;
    else process.env.UPLOADS_DIR = prevDir;
    await rm(tmp, { recursive: true, force: true });
  });

  it('lee lo viejo de public/uploads antes de migrar, y migra a data/uploads', async () => {
    expect(localUploadPath('/uploads/docs/old-a.pdf')).toBe(path.join(legacyUploadsRoot(), 'docs', 'old-a.pdf'));
    await migrateLegacyUploads();
    expect(existsSync(path.join(tmp, 'public', 'uploads', 'docs', 'old-a.pdf'))).toBe(false);
    const moved = localUploadPath('/uploads/docs/old-a.pdf')!;
    expect(moved).toBe(path.join(tmp, 'data', 'uploads', 'docs', 'old-a.pdf'));
    expect(await readFile(moved, 'utf8')).toBe('viejo');
  });

  const WS = { workspaceId: 'ws-uploads-test', userId: 'person-uploads-test' };

  it('guarda cifrado fuera de public/, devuelve /api/files/… y borra', async () => {
    const url = await saveUpload('docs', 'informe.pdf', 'application/pdf', Buffer.from('%PDF-secreto'), WS);
    expect(url).toMatch(/^\/api\/files\/[A-Za-z0-9_-]{22}\/informe\.pdf$/);
    const dir = path.join(tmp, 'data', 'uploads', 'files');
    const names = await readdir(dir);
    expect(names.length).toBeGreaterThan(0);
    // En disco no queda el texto: está cifrado.
    for (const n of names) expect((await readFile(path.join(dir, n))).includes(Buffer.from('secreto'))).toBe(false);
    expect(await readUploadBytes(url, { workspaceId: WS.workspaceId })).toEqual(Buffer.from('%PDF-secreto'));
    // Otro workspace no lo lee por la ruta de su app.
    expect(await readUploadBytes(url, { workspaceId: 'otro' })).toBeNull();
    expect(await readUploadBytes(url, null)).toBeNull();
    await deleteUploads([url]);
    expect(await readUploadBytes(url, { workspaceId: WS.workspaceId })).toBeNull();
  });

  it('sin sesión ni workspace no guarda', async () => {
    await expect(saveUpload('docs', 'informe.pdf', 'application/pdf', Buffer.from('%PDF'))).rejects.toThrow();
  });

  it('agrega la extensión del tipo a un nombre sin extensión', async () => {
    const url = await saveUpload('chat', 'upload', 'image/png', Buffer.from('x'), WS);
    expect(url).toMatch(/\/upload\.png$/);
  });

  it('rechaza tipos fuera de la lista', async () => {
    await expect(saveUpload('docs', 'x.xht', 'application/xhtml+xml', Buffer.from('<x/>'), WS)).rejects.toMatchObject({
      code: 'file_type_not_allowed',
    });
    await expect(saveUpload('chat', 'x.xht', 'text/plain', Buffer.from('<x/>'), WS)).rejects.toMatchObject({
      code: 'file_type_not_allowed',
    });
  });

  it('UPLOADS_DIR configurable', () => {
    process.env.UPLOADS_DIR = path.join(tmp, 'otro');
    expect(uploadsRoot()).toBe(path.join(tmp, 'otro'));
    delete process.env.UPLOADS_DIR;
  });

  it('no resuelve rutas que se salen de la carpeta', () => {
    expect(localUploadPath('/uploads/docs/../../.env')).toBeNull();
    expect(localUploadPath('/uploads/docs/a/b.png')).toBeNull();
    expect(localUploadPath('/uploads/etc/passwd')).toBeNull();
    expect(localUploadPath('/uploads/docs/a.pdf', 'crm')).toBeNull();
  });

  it('/uploads/* solo sirve lo público por diseño; los adjuntos de antes, solo registrados', async () => {
    await mkdir(path.join(tmp, 'data', 'uploads', 'chat'), { recursive: true });
    await writeFile(path.join(tmp, 'data', 'uploads', 'chat', '11111111-2222-4333-8444-555555555555-foto.png'), 'png');
    await mkdir(path.join(tmp, 'data', 'uploads', 'workspace'), { recursive: true });
    await writeFile(path.join(tmp, 'data', 'uploads', 'workspace', '11111111-2222-4333-8444-555555555555-logo.png'), 'png');
    expect((await localUploadResponse(['docs', 'x.pdf'])).status).toBe(404);
    // Un adjunto de chat de antes, sin registrar: no se sirve a nadie.
    const req = new Request('http://localhost/uploads/chat/11111111-2222-4333-8444-555555555555-foto.png');
    expect((await localUploadResponse(['chat', '11111111-2222-4333-8444-555555555555-foto.png'], req)).status).toBe(404);
    expect((await localUploadResponse(['chat', '11111111-2222-4333-8444-555555555555-foto.png'])).status).toBe(404);
    // El logo del workspace sí (público por diseño), con headers seguros.
    const res = await localUploadResponse(['workspace', '11111111-2222-4333-8444-555555555555-logo.png']);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain('sandbox');
  });

  it('headers: nada que no sea imagen/audio/video se muestra en línea', () => {
    for (const n of ['a.xht', 'a.html', 'a.svg', 'a.pdf', 'a.txt', 'a.json']) {
      const h = localUploadHeaders(n);
      expect(h['Content-Type']).toBe('application/octet-stream');
      expect(h['Content-Disposition']).toMatch(/^attachment/);
      expect(h['Content-Security-Policy']).toContain('sandbox');
    }
  });
});

describe('next.config: /uploads nunca sale de public/ como estático', () => {
  it('reescribe /uploads/* antes de los archivos', async () => {
    const mod = (await import('../../next.config.mjs')) as { default: { rewrites?: () => Promise<unknown> } };
    const rewrites = (await mod.default.rewrites?.()) as { beforeFiles: Array<{ source: string; destination: string }> };
    expect(rewrites.beforeFiles).toContainEqual({ source: '/uploads/:path*', destination: '/api/uploads/:path*' });
  });
});
