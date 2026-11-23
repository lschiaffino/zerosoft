/**
 * CRM: con reglas de score sobre un campo propio oculto, ordenar, filtrar,
 * contar o reportar por score usa el total que la persona ve (sin los puntos
 * de esas reglas), el mismo que se le muestra. Si no, el orden o un filtro
 * "score > N" dirían qué contactos cumplen la regla oculta. Miradas: anónimo,
 * otro workspace, miembro con el campo oculto, owner y admin. Datos inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createContact, createCustomField, createList } from '@/lib/crm';
import { MEMBER_SUBJECT, hiddenBreakdownPoints, setFieldPermissions, visibleScoreSql, type VisibleScoreRules } from '@/lib/crm-field-perms';
import { createScoreRule, listScores, recalcContactScore } from '@/lib/crm-scoring';
import { listForViewer, listsForViewer } from '@/lib/crm-list-access';
import { resolveMatching } from '@/lib/crm-list-matching';
import { runReport } from '@/lib/crm-custom-reports';
import { reportConfigSchema, type ReportRecordsResult } from '@/lib/crm-report-builder';
import { buildRecordContext } from '@/lib/crm-ai';
import { getDb } from '@/lib/db';
import { addMember } from '@/lib/teams';
import type { SessionUser } from '@/lib/session';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({
  ...((await orig()) as object),
  getCurrentUser: async () => session.user,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

const contactsRoute = await import('@/app/api/crm/contacts/route');

beforeEach(() => {
  session.user = null;
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const get = (url: string) => new NextRequest(`http://localhost${url}`);

/**
 * `hot`: cumple la regla sobre el campo oculto (+50) y nada más; `warm`: solo
 * la regla visible (+10). Guardados: hot 50, warm 10. Para el miembro: hot 0,
 * warm 10.
 */
async function setup(label: string) {
  const w = await workspaceWithMember(label);
  const ws = w.owner.id;
  const adminPerson = await makeUser(`${label}-admin`);
  await addMember(w.team.id, adminPerson.id, 'admin');
  const f = await createCustomField(ws, { entity: 'contacts', name: 'secret', label: 'Secret', type: 'text' });
  await setFieldPermissions(ws, f.id, [{ subject: MEMBER_SUBJECT, access: 'hidden' }]);
  await createScoreRule(ws, { kind: 'property', name: 'Hidden flag', config: { field: 'custom.secret', op: 'is_set', value: '' }, points: 50 });
  await createScoreRule(ws, { kind: 'property', name: 'Title', config: { field: 'jobTitle', op: 'equals', value: 'CEO' }, points: 10 });
  const hot = await createContact(ws, { firstName: 'Hot', email: `hot-${label}@client.test`, custom: { secret: 'x' } });
  const warm = await createContact(ws, { firstName: 'Warm', email: `warm-${label}@client.test`, jobTitle: 'CEO' });
  await recalcContactScore(ws, hot.id);
  await recalcContactScore(ws, warm.id);
  const primary = (await listScores(ws)).find((s) => s.isPrimary)!;
  return { w, ws, adminPerson, hot, warm, primary };
}
type Setup = Awaited<ReturnType<typeof setup>>;
const owner = (s: Setup) => asOwner(s.w.owner);
const admin = (s: Setup) => asMember(s.w.owner, s.adminPerson, 'admin');
const member = (s: Setup) => asMember(s.w.owner, s.w.member);
const stranger = (s: Setup) => asOwner(s.w.stranger);
const filterParam = (f: string, v: string) => encodeURIComponent(JSON.stringify({ v: 1, groups: [{ rules: [{ f, o: 'gt', v }] }] }));

async function listIds(user: SessionUser | null, query: string): Promise<{ status: number; ids: string[]; scores: number[] }> {
  session.user = user;
  const res = await contactsRoute.GET(get(`/api/crm/contacts?${query}`));
  if (res.status !== 200) return { status: res.status, ids: [], scores: [] };
  const rows = ((await res.json()) as { rows: Array<{ id: string; score: number }> }).rows;
  return { status: 200, ids: rows.map((r) => r.id), scores: rows.map((r) => r.score) };
}

