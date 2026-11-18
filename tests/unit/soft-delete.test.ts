import { beforeAll, describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import {
  getSoftDeleted,
  graceDaysFor,
  listSoftDeleted,
  purgeDueSoftDeleted,
  purgeSoftDeleted,
  restoreSoftDeleted,
  retentionPlan,
  SOFT_DELETE_GRACE_DAYS,
  softDelete,
  softDeleteDaysLeft,
  softDeletedFiles,
} from '@/lib/soft-delete';

const DAY = 86_400_000;
const NOW = new Date('2026-06-01T12:00:00.000Z');

// Tablas propias del test: un padre, hijas en cascada, una referencia SET NULL y una tabla sin FK.
beforeAll(async () => {
  const db = getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS sdt_parent (id TEXT PRIMARY KEY, ws TEXT NOT NULL, name TEXT NOT NULL, email TEXT UNIQUE);
    CREATE TABLE IF NOT EXISTS sdt_child (id TEXT PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES sdt_parent(id) ON DELETE CASCADE, body TEXT);
    CREATE TABLE IF NOT EXISTS sdt_grandchild (child_id TEXT NOT NULL REFERENCES sdt_child(id) ON DELETE CASCADE, n INTEGER NOT NULL, PRIMARY KEY (child_id, n));
    CREATE TABLE IF NOT EXISTS sdt_ref (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES sdt_parent(id) ON DELETE SET NULL);
    CREATE TABLE IF NOT EXISTS sdt_loose (id TEXT PRIMARY KEY, subject_id TEXT NOT NULL);
  `);
});

let seq = 0;
async function seed(ws: string) {
  const db = getDb();
  const id = `p${++seq}_${Math.random().toString(36).slice(2, 8)}`;
  await db.prepare('INSERT INTO sdt_parent (id, ws, name, email) VALUES (?, ?, ?, ?)').run(id, ws, `Name ${id}`, `${id}@example.test`);
  await db.prepare('INSERT INTO sdt_child (id, parent_id, body) VALUES (?, ?, ?)').run(`${id}_c1`, id, 'one');
  await db.prepare('INSERT INTO sdt_child (id, parent_id, body) VALUES (?, ?, ?)').run(`${id}_c2`, id, 'two');
  await db.prepare('INSERT INTO sdt_grandchild (child_id, n) VALUES (?, ?)').run(`${id}_c1`, 1);
  await db.prepare('INSERT INTO sdt_ref (id, parent_id) VALUES (?, ?)').run(`${id}_r`, id);
  await db.prepare('INSERT INTO sdt_loose (id, subject_id) VALUES (?, ?)').run(`${id}_l`, id);
  return id;
}

async function counts(id: string) {
  const db = getDb();
  const n = async (sql: string, ...args: string[]) => Number(((await db.prepare(sql).get(...args)) as { n: number }).n);
  return {
    parent: await n('SELECT COUNT(*) AS n FROM sdt_parent WHERE id = ?', id),
    children: await n('SELECT COUNT(*) AS n FROM sdt_child WHERE parent_id = ?', id),
    grand: await n('SELECT COUNT(*) AS n FROM sdt_grandchild WHERE child_id = ?', `${id}_c1`),
    loose: await n('SELECT COUNT(*) AS n FROM sdt_loose WHERE subject_id = ?', id),
    refPointing: await n('SELECT COUNT(*) AS n FROM sdt_ref WHERE id = ? AND parent_id = ?', `${id}_r`, id),
  };
}

function trash(ws: string, id: string, purgeAt: Date, files: string[] = []) {
  return softDelete({
    workspaceId: ws,
    app: 'sdtest',
    kind: 'parent',
    recordId: id,
    label: `Label ${id}`,
    reason: 'inactivity',
    root: { table: 'sdt_parent' },
    extra: [{ table: 'sdt_loose', column: 'subject_id', values: [id] }],
    files,
    purgeAt,
    now: NOW,
  });
}

describe('plazos del borrado suave', () => {
  it('la gracia es de hasta 30 días y nunca más de un tercio del plazo', () => {
    expect(graceDaysFor(365)).toBe(SOFT_DELETE_GRACE_DAYS);
    expect(graceDaysFor(90)).toBe(30);
    expect(graceDaysFor(30)).toBe(10);
    expect(graceDaysFor(1)).toBe(0);
    expect(graceDaysFor(0)).toBe(0);
  });

  it('entra a la papelera antes del plazo y se purga en el plazo, nunca después', () => {
    const cutoff = new Date(NOW.getTime() - 90 * DAY);
    const plan = retentionPlan(cutoff, NOW);
    expect(plan.graceDays).toBe(30);
    expect(plan.trashBefore.toISOString()).toBe(new Date(cutoff.getTime() + 30 * DAY).toISOString());
    // Algo de hace 70 días (ya en la papelera): se purga a los 90, en 20 días.
    const base = new Date(NOW.getTime() - 70 * DAY);
    expect(plan.purgeAt(base).toISOString()).toBe(new Date(NOW.getTime() + 20 * DAY).toISOString());
    // Algo ya vencido se purga ya (no se le da más tiempo del prometido).
    expect(plan.purgeAt(new Date(NOW.getTime() - 200 * DAY)).toISOString()).toBe(NOW.toISOString());
    // Fechas en formato SQLite ("YYYY-MM-DD HH:MM:SS") se leen en UTC.
    expect(plan.purgeAt('2026-03-23 12:00:00').toISOString()).toBe('2026-06-21T12:00:00.000Z');
  });

  it('días que quedan', () => {
    expect(softDeleteDaysLeft(new Date(NOW.getTime() + 2.5 * DAY).toISOString(), NOW)).toBe(3);
    expect(softDeleteDaysLeft(new Date(NOW.getTime() - DAY).toISOString(), NOW)).toBe(0);
  });
});

describe('borrado suave', () => {
  it('saca el registro y lo que cuelga de él, y restaurar lo devuelve todo', async () => {
    const id = await seed('ws_a');
    const entry = await trash('ws_a', id, new Date(NOW.getTime() + 30 * DAY));
    expect(entry).toBeTruthy();
    expect(await counts(id)).toEqual({ parent: 0, children: 0, grand: 0, loose: 0, refPointing: 0 });
    // La referencia SET NULL quedó en NULL, no se borró.
    expect(await getDb().prepare('SELECT parent_id FROM sdt_ref WHERE id = ?').get(`${id}_r`)).toEqual({ parent_id: null });

    const list = await listSoftDeleted('ws_a', 'sdtest');
    const mine = list.find((e) => e.id === entry);
    expect(mine).toMatchObject({ recordId: id, kind: 'parent', label: `Label ${id}`, reason: 'inactivity' });
    // La lista no trae el contenido, solo la etiqueta.
    expect(JSON.stringify(mine)).not.toContain('one');

    // Dos veces el mismo registro: no hay segunda entrada.
    expect(await trash('ws_a', id, new Date(NOW.getTime() + 30 * DAY))).toBeNull();

    const res = await restoreSoftDeleted('ws_a', 'sdtest', entry!);
    expect(res.ok).toBe(true);
    expect(await counts(id)).toEqual({ parent: 1, children: 2, grand: 1, loose: 1, refPointing: 1 });
    expect(await getSoftDeleted('ws_a', 'sdtest', entry!)).toBeNull();
  });

  it('otro workspace no ve, no restaura ni purga la entrada', async () => {
    const id = await seed('ws_b');
    const entry = (await trash('ws_b', id, new Date(NOW.getTime() + 30 * DAY)))!;
    expect((await listSoftDeleted('ws_other', 'sdtest')).some((e) => e.id === entry)).toBe(false);
    expect(await restoreSoftDeleted('ws_other', 'sdtest', entry)).toEqual({ ok: false, reason: 'not_found' });
    expect(await restoreSoftDeleted('ws_b', 'other_app', entry)).toEqual({ ok: false, reason: 'not_found' });
    expect(await purgeSoftDeleted('ws_other', 'sdtest', entry)).toBe(false);
    expect(await getSoftDeleted('ws_b', 'sdtest', entry)).not.toBeNull();
  });

  it('si mientras tanto algo ocupó su lugar, restaurar devuelve conflict y la entrada queda', async () => {
    const id = await seed('ws_c');
    const entry = (await trash('ws_c', id, new Date(NOW.getTime() + 30 * DAY)))!;
    // Otro registro con el mismo email (único).
    await getDb().prepare('INSERT INTO sdt_parent (id, ws, name, email) VALUES (?, ?, ?, ?)').run(`${id}_new`, 'ws_c', 'New', `${id}@example.test`);
    expect(await restoreSoftDeleted('ws_c', 'sdtest', entry)).toEqual({ ok: false, reason: 'conflict' });
    expect(await getSoftDeleted('ws_c', 'sdtest', entry)).not.toBeNull();
    expect((await counts(id)).parent).toBe(0);
    // Liberado el lugar, se restaura.
    await getDb().prepare('DELETE FROM sdt_parent WHERE id = ?').run(`${id}_new`);
    expect((await restoreSoftDeleted('ws_c', 'sdtest', entry)).ok).toBe(true);
  });

  it('el cron purga solo lo vencido, una vez, y la entrada ya no se restaura', async () => {
    const due = await seed('ws_d');
    const later = await seed('ws_d');
    const dueEntry = (await trash('ws_d', due, new Date(NOW.getTime() - 1000), ['ref-a']))!;
    const laterEntry = (await trash('ws_d', later, new Date(NOW.getTime() + 5 * DAY)))!;
    const first = await purgeDueSoftDeleted(NOW);
    expect(first.purged).toBeGreaterThanOrEqual(1);
    expect(await getSoftDeleted('ws_d', 'sdtest', dueEntry)).toBeNull();
    expect(await getSoftDeleted('ws_d', 'sdtest', laterEntry)).not.toBeNull();
    expect(await restoreSoftDeleted('ws_d', 'sdtest', dueEntry)).toEqual({ ok: false, reason: 'not_found' });
    expect((await counts(due)).parent).toBe(0);
    // Segunda corrida: nada que purgar de este workspace.
    await purgeDueSoftDeleted(NOW);
    expect(await getSoftDeleted('ws_d', 'sdtest', laterEntry)).not.toBeNull();
    // Pasado su plazo, también se va.
    await purgeDueSoftDeleted(new Date(NOW.getTime() + 6 * DAY));
    expect(await getSoftDeleted('ws_d', 'sdtest', laterEntry)).toBeNull();
  });

  it('purgar a mano borra la entrada; los archivos quedan anotados para el borrado de cuenta', async () => {
    const id = await seed('ws_e');
    const entry = (await trash('ws_e', id, new Date(NOW.getTime() + 30 * DAY), ['ref-1', 'ref-1', 'ref-2']))!;
    const row = (await getDb().prepare('SELECT app, files FROM soft_deleted WHERE id = ?').get(entry)) as { app: string; files: string };
    expect(softDeletedFiles(row)).toEqual([
      { app: 'sdtest', ref: 'ref-1' },
      { app: 'sdtest', ref: 'ref-2' },
    ]);
    expect(await purgeSoftDeleted('ws_e', 'sdtest', entry)).toBe(true);
    expect(await getSoftDeleted('ws_e', 'sdtest', entry)).toBeNull();
    expect(await purgeSoftDeleted('ws_e', 'sdtest', entry)).toBe(false);
  });

  it('un registro que no existe no crea entrada', async () => {
    expect(await trash('ws_f', 'missing', new Date(NOW.getTime() + DAY))).toBeNull();
  });
});
