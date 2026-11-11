/**
 * Lines e Inbox: el mensaje que se manda aparece al apretar Enter
 * (lib/optimistic-send.ts). La burbuja provisoria, cuándo se va, qué pasa si
 * el envío falla y el orden de los envíos. Lógica pura; textos inventados.
 */
import { describe, expect, it } from 'vitest';
import { cleanClientId, dropSettled, isTempId, newClientId, sendQueue, tempIdFor } from '@/lib/optimistic-send';
import { coalesced } from '@/lib/wa-live-client';
import { cidOf, tempMessage } from '@/components/groups/optimistic';
import { applyPending, keepPending, tempInboxMessage } from '@/components/inbox/wa/pending';
import type { MessageDto as LinesMessage } from '@/lib/groups';
import type { MessageDto as InboxMessage } from '@/lib/inbox/types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('clientId', () => {
  it('uno nuevo pasa la validación del servidor; lo raro no se guarda', () => {
    const id = newClientId();
    expect(cleanClientId(id)).toBe(id);
    expect(isTempId(tempIdFor(id))).toBe(true);
    expect(isTempId(id)).toBe(false);
    for (const bad of ['', 'corto', '<script>alert(1)</script>', 'con espacios adentro', 'x'.repeat(41), 42, null, undefined, { a: 1 }]) expect(cleanClientId(bad)).toBeUndefined();
  });
});

describe('Lines: la burbuja provisoria', () => {
  const real = (id: string, cid?: string): LinesMessage => ({ ...tempMessage({ clientId: cid ?? 'x', chatId: 'c1', me: 'yo', body: 'hola', replyToId: null }), id, status: 'sent', meta: cid ? { cid } : {} });

  it('nace como saliente, "enviando", mía y con su clientId', () => {
    const t = tempMessage({ clientId: 'cid-00000001', chatId: 'c1', me: 'yo', body: 'hola', replyToId: 'm9' });
    expect(t).toMatchObject({ id: 'tmp-cid-00000001', direction: 'out', status: 'pending', authorId: 'yo', body: 'hola', replyToId: 'm9', chatId: 'c1' });
    expect(cidOf(t)).toBe('cid-00000001');
    expect(Number.isFinite(Date.parse(t.createdAt))).toBe(true);
  });

  it('se va cuando llega su mensaje guardado, venga por la respuesta o por el aviso en vivo; las demás quedan', () => {
    const a = tempMessage({ clientId: 'cid-aaaaaaa1', chatId: 'c1', me: 'yo', body: 'uno', replyToId: null });
    const b = tempMessage({ clientId: 'cid-bbbbbbb2', chatId: 'c1', me: 'yo', body: 'dos', replyToId: null });
    const old = real('m1');
    const savedA = real('m2', 'cid-aaaaaaa1');
    // Llega el guardado de "uno" (junto con otro mensaje cualquiera): su provisoria se va, la de "dos" sigue.
    const shown = [old, a, b, savedA];
    expect(dropSettled(shown, [savedA, old], cidOf).map((m) => m.id)).toEqual(['m1', b.id, 'm2']);
    // Nada nuevo con clientId: no cambia nada (ni se copia la lista).
    expect(dropSettled(shown, [old], cidOf)).toBe(shown);
    // Marcar una provisoria como no enviada no la saca (lo que llega es ella misma).
    const failed = { ...a, status: 'failed', error: 'send_failed' };
    expect(dropSettled([old, failed], [failed], cidOf).map((m) => m.id)).toEqual(['m1', a.id]);
    // El mensaje de otra persona con el mismo texto no la saca: solo cuenta el clientId.
    expect(dropSettled([a], [{ ...real('m3'), body: 'uno' }], cidOf)).toEqual([a]);
  });
});

