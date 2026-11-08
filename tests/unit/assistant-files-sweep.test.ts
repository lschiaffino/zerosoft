import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb, upsertUser } from '@/lib/db';

/**
 * Limpieza de adjuntos del asistente contra un store en memoria: fallas al
 * borrar, lotes que siguen, carreras entre mandar y el cron, y archivos
 * compartidos entre charlas (cuenta de referencias).
 */
const files = new Map<string, Buffer>();
const failing = new Set<string>();
const throwing = new Set<string>();
const removed: string[] = [];
vi.mock('@/lib/private-files', () => ({
  privateFileStore: () => ({
    store: async (bytes: Buffer) => {
      const ref = `mem:${crypto.randomUUID()}`;
      files.set(ref, bytes);
      return ref;
    },
    read: async (ref: string) => files.get(ref) ?? null,
    remove: async (refs: string[]) => refs.forEach((r) => files.delete(r)),
    removeOne: async (ref: string) => {
      if (throwing.has(ref)) throw new Error('boom');
      if (failing.has(ref)) return false;
      removed.push(ref);
      files.delete(ref);
      return true;
    },
    seal: (b: Buffer) => b,
    open: (b: Buffer) => b,
  }),
}));

const { claimAttachments, createAttachment, deleteConversationFiles, getAttachments, sweepUnclaimedAttachments } = await import('@/lib/assistant/files');
const { createConversation } = await import('@/lib/assistant/store');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const LATER = () => Date.now() + 25 * 60 * 60 * 1000;

async function owner() {
  const id = `sw-${Math.random().toString(36).slice(2, 8)}`;
  const u = await upsertUser({ id, email: `${id}@example.com`, name: id, image: null });
  return { workspaceId: u.id, personId: u.id };
}

async function upload(o: Awaited<ReturnType<typeof owner>>) {
  return createAttachment(o, { name: 'p.png', type: 'image/png', bytes: PNG });
}

const rowOf = async (id: string) => (await getDb().prepare('SELECT conversation_id FROM assistant_files WHERE id = ?').get(id)) as { conversation_id: string | null } | undefined;

beforeEach(async () => {
  failing.clear();
  throwing.clear();
  removed.length = 0;
  // Cada test arranca sin restos de los anteriores en el lote del cron.
  await getDb().prepare('DELETE FROM assistant_files').run();
});

describe('cron de adjuntos', () => {
  it('si borrar falla, el reclamo se suelta y la próxima corrida lo reintenta', async () => {
    const o = await owner();
    const a = await upload(o);
    failing.add(a.ref);
    expect(await sweepUnclaimedAttachments({ now: LATER() })).toBe(0);
    expect((await rowOf(a.id))?.conversation_id).toBe('__orphan__');
    expect(await getAttachments(o, [a.id])).toHaveLength(0);
    failing.clear();
    expect(await sweepUnclaimedAttachments({ now: LATER() })).toBe(1);
    expect(await rowOf(a.id)).toBeUndefined();
    expect(removed).toEqual([a.ref]);
  });

  it('una falla (aunque tire) no corta el lote', async () => {
    const o = await owner();
    const bad = await upload(o);
    const good = await upload(o);
    throwing.add(bad.ref);
    expect(await sweepUnclaimedAttachments({ now: LATER() })).toBe(1);
    expect(await rowOf(good.id)).toBeUndefined();
    expect((await rowOf(bad.id))?.conversation_id).toBe('__orphan__');
  });

  it('mandar y el cron a la vez: gana uno solo y nunca queda un mensaje con un archivo borrado', async () => {
    for (let i = 0; i < 8; i++) {
      const o = await owner();
      const a = await upload(o);
      await getDb().prepare('UPDATE assistant_files SET created_at = ? WHERE id = ?').run(new Date(Date.now() - 2 * 86_400_000).toISOString(), a.id);
      const conv = await createConversation(o, 'x');
      const [claimed] = await Promise.all([claimAttachments(o, conv.id, [a.id]), sweepUnclaimedAttachments()]);
      if (claimed) {
        expect(claimed.get(a.id)).toBe(a.id);
        expect((await rowOf(a.id))?.conversation_id).toBe(conv.id);
        expect(files.has(a.ref)).toBe(true);
      } else {
        expect(await rowOf(a.id)).toBeUndefined();
      }
    }
  });
});

describe('adjuntos compartidos entre charlas', () => {
  it('reusar uno en otra charla crea otra referencia; el archivo se borra con la última', async () => {
    const o = await owner();
    const a = await upload(o);
    const one = await createConversation(o, 'one');
    const two = await createConversation(o, 'two');
    expect((await claimAttachments(o, one.id, [a.id]))?.get(a.id)).toBe(a.id);
    const copyId = (await claimAttachments(o, two.id, [a.id]))?.get(a.id);
    expect(copyId).toMatch(/^att_/);
    expect(copyId).not.toBe(a.id);

    await deleteConversationFiles(o, one.id);
    expect(removed).toEqual([]);
    const [copy] = await getAttachments(o, [copyId!]);
    expect(copy.ref).toBe(a.ref);
    expect(files.has(a.ref)).toBe(true);

    await deleteConversationFiles(o, two.id);
    expect(removed).toEqual([a.ref]);
    expect(await getAttachments(o, [copyId!])).toHaveLength(0);
  });

  it('borrar una charla con un archivo que no se puede borrar lo deja para el cron', async () => {
    const o = await owner();
    const a = await upload(o);
    const conv = await createConversation(o, 'x');
    await claimAttachments(o, conv.id, [a.id]);
    failing.add(a.ref);
    await deleteConversationFiles(o, conv.id);
    expect((await rowOf(a.id))?.conversation_id).toBe('__orphan__');
    failing.clear();
    expect(await sweepUnclaimedAttachments()).toBe(1);
    expect(removed).toEqual([a.ref]);
  });

  it('no se suma una referencia a un archivo de una charla que se está borrando', async () => {
    const o = await owner();
    const a = await upload(o);
    const one = await createConversation(o, 'one');
    const two = await createConversation(o, 'two');
    await claimAttachments(o, one.id, [a.id]);
    await getDb().prepare("UPDATE assistant_files SET conversation_id = '__deleting__' WHERE id = ?").run(a.id);
    expect(await claimAttachments(o, two.id, [a.id])).toBeNull();
  });
});
