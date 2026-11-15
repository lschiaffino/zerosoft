import { mkdtemp, realpath, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Migración de archivos de antes (lib/files/migrate.ts): cuenta en seco,
 * copia cifrada, verifica, reescribe referencias, es idempotente y borra el
 * original solo después.
 */
const { getClient, getDb } = await import('@/lib/db');
const { migratePrivateFiles, legacyUrlsIn } = await import('@/lib/files/migrate');
const store = await import('@/lib/files/store');

const HOST = 'abc123.public.blob.vercel-storage.com';
const WS = 'ws-migrate-test';
const originals = new Map<string, Buffer>();
const deleted: string[] = [];

const io = {
  // Solo las tablas del test (la base la comparten los demás tests).
  tables: ['mig_test_items', 'mig_test_orphans'],
  sizeOf: async (url: string) => originals.get(url)?.length ?? null,
  readOriginal: async (url: string) => {
    const b = originals.get(url);
    if (!b) return null;
    return (async function* () {
      for (let i = 0; i < b.length; i += 1000) yield new Uint8Array(b.subarray(i, i + 1000));
    })();
  },
  deleteOriginal: async (url: string) => {
    deleted.push(url);
    originals.delete(url);
  },
};

describe('migración a archivos privados', () => {
  let tmp: string;
  const photo = `https://${HOST}/chat/33333333-2222-4333-8444-555555555555-foto.jpg`;
  const doc = `https://${HOST}/docs/22222222-2222-4333-8444-555555555555-plan.pdf`;
  const encrypted = `blobe:https://${HOST}/hiring/abc.bin`;

  beforeAll(async () => {
    tmp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'zs-migrate-')));
    process.env.UPLOADS_DIR = tmp;
    delete process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.FILES_BLOB_READ_WRITE_TOKEN;
    delete process.env.VERCEL;
    process.env.FILES_LEGACY_BLOB_HOST = HOST;
    originals.set(photo, Buffer.alloc(150_000, 7));
    originals.set(doc, Buffer.from('%PDF-plan'));
    const db = getDb();
    await getClient().execute('CREATE TABLE IF NOT EXISTS mig_test_items (id TEXT PRIMARY KEY, user_id TEXT, url TEXT, body TEXT)');
    await db.prepare('INSERT INTO mig_test_items (id, user_id, url, body) VALUES (?, ?, ?, ?)').run('a', WS, photo, `mira ![x](${doc}) y ${encrypted}`);
    await db.prepare('INSERT INTO mig_test_items (id, user_id, url, body) VALUES (?, ?, ?, ?)').run('b', WS, photo, '');
    await getClient().execute('CREATE TABLE IF NOT EXISTS mig_test_orphans (id TEXT PRIMARY KEY, url TEXT)');
    await db.prepare('INSERT INTO mig_test_orphans (id, url) VALUES (?, ?)').run('o', photo);
  });
  afterAll(async () => {
    delete process.env.FILES_LEGACY_BLOB_HOST;
    await rm(tmp, { recursive: true, force: true });
  });

  it('extrae URLs viejas, sin las cifradas', () => {
    expect(legacyUrlsIn(`a ${photo} b`)).toEqual([photo]);
    expect(legacyUrlsIn(encrypted)).toEqual([]);
    expect(legacyUrlsIn('https://otro.com/uploads/chat/x.png')).toEqual([]);
  });

  it('en seco cuenta por carpeta y bytes, sin tocar nada', async () => {
    const r = await migratePrivateFiles(getClient(), { ...io });
    expect(r.byFolder.chat).toEqual({ files: 1, bytes: 150_000 });
    expect(r.byFolder.docs).toEqual({ files: 1, bytes: 9 });
    expect(r.total.files).toBe(2);
    expect(r.unmapped).toContainEqual({ table: 'mig_test_orphans', column: 'url', cells: 1 });
    expect(r.copied).toBe(0);
    const row = (await getDb().prepare('SELECT url FROM mig_test_items WHERE id = ?').get('a')) as { url: string };
    expect(row.url).toBe(photo);
  });

  it('copia, verifica y reescribe; idempotente', async () => {
    const r = await migratePrivateFiles(getClient(), { ...io, apply: true });
    expect(r.failed).toEqual([]);
    expect(r.copied).toBe(2);
    const a = (await getDb().prepare('SELECT url, body FROM mig_test_items WHERE id = ?').get('a')) as { url: string; body: string };
    const b = (await getDb().prepare('SELECT url FROM mig_test_items WHERE id = ?').get('b')) as { url: string };
    expect(a.url).toMatch(/^\/api\/files\//);
    expect(b.url).toBe(a.url);
    expect(a.body).not.toContain(HOST + '/docs');
    expect(a.body).toContain(encrypted);
    const row = (await store.fileRowForUrl(a.url))!;
    expect(row.workspace_id).toBe(WS);
    expect(row.ref.startsWith('fsl:')).toBe(true);
    expect((await store.readFileBytes(row))!.equals(originals.get(photo)!)).toBe(true);
    // Docs: 'internal' (se sirve por la ruta de la página).
    const docUrl = /\/api\/files\/[A-Za-z0-9_-]{22}\/[A-Za-z0-9._-]+/.exec(a.body)![0];
    expect((await store.fileRowForUrl(docUrl))!.access).toBe('internal');
    // La URL vieja sigue resolviendo a la fila (por legacy_key).
    expect((await store.fileRowForLegacyKey('chat/33333333-2222-4333-8444-555555555555-foto.jpg'))!.id).toBe(row.id);
    const again = await migratePrivateFiles(getClient(), { ...io, apply: true });
    expect(again.copied).toBe(0);
    expect(again.registered).toBe(0);
    expect(deleted).toEqual([]);
  });

  it('borra el original solo si ya no queda ninguna referencia vieja', async () => {
    // La tabla sin dueño todavía tiene la URL de la foto: esa no se borra.
    const r = await migratePrivateFiles(getClient(), { ...io, apply: true, deleteOriginals: true });
    expect(deleted).toEqual([doc]);
    expect(r.deleted).toBe(1);
    await getDb().prepare('DELETE FROM mig_test_orphans').run();
    await migratePrivateFiles(getClient(), { ...io, apply: true, deleteOriginals: true });
    expect(deleted).toContain(photo);
  });
});