describe('orden y filtros por score con el total que ve cada persona', () => {
  it('anónimo no lista y otro workspace no ve los contactos', async () => {
    const s = await setup('vscore-anon');
    expect((await listIds(null, 'sort=score')).status).toBe(401);
    const other = await listIds(stranger(s), 'sort=score');
    expect(other.ids).not.toContain(s.hot.id);
    expect(other.ids).not.toContain(s.warm.id);
  });

  it('owner y admin ordenan y filtran por el total guardado', async () => {
    const s = await setup('vscore-own');
    for (const u of [owner(s), admin(s)]) {
      const sorted = await listIds(u, 'sort=score');
      expect(sorted.ids.indexOf(s.hot.id)).toBeLessThan(sorted.ids.indexOf(s.warm.id));
      expect((await listIds(u, `filters=${filterParam('score', '20')}`)).ids).toEqual([s.hot.id]);
      expect((await listIds(u, `filters=${filterParam(`score:${s.primary.id}`, '20')}`)).ids).toEqual([s.hot.id]);
    }
  });

  it('un miembro con el campo oculto ordena y filtra por el total que ve', async () => {
    const s = await setup('vscore-mem');
    const sorted = await listIds(member(s), 'sort=score');
    // El de la regla visible primero: el oculto no lo sube.
    expect(sorted.ids.indexOf(s.warm.id)).toBeLessThan(sorted.ids.indexOf(s.hot.id));
    expect(sorted.scores[sorted.ids.indexOf(s.hot.id)]).toBe(0);
    const asc = await listIds(member(s), 'sort=score_asc');
    expect(asc.ids.indexOf(s.hot.id)).toBeLessThan(asc.ids.indexOf(s.warm.id));
    // "score > 20" no encuentra al que solo suma por la regla oculta; "> 5" encuentra al de la visible.
    expect((await listIds(member(s), `filters=${filterParam('score', '20')}`)).ids).toEqual([]);
    expect((await listIds(member(s), `filters=${filterParam(`score:${s.primary.id}`, '20')}`)).ids).toEqual([]);
    expect((await listIds(member(s), `filters=${filterParam('score', '5')}`)).ids).toEqual([s.warm.id]);
  });

  it('"seleccionar todos los que coinciden" usa el mismo total', async () => {
    const s = await setup('vscore-match');
    const q = `sort=score&filters=${filterParam('score', '20')}`;
    expect(await resolveMatching(member(s), 'contacts', q, 100)).toEqual({ ids: [], total: 0 });
    expect(await resolveMatching(owner(s), 'contacts', q, 100)).toEqual({ ids: [s.hot.id], total: 1 });
  });

  it('una lista dinámica por score cuenta y muestra según quien mira', async () => {
    const s = await setup('vscore-list');
    const list = await createList(s.ws, { name: 'Hot leads', kind: 'dynamic', filter: { filters: [{ f: 'score', o: 'gt', v: '20' }] } });
    const viewer = (personId: string, role: SessionUser['role']) => ({ workspaceId: s.ws, personId, role });
    const mine = await listForViewer(viewer(s.w.member.id, 'member'), list.id, null);
    expect(mine?.members.map((m) => m.id)).toEqual([]);
    expect(mine?.memberCount).toBe(0);
    expect((await listsForViewer(viewer(s.w.member.id, 'member'), null)).find((l) => l.id === list.id)?.memberCount).toBe(0);
    const owners = await listForViewer(viewer(s.ws, 'owner'), list.id, null);
    expect(owners?.members.map((m) => m.id)).toEqual([s.hot.id]);
    expect((await listsForViewer(viewer(s.adminPerson.id, 'admin'), null)).find((l) => l.id === list.id)?.memberCount).toBe(1);
  });

  it('un reporte de contactos muestra y filtra el score que ve quien lo corre', async () => {
    const s = await setup('vscore-report');
    const config = reportConfigSchema.parse({ source: 'contacts', columns: ['contact.name', 'contact.score'], filters: [{ f: 'contact.score', o: 'gt', v: '20' }] });
    const run = async (personId: string, role: SessionUser['role']) =>
      (await runReport(s.ws, config, { viewer: { workspaceId: s.ws, personId, role } })) as ReportRecordsResult;
    expect((await run(s.w.member.id, 'member')).rows).toEqual([]);
    const own = await run(s.ws, 'owner');
    expect(own.rows.map((r) => r.id)).toEqual([s.hot.id]);
    expect(own.rows[0].cells[1]).toBe(50);
    const all = (await runReport(s.ws, reportConfigSchema.parse({ source: 'contacts', columns: ['contact.score'] }), {
      viewer: { workspaceId: s.ws, personId: s.w.member.id, role: 'member' },
    })) as ReportRecordsResult;
    expect(all.rows.find((r) => r.id === s.hot.id)?.cells[0]).toBe(0);
    expect(all.rows.find((r) => r.id === s.warm.id)?.cells[0]).toBe(10);
  });

  it('el contexto de la IA (lo lee cualquiera que ve el registro) no suma la regla oculta', async () => {
    const s = await setup('vscore-ai');
    const hot = await buildRecordContext(s.ws, 'contact', s.hot.id, null);
    expect(hot?.lines.join('\n')).not.toContain('lead score 50');
    const warm = await buildRecordContext(s.ws, 'contact', s.warm.id, null);
    expect(warm?.lines.join('\n')).toContain('lead score 10');
  });
});

describe('visibleScoreSql: la misma cuenta que hiddenBreakdownPoints', () => {
  const rules: VisibleScoreRules = new Map([
    ['rule-a', 'property'],
    ['rule-b', 'activity'],
  ]);
  const cases: Array<[number, string]> = [
    [30, JSON.stringify([{ ruleId: 'rule-a', points: 10 }, { ruleId: 'rule-x', points: 20 }])],
    [15, JSON.stringify([{ ruleId: 'rule-b', points: 5, detail: '2 / 30d' }, { points: 10 }])],
    [7, JSON.stringify([{ ruleId: 3, points: 7 }])],
    [9, JSON.stringify(['text', 4, null, { ruleId: 'rule-z', points: '9' }])],
    [5, 'not json'],
    [5, '{"ruleId":"rule-x","points":5}'],
    [12, '[]'],
  ];
  it.each(cases)('score %s con desglose %s', async (score, breakdown) => {
    const sql = `WITH t(score, bd) AS (VALUES (?, ?)) SELECT ${visibleScoreSql('t.score', 't.bd', rules)} AS v FROM t`;
    const row = (await getDb().prepare(sql).get(score, breakdown)) as { v: number };
    let items: unknown = [];
    try {
      items = JSON.parse(breakdown);
    } catch {
      items = [];
    }
    expect(Number(row.v)).toBe(score - hiddenBreakdownPoints(items, rules));
  });

  it('sin reglas (sin campos ocultos) es la columna tal cual; sin reglas visibles resta todo', async () => {
    expect(visibleScoreSql('c.score', 'c.score_breakdown', undefined)).toBe('c.score');
    const sql = `WITH t(score, bd) AS (VALUES (?, ?)) SELECT ${visibleScoreSql('t.score', 't.bd', new Map())} AS v FROM t`;
    const row = (await getDb().prepare(sql).get(30, JSON.stringify([{ ruleId: 'rule-a', points: 30 }]))) as { v: number };
    expect(Number(row.v)).toBe(0);
  });
});
