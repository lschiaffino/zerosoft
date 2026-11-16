import { beforeAll, describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import { createPostsBulk, listPosts, saveDiscoveredAccounts, type SocialActor } from '@/lib/social';
import { BULK_MAX_ROWS, bulkExampleCsv, bulkPostText, bulkRowIssues, parseBulkCsv, parseDate, parseTime } from '@/lib/social-bulk';
import { makeUser } from './helpers';

process.env.SOCIAL_FAKE = '1';

const NOW = new Date('2026-11-16T12:00:00Z');
const opts = { tz: 'America/Argentina/Buenos_Aires', dayFirst: true, now: NOW };

describe('CSV de programación masiva: lectura', () => {
  it('lee horas en 24 h y en am/pm', () => {
    expect(parseTime('09:30')).toBe(570);
    expect(parseTime('9:30 PM')).toBe(21 * 60 + 30);
    expect(parseTime('12am')).toBe(0);
    expect(parseTime('12:15 p.m.')).toBe(12 * 60 + 15);
    expect(parseTime('25:00')).toBeNull();
    expect(parseTime('hola')).toBeNull();
  });

  it('lee fechas ISO y con barras según el orden elegido', () => {
    expect(parseDate('2026-11-20', true)).toEqual([2026, 11, 20, null]);
    expect(parseDate('2026-11-20T09:30', true)).toEqual([2026, 11, 20, 570]);
    expect(parseDate('20/11/2026 18:00', true)).toEqual([2026, 11, 20, 1080]);
    expect(parseDate('11/20/2026', false)).toEqual([2026, 11, 20, null]);
    expect(parseDate('31/02/2026', true)).toBeNull();
    expect(parseDate('20/11/2026', false)).toBeNull();
  });

  it('con encabezado en español, en cualquier orden, y la hora en la zona de la persona', () => {
    const csv = 'Texto,Fecha,Hora,Link\n"Lanzamiento, por fin",20/11/2026,09:30,https://example.com\n';
    const { rows } = parseBulkCsv(csv, opts);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ line: 2, text: 'Lanzamiento, por fin', linkUrl: 'https://example.com', errors: [] });
    // 09:30 en Buenos Aires (UTC-3) son las 12:30 UTC.
    expect(rows[0].scheduledAt).toBe('2026-11-20T12:30:00.000Z');
  });

  it('sin encabezado: fecha, hora, texto, link o fecha, texto, link', () => {
    expect(parseBulkCsv('20/11/2026,10:00,Hola\n', opts).rows[0]).toMatchObject({ line: 1, text: 'Hola', errors: [] });
    expect(parseBulkCsv('2026-11-20 10:00,Hola,https://a.com\n', opts).rows[0]).toMatchObject({ text: 'Hola', linkUrl: 'https://a.com', errors: [] });
  });

  it('acepta punto y coma (Excel en es y pt) con comas dentro del texto', () => {
    const { rows } = parseBulkCsv('fecha;hora;texto\n20/11/2026;10:00;Hola, mundo\n21/11/2026;11:00;"Con ""comillas""; y punto y coma"\n', opts);
    expect(rows.map((r) => r.text)).toEqual(['Hola, mundo', 'Con "comillas"; y punto y coma']);
    expect(rows.every((r) => r.errors.length === 0)).toBe(true);
  });

  it('marca cada problema en su fila', () => {
    const csv = ['date,time,text,link', '2026-11-01,10:00,Pasada,', '2026-11-20,,Sin hora,', '2026-11-20,10:00,,', '2026-11-20,10:00,Link roto,notaurl', 'mañana,10:00,Fecha rara,'].join('\n');
    const rows = parseBulkCsv(csv, opts).rows;
    expect(rows.map((r) => [r.line, r.errors])).toEqual([
      [2, ['date_in_past']],
      [3, ['date_invalid']],
      [4, ['text_empty']],
      [5, ['link_invalid']],
      [6, ['date_invalid']],
    ]);
  });

  it(`corta en ${BULK_MAX_ROWS} filas y dice cuántas quedaron afuera`, () => {
    const lines = Array.from({ length: BULK_MAX_ROWS + 5 }, (_, i) => `2026-12-01,10:00,Post ${i}`);
    const out = parseBulkCsv(lines.join('\n'), opts);
    expect(out.rows).toHaveLength(BULK_MAX_ROWS);
    expect(out.skipped).toBe(5);
  });

  it('el link va al final si el texto no lo trae, y se valida el largo por red', () => {
    expect(bulkPostText({ text: 'Hola', linkUrl: 'https://a.com' })).toBe('Hola\n\nhttps://a.com');
    expect(bulkPostText({ text: 'Mirá https://a.com', linkUrl: 'https://a.com' })).toBe('Mirá https://a.com');
    const [row] = parseBulkCsv(`2026-11-20,10:00,${'a'.repeat(300)}`, opts).rows;
    expect(bulkRowIssues(row, [{ id: 'x1', network: 'x' }, { id: 'f1', network: 'facebook' }]).map((i) => [i.accountId, i.issues[0].code])).toEqual([['x1', 'too_long']]);
  });

  it('el ejemplo se lee sin errores', () => {
    const rows = parseBulkCsv(bulkExampleCsv(false, NOW), { ...opts, dayFirst: false }).rows;
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.errors.length === 0)).toBe(true);
  });
});

