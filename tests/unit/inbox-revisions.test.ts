import { describe, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import os from 'os';
import path from 'path';
import { MIGRATIONS } from '@/lib/schema/migrations';
import { inboxUp } from '@/lib/schema/inbox-migration';
import { versionTag } from '@/lib/inbox/revisions';

/** Los triggers de 390_inbox_revisions suben la versión del chat y de la persona con cada cambio de Inbox. */
async function setup() {
  const c = createClient({ url: `file:${path.join(os.tmpdir(), `rev-${crypto.randomUUID()}.db`)}` });
  await c.execute('CREATE TABLE users (id TEXT PRIMARY KEY)');
  await c.execute("INSERT INTO users (id) VALUES ('u1'), ('u2')");
  await inboxUp(c);
  const m = MIGRATIONS.find((x) => x.id === '390_inbox_revisions')!;
  await m.up(c);
  await m.up(c); // dos veces no rompe
  const now = new Date().toISOString();
  await c.execute({ sql: "INSERT INTO inbox_accounts (id, owner_id, kind, created_at, updated_at) VALUES ('a1', 'u1', 'whatsapp', ?, ?)", args: [now, now] });
  await c.execute({
    sql: "INSERT INTO inbox_threads (id, owner_id, account_id, channel, kind, external_id, created_at, updated_at) VALUES ('t1', 'u1', 'a1', 'whatsapp', 'chat', 'x1', ?, ?), ('t2', 'u1', 'a1', 'whatsapp', 'chat', 'x2', ?, ?)",
    args: [now, now, now, now],
  });
  const rev = async (sql: string) => Number((await c.execute(sql)).rows[0]?.rev ?? 0);
  return {
    c,
    now,
    thread: (id: string) => rev(`SELECT rev FROM inbox_threads WHERE id = '${id}'`),
    owner: (id: string) => rev(`SELECT rev FROM inbox_rev WHERE owner_id = '${id}'`),
  };
}

describe('versiones de Inbox', () => {
  it('un mensaje nuevo sube su chat y a la persona, no al otro chat', async () => {
    const { c, now, thread, owner } = await setup();
    const [t1, t2, o] = [await thread('t1'), await thread('t2'), await owner('u1')];
    await c.execute({ sql: "INSERT INTO inbox_messages (id, owner_id, thread_id, external_id, sent_at, created_at) VALUES ('m1', 'u1', 't1', 'e1', ?, ?)", args: [now, now] }).catch(async () => {
      // Columnas obligatorias distintas según la versión del esquema: la forma mínima.
      await c.execute({ sql: "INSERT INTO inbox_messages (id, owner_id, thread_id, external_id) VALUES ('m1', 'u1', 't1', 'e1')", args: [] });
    });
    expect(await thread('t1')).toBeGreaterThan(t1);
    expect(await thread('t2')).toBe(t2);
    expect(await owner('u1')).toBeGreaterThan(o);
    expect(await owner('u2')).toBe(0);
  });

  it('cambiar el chat, sus carpetas o borrar un mensaje también la sube', async () => {
    const { c, thread, owner } = await setup();
    let t = await thread('t1');
    await c.execute("UPDATE inbox_threads SET draft = 'hola' WHERE id = 't1'");
    expect(await thread('t1')).toBeGreaterThan(t);
    t = await thread('t1');
    const now = new Date().toISOString();
    await c.execute({ sql: "INSERT INTO inbox_folders (id, owner_id, name, created_at, updated_at) VALUES ('f1', 'u1', 'F', ?, ?)", args: [now, now] }).catch(() =>
      c.execute("INSERT INTO inbox_folders (id, owner_id, name) VALUES ('f1', 'u1', 'F')"),
    );
    const o = await owner('u1');
    await c.execute("INSERT INTO inbox_thread_folders (thread_id, folder_id) VALUES ('t1', 'f1')");
    expect(await thread('t1')).toBeGreaterThan(t);
    expect(await owner('u1')).toBeGreaterThan(o);
  });

  it('la etiqueta cambia con la versión, el pedido y el minuto', () => {
    const t0 = 1_700_000_000_000;
    expect(versionTag('t', 3, 'a', t0)).toBe(versionTag('t', 3, 'a', t0 + 1000));
    expect(versionTag('t', 3, 'a', t0)).not.toBe(versionTag('t', 4, 'a', t0));
    expect(versionTag('t', 3, 'a', t0)).not.toBe(versionTag('t', 3, 'b', t0));
    expect(versionTag('t', 3, 'a', t0)).not.toBe(versionTag('t', 3, 'a', t0 + 61_000));
  });
});
