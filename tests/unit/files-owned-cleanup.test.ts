/**
 * Archivos: registrar un documento o video del CRM, o vaciar la papelera de
 * Notes, solo acepta o borra archivos de esa app, de ese workspace y (en
 * Notes) de esa persona. Un archivo de otro workspace, de otra persona o de
 * otra app no se borra. Datos inventados.
 */
import { mkdtempSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocument, deleteDocument } from '@/lib/crm-media';
import { createNote, deleteNoteForever, trashNote } from '@/lib/notes';
import { fileRowForUrl } from '@/lib/files/store';
import { saveUpload } from '@/lib/uploads';
import { getDb } from '@/lib/db';
import { workspaceWithMember } from './access-helpers';

beforeEach(() => {
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
  vi.stubEnv('FILES_BLOB_READ_WRITE_TOKEN', '');
  vi.stubEnv('BLOB_PRIVATE_READ_WRITE_TOKEN', '');
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('UPLOADS_DIR', mkdtempSync(path.join(os.tmpdir(), 'owned-clean-')));
});
afterEach(() => vi.unstubAllEnvs());

const exists = async (url: string) => !!(await fileRowForUrl(url));
const PDF = Buffer.from('%PDF-1.4\n%test\n');

describe('CRM: documentos y videos solo con archivos del CRM de este workspace', () => {
  it('no se registra un archivo de otro workspace ni de otra app; uno propio sí y se borra al borrar', async () => {
    const w = await workspaceWithMember('own-crm');
    const ws = w.owner.id;
    const foreign = await saveUpload('crm', 'other.pdf', 'application/pdf', PDF, { workspaceId: w.stranger.id, userId: w.stranger.id });
    const otherApp = await saveUpload('docs', 'page.pdf', 'application/pdf', PDF, { workspaceId: ws, userId: w.member.id });
    const input = (url: string) => ({ name: 'Doc', filename: 'doc.pdf', url, size: PDF.length, createdBy: w.member.id });
    await expect(createDocument(ws, input(foreign))).rejects.toMatchObject({ code: 'invalid_file' });
    await expect(createDocument(ws, input(otherApp))).rejects.toMatchObject({ code: 'invalid_file' });
    const own = await saveUpload('crm', 'mine.pdf', 'application/pdf', PDF, { workspaceId: ws, userId: w.member.id });
    const doc = await createDocument(ws, input(own));
    expect(await deleteDocument(ws, doc.id)).toBe(true);
    expect(await exists(own)).toBe(false);
    expect(await exists(foreign)).toBe(true);
    expect(await exists(otherApp)).toBe(true);
  });

  it('un documento guardado de antes con un archivo ajeno: borrarlo no borra ese archivo', async () => {
    const w = await workspaceWithMember('own-crm-old');
    const ws = w.owner.id;
    const foreign = await saveUpload('crm', 'other.pdf', 'application/pdf', PDF, { workspaceId: w.stranger.id, userId: w.stranger.id });
    const id = crypto.randomUUID();
    await getDb()
      .prepare('INSERT INTO crm_documents (id, user_id, name, filename, url, size, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, ws, 'Old', 'old.pdf', foreign, PDF.length, ws);
    expect(await deleteDocument(ws, id)).toBe(true);
    expect(await exists(foreign)).toBe(true);
  });
});

describe('Notes: vaciar la papelera borra solo los adjuntos propios', () => {
  it('un archivo de otra persona, de otro workspace o de Docs pegado en la nota queda; el propio se borra', async () => {
    const w = await workspaceWithMember('own-notes');
    const ws = w.owner.id;
    const owner = { workspaceId: ws, personId: w.member.id };
    const mine = await saveUpload('docs', 'mine.png', 'image/png', Buffer.from('png'), { workspaceId: ws, userId: w.member.id });
    const teammate = await saveUpload('docs', 'mate.png', 'image/png', Buffer.from('png'), { workspaceId: ws, userId: w.friend.id });
    const otherWs = await saveUpload('docs', 'far.png', 'image/png', Buffer.from('png'), { workspaceId: w.stranger.id, userId: w.member.id });
    const docsFile = await saveUpload('docs', 'page.png', 'image/png', Buffer.from('png'), { workspaceId: ws, userId: w.member.id, app: 'docs' });
    const block = (id: string, url: string) => ({ id, type: 'image' as const, content: '', url, name: `${id}.png`, size: 3, mime: 'image/png' });
    const note = await createNote(owner, {
      title: 'Pasted',
      content: [block('a', mine), block('b', teammate), block('c', otherWs), block('d', docsFile)],
    });
    await trashNote(owner, note.id);
    expect(await deleteNoteForever(owner, note.id)).toBe(true);
    expect(await exists(mine)).toBe(false);
    expect(await exists(teammate)).toBe(true);
    expect(await exists(otherWs)).toBe(true);
    expect(await exists(docsFile)).toBe(true);
  });
});
