import { describe, expect, it } from 'vitest';
import { getClient, getDb } from '@/lib/db';
import { addMessage, createAccount, listMessages, listThreads, upsertThread } from '@/lib/inbox/core';
import { ftsExpression, HIT_END, HIT_START, markSnippet, parseSearch, searchMessages } from '@/lib/inbox/message-search';
import { searchInbox } from '@/lib/inbox/search';
import { MIGRATIONS } from '@/lib/schema/migrations';
import { makeUser } from './helpers';

async function setup() {
  const owner = (await makeUser('ibs')).id;
  const acc = await createAccount(owner, { kind: 'whatsapp', provider: 'fake', label: 'WhatsApp' });
  const ana = await upsertThread(acc, { externalId: `54911${Math.floor(1e7 + Math.random() * 8e7)}@s.whatsapp.net`, kind: 'dm', title: 'Ana Pérez' });
  const fam = await upsertThread(acc, { externalId: `1203${Math.floor(Math.random() * 1e9)}@g.us`, kind: 'group', title: 'Familia Pérez' });
  const at = (d: string) => new Date(`${d}T12:00:00.000Z`).toISOString();
  await addMessage(ana, { externalId: 'a1', fromMe: false, senderName: 'Ana', body: 'Te mando el contrato firmado mañana', sentAt: at('2026-01-10') });
  await addMessage(ana, { externalId: 'a2', fromMe: true, body: 'Dale, la reunión es a las 10', sentAt: at('2026-02-01') });
  await addMessage(ana, { externalId: 'a3', fromMe: false, senderName: 'Ana', body: '', mediaType: 'document', mediaName: 'presupuesto-cocina.pdf', sentAt: at('2026-03-01') });
  await addMessage(fam, { externalId: 'f1', fromMe: false, senderName: 'Tío Beto', body: 'El asado del domingo es en casa. Mirá https://maps.example/x', sentAt: at('2026-03-05') });
  await addMessage(fam, { externalId: 'f2', fromMe: false, senderName: 'Tía Marta', body: '🎤 dale, llevo el postre y el contrato de alquiler', sentAt: at('2026-03-06') });
  return { owner, acc, ana, fam };
}

describe('Búsqueda en Inbox: consulta', () => {
  it('separa filtros, frases y palabras', () => {
    expect(parseSearch('contrato from:ana in:"Familia Pérez" has:pdf before:2026-03-01 "a las 10"')).toEqual({
      terms: ['contrato', 'has', 'pdf'],
      phrases: ['a las 10'],
      from: 'ana',
      in: 'Familia Pérez',
      before: '2026-03-01T00:00:00.000Z',
    });
    expect(parseSearch('has:media after:2026-1-5').has).toBe('media');
    expect(parseSearch('has:media after:2026-1-5').after).toBe('2026-01-05T00:00:00.000Z');
    // Signos que FTS5 trataría como sintaxis no rompen nada.
    expect(ftsExpression(parseSearch('NEAR(a* OR "b'))).toBe('"NEAR"* AND "a"* AND "OR"* AND "b"*');
  });

  it('marca lo encontrado sin tildes ni mayúsculas (búsqueda sin índice)', () => {
    expect(markSnippet('La reunión es a las diez', ['reunion'])).toBe(`La ${HIT_START}reunión${HIT_END} es a las diez`);
  });
});

