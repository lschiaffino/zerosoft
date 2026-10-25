import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'fs/promises';
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

  it('guarda en data/uploads (nunca en public/) y borra', async () => {
    const url = await saveUpload('docs', 'informe.pdf', 'application/pdf', Buffer.from('%PDF'));
    expect(url).toMatch(/^\/uploads\/docs\/[0-9a-f-]{36}-informe\.pdf$/);
    const file = localUploadPath(url)!;
    expect(file.startsWith(uploadsRoot() + path.sep)).toBe(true);
    expect(file).not.toContain(`${path.sep}public${path.sep}`);
    await deleteUploads([url]);
    expect(existsSync(file)).toBe(false);
  });

  it('agrega la extensión del tipo a un nombre sin extensión', async () => {
    const url = await saveUpload('chat', 'upload', 'image/png', Buffer.from('x'));
    expect(url).toMatch(/-upload\.png$/);
  });

  it('rechaza tipos fuera de la lista', async () => {
    await expect(saveUpload('docs', 'x.xht', 'application/xhtml+xml', Buffer.from('<x/>'))).rejects.toMatchObject({
      code: 'file_type_not_allowed',
    });
    await expect(saveUpload('chat', 'x.xht', 'text/plain', Buffer.from('<x/>'))).rejects.toMatchObject({
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

  it('la ruta pública solo sirve Chat/Track/tareas/Robots, con headers seguros', async () => {
    const url = await saveUpload('docs', 'privado.pdf', 'application/pdf', Buffer.from('%PDF'));
    const name = url.split('/').pop()!;
    expect((await localUploadResponse(['docs', name])).status).toBe(404);

    const chat = await saveUpload('chat', 'foto.png', 'image/png', Buffer.from('png'));
    const res = await localUploadResponse(['chat', chat.split('/').pop()!]);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain('sandbox');

    const txt = await saveUpload('chat', 'notas.txt', 'text/plain', Buffer.from('<script>1</script>'));
    expect(txt).toMatch(/\.txt$/);
    const r2 = await localUploadResponse(['chat', txt.split('/').pop()!]);
    expect(r2.headers.get('content-type')).toBe('application/octet-stream');
    expect(r2.headers.get('content-disposition')).toMatch(/^attachment/);
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
