import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createIssue, createProject, deleteIssue, deleteIssueAttachment, listIssueAttachments } from '@/lib/track-data';
import { trackFiles } from '@/lib/track-files';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
  isWorkspaceAdmin: (u: { role?: string }) => u.role === 'owner' || u.role === 'admin',
}));

const upload = await import('@/lib/routes/track/issues/[id]/attachments/upload/route');
const file = await import('@/lib/routes/track/issues/[id]/attachments/[fileId]/route');
const app = { origin: 'test' } as never;

describe('Track: adjuntos privados (modo local)', () => {
  const env = { ...process.env };
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'zs-track-files-'));
    process.env.UPLOADS_DIR = dir;
    process.env.RATE_LIMIT_DISABLED = 'true';
    delete process.env.VERCEL;
    delete process.env.TRACK_BLOB_READ_WRITE_TOKEN;
    delete process.env.FILES_BLOB_READ_WRITE_TOKEN;
  });
  afterAll(() => {
    process.env = env;
    rmSync(dir, { recursive: true, force: true });
  });

  it('cualquier tipo, solo para quien ve el issue, se lista con la ruta autorizada y se borra del disco', async () => {
    const a = await makeUser('trkfa');
    const b = await makeUser('trkfb');
    const p = await createProject(a.id, null, { name: 'Adjuntos privados' });
    const issue = await createIssue(p.id, a.id, { title: 'con exe', description: [] }, app);
    const ctx = (extra: Record<string, string> = {}) => ({ params: Promise.resolve({ id: issue.id, ...extra }) });

    // Otro workspace: 404, no se guarda nada.
    session.user = { id: b.id, email: b.email, role: 'owner' };
    const denied = await upload.POST(
      new NextRequest(`http://x/api/track/issues/${issue.id}/attachments/upload?name=x.exe`, { method: 'POST', body: 'MZ' }),
      ctx(),
    );
    expect(denied.status).toBe(404);

    session.user = { id: a.id, email: a.email, role: 'owner' };
    const res = await upload.POST(
      new NextRequest(`http://x/api/track/issues/${issue.id}/attachments/upload?name=setup.exe`, {
        method: 'POST',
        body: Buffer.from('MZ binario'),
        headers: { 'content-type': 'application/x-msdownload' },
      }),
      ctx(),
    );
    expect(res.status).toBe(201);
    const row = (await res.json()) as { id: string; url: string; filename: string };
    expect(row.filename).toBe('setup.exe');
    expect(row.url).toBe(`/api/track/issues/${issue.id}/attachments/${row.id}`);
    expect((await listIssueAttachments(issue.id))[0].url).toBe(row.url);

    const got = await file.GET(new NextRequest(`http://x${row.url}`), ctx({ fileId: row.id }));
    expect(got.headers.get('content-disposition')).toMatch(/^attachment;/);
    expect(await got.text()).toBe('MZ binario');

    session.user = { id: b.id, email: b.email, role: 'owner' };
    expect((await file.GET(new NextRequest(`http://x${row.url}`), ctx({ fileId: row.id }))).status).toBe(404);

    // Borrar el adjunto borra el archivo cifrado.
    const raw = (await import('@/lib/db')).getDb();
    const ref = ((await raw.prepare('SELECT url FROM track_issue_attachments WHERE id = ?').get(row.id)) as { url: string }).url;
    expect(ref).toMatch(/^local:/);
    expect(await trackFiles.store.read(ref)).not.toBeNull();
    expect(await deleteIssueAttachment(row.id, issue.id)).toBe(true);
    expect(await trackFiles.store.read(ref)).toBeNull();
    await deleteIssue(issue.id);
  });
});
