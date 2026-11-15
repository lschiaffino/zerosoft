/**
 * Lines e Inbox: un envío con su clientId sale una sola vez aunque lo pidan dos instancias del servidor
 * (lib/send-once.ts: la clave en send_claims).
 */
import { describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import { onceInFlight, pruneSendClaims } from '@/lib/send-once';

const key = (n: string) => `lines:chat-${n}:cid-${n}-${Date.now()}`;

describe('onceInFlight entre instancias', () => {
  it('si otra instancia está mandando, espera a que termine y lee lo guardado (no manda)', async () => {
    const k = key('a');
    // Otra instancia tomó la clave hace un momento.
    await getDb().prepare('INSERT INTO send_claims (key, created_at, done) VALUES (?, ?, 0)').run(k, Date.now());
    setTimeout(() => void getDb().prepare('UPDATE send_claims SET done = 1 WHERE key = ?').run(k), 400);
    let sent = 0;
    const r = await onceInFlight(
      k,
      async () => {
        sent++;
        return 'sent';
      },
      async () => 'saved',
    );
    expect(r).toBe('saved');
    expect(sent).toBe(0);
  });

  it('lo que ya salió deja la clave tomada: un pedido que llega después no lo vuelve a mandar', async () => {
    const k = key('b');
    let sent = 0;
    const send = async () => {
      sent++;
      return 'sent';
    };
    expect(await onceInFlight(k, send, async () => 'saved')).toBe('sent');
    expect(await onceInFlight(k, send, async () => 'saved')).toBe('saved');
    expect(sent).toBe(1);
  });

  it('lo que falló suelta la clave: el reintento sale', async () => {
    const k = key('c');
    await expect(
      onceInFlight(
        k,
        async () => {
          throw new Error('not_connected');
        },
        async () => 'saved',
      ),
    ).rejects.toThrow('not_connected');
    expect(await onceInFlight(k, async () => 'sent', async () => 'saved')).toBe('sent');
    // Con `ok`: una respuesta que no salió también suelta la clave.
    const k2 = key('d');
    expect(await onceInFlight(k2, async () => 429, async () => 0, { ok: (s) => s === 201 })).toBe(429);
    expect(await onceInFlight(k2, async () => 201, async () => 0, { ok: (s) => s === 201 })).toBe(201);
  });

  it('dos pedidos a la vez en la misma instancia: uno manda, el otro lee lo guardado', async () => {
    const k = key('e');
    let sent = 0;
    const send = async () => {
      sent++;
      await new Promise((r) => setTimeout(r, 50));
      return 'sent';
    };
    const [a, b] = await Promise.all([onceInFlight(k, send, async () => 'saved'), onceInFlight(k, send, async () => 'saved')]);
    expect([a, b].sort()).toEqual(['saved', 'sent']);
    expect(sent).toBe(1);
  });

  it('una clave sin terminar de una instancia que se cayó se puede volver a tomar; el cron borra las viejas', async () => {
    const k = key('f');
    await getDb().prepare('INSERT INTO send_claims (key, created_at, done) VALUES (?, ?, 0)').run(k, Date.now() - 5 * 60_000);
    expect(await onceInFlight(k, async () => 'sent', async () => 'saved')).toBe('sent');
    const old = key('g');
    await getDb().prepare('INSERT INTO send_claims (key, created_at, done) VALUES (?, ?, 1)').run(old, Date.now() - 2 * 24 * 3600_000);
    expect(await pruneSendClaims()).toBeGreaterThanOrEqual(1);
    expect(await getDb().prepare('SELECT 1 AS ok FROM send_claims WHERE key = ?').get(old)).toBeUndefined();
  });
});