describe('Búsqueda en Inbox: mensajes', () => {
  it('texto, prefijos y sin tildes, con el fragmento resaltado y lo más nuevo primero', async () => {
    const { owner } = await setup();
    const r = await searchMessages(owner, 'contra');
    expect(r.hits.map((h) => h.threadTitle)).toEqual(['Familia Pérez', 'Ana Pérez']);
    expect(r.hits[1].snippet).toContain(`${HIT_START}contrato${HIT_END}`);
    expect((await searchMessages(owner, 'reunion')).hits).toHaveLength(1);
    expect((await searchMessages(owner, '"a las 10"')).hits[0].fromMe).toBe(true);
    // Nombre de archivo y audio transcripto.
    expect((await searchMessages(owner, 'presupuesto')).hits[0].mediaName).toBe('presupuesto-cocina.pdf');
    expect((await searchMessages(owner, 'postre')).hits[0].senderName).toBe('Tía Marta');
  });

  it('filtros: from, in, has, before y after (también sin texto)', async () => {
    const { owner } = await setup();
    expect((await searchMessages(owner, 'contrato from:ana')).hits.map((h) => h.threadTitle)).toEqual(['Ana Pérez']);
    expect((await searchMessages(owner, 'contrato from:marta')).hits.map((h) => h.threadTitle)).toEqual(['Familia Pérez']);
    expect((await searchMessages(owner, 'from:me')).hits.map((h) => h.snippet)).toEqual(['Dale, la reunión es a las 10']);
    expect((await searchMessages(owner, 'in:familia')).hits).toHaveLength(2);
    expect((await searchMessages(owner, 'has:media')).hits.map((h) => h.mediaName)).toEqual(['presupuesto-cocina.pdf']);
    expect((await searchMessages(owner, 'has:document in:ana')).hits).toHaveLength(1);
    expect((await searchMessages(owner, 'has:link')).hits[0].threadTitle).toBe('Familia Pérez');
    expect((await searchMessages(owner, 'contrato before:2026-02-01')).hits).toHaveLength(1);
    expect((await searchMessages(owner, 'contrato after:2026-02-01')).hits).toHaveLength(1);
  });

  it('nunca muestra mensajes de otra persona, ni en Cmd+K ni en la lista de chats', async () => {
    const a = await setup();
    const b = await setup();
    const r = await searchMessages(b.owner, 'asado');
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0].threadId).toBe(b.fam.id);
    const k = await searchInbox(a.owner, 'asado');
    expect(k.some((h) => h.href.includes(`m=`) && h.href.includes(a.fam.id))).toBe(true);
    expect(k.some((h) => h.href.includes(b.fam.id))).toBe(false);
    const chats = await listThreads(a.owner, { q: 'postre' });
    expect(chats.map((t) => t.id)).toEqual([a.fam.id]);
  });

  it('el índice sigue las ediciones y los borrados', async () => {
    const { owner, fam } = await setup();
    await getDb().prepare("UPDATE inbox_messages SET body = 'cambié: ahora es en lo de Rosa' WHERE thread_id = ? AND external_id = 'f1'").run(fam.id);
    expect((await searchMessages(owner, 'asado')).hits).toHaveLength(0);
    expect((await searchMessages(owner, 'rosa')).hits).toHaveLength(1);
    await getDb().prepare('DELETE FROM inbox_threads WHERE id = ?').run(fam.id);
    expect((await searchMessages(owner, 'rosa')).hits).toHaveLength(0);
  });

  it('ir al mensaje: trae desde 40 antes hasta el más nuevo', async () => {
    const { owner, acc } = await setup();
    const t = await upsertThread(acc, { externalId: `54911${Math.floor(1e7 + Math.random() * 8e7)}@s.whatsapp.net`, kind: 'dm', title: 'Larga' });
    for (let i = 0; i < 300; i++) await addMessage(t, { externalId: `l${i}`, fromMe: i % 2 === 0, body: i === 100 ? 'la aguja del pajar' : `mensaje ${i}`, sentAt: new Date(Date.UTC(2025, 0, 1, 0, i)).toISOString() });
    const [hit] = (await searchMessages(owner, 'aguja')).hits;
    const page = await listMessages(owner, t.id, { around: hit.id });
    expect(page.messages[0].body).toBe('mensaje 60');
    expect(page.messages.at(-1)?.body).toBe('mensaje 299');
    expect(page.more).toBe(true);
    expect(page.messages.some((m) => m.id === hit.id)).toBe(true);
  });

  it('rápido con 100.000 mensajes y el índice se llena con lo que ya había (backfill)', async () => {
    const { owner, ana } = await setup();
    const db = getDb();
    // 100k mensajes de golpe (con el índice al día por el trigger).
    await db
      .prepare(
        `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 100000)
         INSERT INTO inbox_messages (id, owner_id, thread_id, external_id, from_me, body, sent_at, created_at)
         SELECT 'ibm_bulk' || i, ?, ?, 'bulk' || i, i % 2, 'mensaje de relleno número ' || i || CASE WHEN i % 5000 = 0 THEN ' palabrarara' ELSE '' END,
           strftime('%Y-%m-%dT%H:%M:%fZ', '2024-01-01', '+' || i || ' minutes'), '2024-01-01T00:00:00.000Z' FROM n`,
      )
      .run(owner, ana.id);
    const t0 = performance.now();
    const r = await searchMessages(owner, 'palabrarara', { limit: 30 });
    const ms = performance.now() - t0;
    expect(r.hits).toHaveLength(20);
    expect(ms).toBeLessThan(1500);
    // Backfill: con el índice vacío, la migración lo vuelve a llenar.
    await db.prepare("INSERT INTO inbox_messages_fts(inbox_messages_fts) VALUES ('delete-all')").run();
    expect((await searchMessages(owner, 'palabrarara')).hits).toHaveLength(0);
    const m = MIGRATIONS.find((x) => x.id === '299_inbox_messages_fts')!;
    await m.up(getClient());
    expect((await searchMessages(owner, 'palabrarara')).hits).toHaveLength(20);
  }, 60_000);
});