describe('Inbox: la burbuja provisoria', () => {
  const msg = (id: string, cid?: string): InboxMessage => ({ ...tempInboxMessage(cid ?? 'x', 'hola'), id, status: 'sent', meta: cid ? { cid } : null });
  const detail = (messages: InboxMessage[], id = 't1') => ({ thread: { id }, messages, more: false });

  it('se suma a la conversación abierta de ese chat y a ninguna otra', () => {
    const temp = tempInboxMessage('cid-00000001', 'hola');
    expect(temp).toMatchObject({ id: 'tmp-cid-00000001', fromMe: true, status: 'pending', body: 'hola' });
    const d = detail([msg('m1')]);
    const added = applyPending(d, { type: 'add', threadId: 't1', message: temp })!;
    expect(added.messages.map((m) => m.id)).toEqual(['m1', temp.id]);
    // Dos veces el mismo aviso no la duplica.
    expect(applyPending(added, { type: 'add', threadId: 't1', message: temp })!.messages).toHaveLength(2);
    // Otro chat abierto: no le llega.
    expect(applyPending(d, { type: 'add', threadId: 'otro', message: temp })).toBe(d);
    expect(applyPending(null, { type: 'add', threadId: 't1', message: temp })).toBeNull();
    // El envío falló: la burbuja se va (el texto vuelve al campo, lo hace el composer).
    expect(applyPending(added, { type: 'drop', threadId: 't1', id: temp.id })!.messages.map((m) => m.id)).toEqual(['m1']);
  });

  it('sigue a la vista si la conversación se relee a mitad del envío, y se va cuando llega su mensaje', () => {
    const temp = tempInboxMessage('cid-00000001', 'hola');
    const other = tempInboxMessage('cid-00000002', 'chau');
    const shown = detail([msg('m1'), temp, other]);
    // Releída del servidor sin el mensaje todavía (llegó otro aviso del chat): las dos provisorias quedan al final.
    const reread = keepPending(shown, detail([msg('m1'), msg('m2')]));
    expect(reread.messages.map((m) => m.id)).toEqual(['m1', 'm2', temp.id, other.id]);
    // Llega el guardado de la primera: se va esa sola.
    const settled = keepPending(reread, detail([msg('m1'), msg('m2'), msg('m3', 'cid-00000001')]));
    expect(settled.messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3', other.id]);
    // Sin provisorias, la conversación nueva pasa tal cual (el mismo objeto).
    const next = detail([msg('m1')]);
    expect(keepPending(detail([msg('m0')]), next)).toBe(next);
    // Se abrió otro chat: nada del anterior se arrastra.
    const elsewhere = detail([msg('z1')], 't2');
    expect(keepPending(shown, elsewhere)).toBe(elsewhere);
    expect(keepPending(null, next)).toBe(next);
  });
});

describe('la cola de envíos de un chat', () => {
  it('salen de a uno y en el orden en que se escribieron, aunque el primero tarde más', async () => {
    const run = sendQueue();
    const log: string[] = [];
    const job = (name: string, ms: number) => async () => {
      log.push(`sale ${name}`);
      await sleep(ms);
      log.push(`llegó ${name}`);
      return name;
    };
    const results = await Promise.all([run(job('a', 40)), run(job('b', 5)), run(job('c', 1))]);
    expect(results).toEqual(['a', 'b', 'c']);
    expect(log).toEqual(['sale a', 'llegó a', 'sale b', 'llegó b', 'sale c', 'llegó c']);
  });

  it('uno que falla no frena a los que siguen, y su error llega a quien lo mandó', async () => {
    const run = sendQueue();
    const log: string[] = [];
    const bad = run(async () => {
      log.push('a');
      throw new Error('sin red');
    });
    const good = run(async () => {
      log.push('b');
      return 'ok';
    });
    await expect(bad).rejects.toThrow('sin red');
    expect(await good).toBe('ok');
    expect(log).toEqual(['a', 'b']);
  });
});

describe('releer el chat abierto por cada aviso', () => {
  it('nunca dos relecturas a la vez; varios avisos durante una corren una sola más al terminar', async () => {
    let running = 0;
    let max = 0;
    let runs = 0;
    const go = coalesced(async () => {
      running++;
      max = Math.max(max, running);
      runs++;
      await sleep(30);
      running--;
    });
    go();
    go();
    go();
    go();
    await sleep(120);
    expect(max).toBe(1);
    // La primera, y una más por todo lo que llegó mientras tanto: el último aviso nunca se pierde.
    expect(runs).toBe(2);
    go();
    await sleep(60);
    expect(runs).toBe(3);
  });

  it('una relectura que falla no traba las siguientes', async () => {
    let runs = 0;
    const go = coalesced(async () => {
      runs++;
      if (runs === 1) throw new Error('sin red');
    });
    go();
    await sleep(10);
    go();
    await sleep(10);
    expect(runs).toBe(2);
  });
});
