import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import { createFeedback } from '@/lib/feedback';
import { listBoardItems, listMyPendingItems } from '@/lib/board';
import { attachFeedbackToItem, createRoadmapItem, getRoadmapItem, ingestFeedback, updateRoadmapItem } from '@/lib/roadmap';
import { makeUser } from './helpers';

let savedAi: string | undefined;
beforeEach(() => {
  savedAi = process.env.AI_ENABLED;
  process.env.AI_ENABLED = 'false';
});
afterEach(() => {
  if (savedAi === undefined) delete process.env.AI_ENABLED;
  else process.env.AI_ENABLED = savedAi;
});

async function sendFeedback(input: { message: string; userId?: string | null; email?: string | null; pageUrl?: string }) {
  const row = await createFeedback({ kind: 'idea', product: 'notes', ...input });
  const res = await ingestFeedback(row);
  return { row, itemId: res.itemId! };
}

async function subscription(itemId: string, userId: string) {
  return (await getDb()
    .prepare('SELECT reason, active, locale FROM roadmap_subscriptions WHERE item_id = ? AND user_id = ?')
    .get(itemId, userId)) as { reason: string; active: number; locale: string } | undefined;
}

describe('board: pedidos propios en revisión', () => {
  it('la autora ve su feedback en revisión; nadie más, y el board público no cambia', async () => {
    const author = await makeUser('pend-a');
    const other = await makeUser('pend-b');
    const msg = `Etiquetas de colores en Notes ${crypto.randomUUID().slice(0, 6)}`;
    const { itemId } = await sendFeedback({ message: msg, userId: author.id, email: author.email });
    expect((await getRoadmapItem(itemId))).toMatchObject({ status: 'proposed', is_public: 0 });

    const mine = await listMyPendingItems({ id: author.id, email: author.email });
    expect(mine.map((p) => p.id)).toContain(itemId);
    expect(mine.find((p) => p.id === itemId)).toMatchObject({ title: msg, product: 'notes' });

    expect((await listMyPendingItems({ id: other.id, email: other.email })).map((p) => p.id)).not.toContain(itemId);
    expect(await listMyPendingItems(null)).toEqual([]);
    expect((await listBoardItems({ userId: author.id })).map((i) => i.id)).not.toContain(itemId);
  });

  it('feedback sin sesión se reconoce por email; con sesión de otro no', async () => {
    const author = await makeUser('pend-mail');
    const msg = `Exportar notas a PDF ${crypto.randomUUID().slice(0, 6)}`;
    const { itemId } = await sendFeedback({ message: msg, email: author.email.toUpperCase() });
    expect((await listMyPendingItems({ id: author.id, email: author.email })).map((p) => p.id)).toContain(itemId);

    // Feedback de otra cuenta logueada que tipeó el mismo email: no cuenta.
    const intruder = await makeUser('pend-intr');
    const msg2 = `Plantillas compartidas ${crypto.randomUUID().slice(0, 6)}`;
    const { itemId: itemId2 } = await sendFeedback({ message: msg2, userId: intruder.id, email: author.email });
    expect((await listMyPendingItems({ id: author.id, email: author.email })).map((p) => p.id)).not.toContain(itemId2);
  });

  it('muestra el mensaje propio, nunca el título del ítem ni el de otro feedback', async () => {
    const a = await makeUser('pend-own-a');
    const b = await makeUser('pend-own-b');
    const { itemId } = await sendFeedback({ message: `Texto privado de A ${crypto.randomUUID().slice(0, 6)}`, userId: a.id });
    const fbB = await createFeedback({ kind: 'idea', product: 'notes', message: 'Lo mismo, dicho por B', userId: b.id });
    await attachFeedbackToItem(fbB, itemId);
    const forB = (await listMyPendingItems({ id: b.id, email: b.email })).find((p) => p.id === itemId);
    expect(forB?.title).toBe('Lo mismo, dicho por B');
  });

  it('al hacerse público sale de revisión, aparece en el board y la autora queda suscripta', async () => {
    const author = await makeUser('pend-pub');
    const { itemId } = await sendFeedback({
      message: `Atajos de teclado en Notes ${crypto.randomUUID().slice(0, 6)}`,
      userId: author.id,
      pageUrl: 'https://zerosoft.ai/es/notes',
    });
    expect(await subscription(itemId, author.id)).toBeUndefined();

    await updateRoadmapItem(itemId, { status: 'idea', isPublic: true });
    expect((await listMyPendingItems({ id: author.id, email: author.email })).map((p) => p.id)).not.toContain(itemId);
    expect((await listBoardItems({ userId: author.id })).map((i) => i.id)).toContain(itemId);
    expect(await subscription(itemId, author.id)).toMatchObject({ reason: 'author', active: 1, locale: 'es' });
  });

  it('adjuntar el feedback a un ítem público suscribe a la autora; no reactiva a quien se fue', async () => {
    const author = await makeUser('pend-att');
    const { row, itemId } = await sendFeedback({ message: `Vista de calendario ${crypto.randomUUID().slice(0, 6)}`, userId: author.id });
    const target = await createRoadmapItem({ title: 'Calendario en Notes', description: '', product: 'notes', kind: 'idea', status: 'planned', isPublic: true });
    await attachFeedbackToItem(row, target.id);
    expect((await listMyPendingItems({ id: author.id, email: author.email })).map((p) => p.id)).not.toContain(itemId);
    expect(await subscription(target.id, author.id)).toMatchObject({ reason: 'author', active: 1 });

    await getDb().prepare('UPDATE roadmap_subscriptions SET active = 0 WHERE item_id = ? AND user_id = ?').run(target.id, author.id);
    await updateRoadmapItem(target.id, { status: 'in_progress' });
    expect((await subscription(target.id, author.id))?.active).toBe(0);
  });
});
