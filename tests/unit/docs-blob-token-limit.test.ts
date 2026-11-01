import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDocPage } from '@/lib/docs';
import { DOCS_BLOB_TOKENS_PER_MINUTE, DOCS_MAX_BLOB_UPLOAD } from '@/lib/docs-files';
import { NOTES_MAX_BLOB_UPLOAD } from '@/lib/notes-types';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | { id: string; email: string; role?: string; actingUser?: { id: string } } }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
}));
const blob = vi.hoisted(() => ({ max: 0 }));
vi.mock('@vercel/blob/client', () => ({
  handleUpload: async (opts: { onBeforeGenerateToken: (p: string) => Promise<{ maximumSizeInBytes: number }> }) => {
    const r = await opts.onBeforeGenerateToken(`docs/${crypto.randomUUID()}-informe.pdf`);
    blob.max = r.maximumSizeInBytes;
    return { type: 'blob.generate-client-token', clientToken: 'x' };
  },
}));

const route = await import('@/lib/routes/docs/pages/[id]/files/blob/route');

const req = () =>
  new Request('http://localhost/api/docs/pages/x/files/blob', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'blob.generate-client-token', payload: { pathname: 'docs/a-informe.pdf', clientPayload: null, multipart: false } }),
  }) as never;

describe('Docs: permisos de subida directa a Blob', () => {
  const env = { ...process.env };
  beforeAll(() => {
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_test_token';
    delete process.env.RATE_LIMIT_DISABLED;
  });
  afterAll(() => {
    process.env = env;
  });

  it('el tope por archivo es el de Notes (100 MB), no 5 GB', () => {
    expect(DOCS_MAX_BLOB_UPLOAD).toBe(100 * 1024 * 1024);
    expect(DOCS_MAX_BLOB_UPLOAD).toBe(NOTES_MAX_BLOB_UPLOAD);
  });

  it('firma con el tope de 100 MB y corta con 429 después de los permisos por minuto de la persona', async () => {
    const owner = await makeUser('docs-blob');
    session.user = { id: owner.id, email: owner.email, role: 'owner' };
    const page = await createDocPage(owner.id, { title: 'Subidas' });
    const ctx = { params: Promise.resolve({ id: page.id }) };
    for (let i = 0; i < DOCS_BLOB_TOKENS_PER_MINUTE; i++) {
      const res = await route.POST(req(), { params: Promise.resolve({ id: page.id }) });
      expect(res.status).toBe(200);
    }
    expect(blob.max).toBe(100 * 1024 * 1024);
    const over = await route.POST(req(), ctx);
    expect(over.status).toBe(429);
    expect((await over.json()).error).toBe('rate_limited');
  });
});