describe('CSV de programación masiva: servidor', () => {
  let owner: SocialActor;
  let other: SocialActor;
  let fb: string;

  beforeAll(async () => {
    const o = await makeUser('bulk-owner');
    const x = await makeUser('bulk-other');
    owner = { workspaceId: o.id, personId: o.id, role: 'owner' };
    other = { workspaceId: x.id, personId: x.id, role: 'owner' };
    [fb] = await saveDiscoveredAccounts(o.id, o.id, [{ network: 'facebook', kind: 'page', externalId: `p-${o.id}`, name: 'Page', tokens: { accessToken: 'tok', expiresAt: null } }]);
  });

  it('programa todas las filas o ninguna si una no pasa', async () => {
    const at = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
    await expect(
      createPostsBulk(owner, { accountIds: [fb], action: 'schedule', rows: [{ text: 'Uno', scheduledAt: at(1) }, { text: 'Dos', scheduledAt: at(-1) }] }),
    ).rejects.toMatchObject({ status: 400, code: 'date_in_past', details: { row: 1 } });
    expect(await listPosts(owner, {})).toHaveLength(0);
    const { ids } = await createPostsBulk(owner, { accountIds: [fb], action: 'schedule', rows: [{ text: 'Uno', scheduledAt: at(1) }, { text: 'Dos', linkUrl: 'https://a.com', scheduledAt: at(2) }] });
    expect(ids).toHaveLength(2);
    const posts = await listPosts(owner, {});
    expect(posts.map((p) => [p.text, p.status]).sort()).toEqual([
      ['Dos\n\nhttps://a.com', 'scheduled'],
      ['Uno', 'scheduled'],
    ]);
    const events = await getDb().prepare("SELECT COUNT(*) AS n FROM social_post_events WHERE post_id IN (?, ?) AND kind = 'scheduled'").get(ids[0], ids[1]) as { n: number };
    expect(Number(events.n)).toBe(2);
  });

  it('no deja usar cuentas de otro workspace', async () => {
    await expect(createPostsBulk(other, { accountIds: [fb], action: 'schedule', rows: [{ text: 'X', scheduledAt: new Date(Date.now() + 86_400_000).toISOString() }] })).rejects.toMatchObject({ status: 403 });
  });

  it('como borradores acepta filas sin fecha', async () => {
    const { ids } = await createPostsBulk(owner, { accountIds: [fb], action: 'draft', rows: [{ text: 'Borrador', scheduledAt: null }] });
    const posts = await listPosts(owner, { status: 'draft' });
    expect(posts.find((p) => p.id === ids[0])?.text).toBe('Borrador');
  });
});
