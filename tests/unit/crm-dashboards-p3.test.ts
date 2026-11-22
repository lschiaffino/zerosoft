/**
 * CRM Dashboards (P3): biblioteca de reportes, filtros, drill-down y acceso.
 * Cada total y cada lista de registros cuenta solo lo que quien mira ve, y
 * un campo oculto no entra en ningún reporte. Miradas: anónimo, otro
 * workspace, miembro con alcance "mine", miembro con un campo de monto
 * oculto, miembro de un equipo de ventas y owner. Datos inventados.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createCustomField, createDeal, createPipeline, createStage, createContact, moveDeal, updateStage } from '@/lib/crm';
import { MEMBER_SUBJECT, setFieldPermissions } from '@/lib/crm-field-perms';
import { createSalesTeam, setMemberVisibility } from '@/lib/crm-visibility';
import { createCustomReport } from '@/lib/crm-custom-reports';
import { reportConfigSchema } from '@/lib/crm-report-builder';
import {
  bucketBounds,
  bucketKeys,
  legacyReportKey,
  LIBRARY,
  resolveRange,
  sizeFromCols,
  SALES_TEMPLATE,
} from '@/lib/crm-dashboard-library';
import { dashboardRights, ensureStarterDashboard, listVisibleDashboards } from '@/lib/crm-dashboards';
import type { TileData } from '@/lib/crm-dashboards-schema';
import type { DrillResult } from '@/lib/crm-dashboard-library';
import type { SessionUser } from '@/lib/session';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({
  ...((await orig()) as object),
  getCurrentUser: async () => session.user,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

const listRoute = await import('@/app/api/crm/dashboards/route');
const dashRoute = await import('@/lib/routes/crm/dashboards/[id]/route');
const widgetsRoute = await import('@/lib/routes/crm/dashboards/[id]/widgets/route');
const widgetRoute = await import('@/lib/routes/crm/dashboards/widgets/[widgetId]/route');
const dataRoute = await import('@/app/api/crm/dashboards/data/route');
const drillRoute = await import('@/app/api/crm/dashboards/drill/route');

beforeEach(() => {
  session.user = null;
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const wctx = (widgetId: string) => ({ params: Promise.resolve({ widgetId }) });
const send = (method: string, body: unknown) =>
  body === null
    ? new NextRequest('http://x', { method })
    : new NextRequest('http://x', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const json = async <T,>(res: Response) => (await res.json()) as T;

// ---------- Funciones puras ----------

describe('rangos y períodos', () => {
  const now = new Date('2026-11-18T15:00:00Z'); // miércoles

  it('presets calendario y su período anterior', () => {
    expect(resolveRange({ range: 'this_month' }, now)).toMatchObject({ from: '2026-11-01', to: '2026-11-30', prevFrom: '2026-10-01', prevTo: '2026-10-31' });
    expect(resolveRange({ range: 'this_week' }, now)).toMatchObject({ from: '2026-11-16', to: '2026-11-22', prevFrom: '2026-11-09', prevTo: '2026-11-15', bucket: 'day' });
    expect(resolveRange({ range: 'last_quarter' }, now)).toMatchObject({ from: '2026-07-01', to: '2026-09-30', prevFrom: '2026-04-01', prevTo: '2026-06-30' });
    expect(resolveRange({ range: 'this_year' }, now)).toMatchObject({ from: '2026-01-01', to: '2026-12-31', bucket: 'month' });
    expect(resolveRange({ range: 'today' }, now)).toMatchObject({ from: '2026-11-18', to: '2026-11-18', prevFrom: '2026-11-17', prevTo: '2026-11-17' });
  });

  it('últimos N días y personalizado (al revés se ordena; incompleto cae a 30 días)', () => {
    expect(resolveRange({ range: 'last_7' }, now)).toMatchObject({ from: '2026-11-12', to: '2026-11-18', prevFrom: '2026-11-05', prevTo: '2026-11-11' });
    expect(resolveRange({ range: 'custom', from: '2026-03-10', to: '2026-03-01' }, now)).toMatchObject({ from: '2026-03-01', to: '2026-03-10', days: 10 });
    expect(resolveRange({ range: 'custom', from: 'nope' }, now)).toMatchObject({ from: '2026-10-20', to: '2026-11-18' });
  });

  it('claves de período sin huecos y sus límites para el drill-down', () => {
    const r = resolveRange({ range: 'this_month' }, now);
    expect(r.bucket).toBe('week');
    const keys = bucketKeys(r);
    expect(keys[0]).toBe('2026-W43');
    expect(keys.length).toBe(6);
    expect(bucketBounds('2026-W44', r)).toEqual({ from: '2026-11-02', to: '2026-11-08' });
    // Recorta al rango.
    expect(bucketBounds('2026-W43', r)).toEqual({ from: '2026-11-01', to: '2026-11-01' });
    expect(bucketBounds('2026-11', { from: '2026-11-05', to: '2026-12-31' })).toEqual({ from: '2026-11-05', to: '2026-11-30' });
    expect(bucketBounds('2026-Q2', { from: '2026-01-01', to: '2026-12-31' })).toEqual({ from: '2026-04-01', to: '2026-06-30' });
    expect(bucketBounds('garbage', r)).toBeNull();
  });

  it('biblioteca, tamaños y widgets de antes', () => {
    expect(new Set(LIBRARY.map((r) => r.key)).size).toBe(LIBRARY.length);
    for (const t of SALES_TEMPLATE) expect(LIBRARY.some((r) => r.key === t.reportKey)).toBe(true);
    expect(SALES_TEMPLATE).toHaveLength(12);
    expect([sizeFromCols(3), sizeFromCols(6), sizeFromCols(12)]).toEqual(['small', 'medium', 'wide']);
    expect(legacyReportKey('kpi', { metric: 'wonAmount' })).toBe('revenue_won_kpi');
    expect(legacyReportKey('funnel', {})).toBe('conversion_funnel');
    expect(legacyReportKey('custom_report', {})).toBeNull();
  });

  it('derechos sobre un dashboard', () => {
    const ws = 'ws';
    const v = (personId: string, role: SessionUser['role'] = 'member') => ({ workspaceId: ws, personId, role });
    const row = (o: Partial<{ owner_id: string | null; visibility: string; team_id: string | null; access: string }>) => ({
      user_id: ws,
      owner_id: 'ana',
      visibility: 'private',
      team_id: null,
      access: 'edit',
      ...o,
    });
    const none = new Set<string>();
    expect(dashboardRights(row({}), v('ana'), none)).toMatchObject({ canView: true, canManage: true });
    expect(dashboardRights(row({}), v('bob'), none).canView).toBe(false);
    // Un privado no lo ve ni un admin.
    expect(dashboardRights(row({}), v('adm', 'admin'), none).canView).toBe(false);
    expect(dashboardRights(row({ visibility: 'team', team_id: 't1' }), v('bob'), none).canView).toBe(false);
    expect(dashboardRights(row({ visibility: 'team', team_id: 't1' }), v('bob'), new Set(['t1']))).toMatchObject({ canView: true, canEdit: true, canManage: false });
    expect(dashboardRights(row({ visibility: 'everyone', access: 'view' }), v('bob'), none)).toMatchObject({ canView: true, canEdit: false });
    expect(dashboardRights(row({ visibility: 'everyone', access: 'view' }), v('adm', 'admin'), none)).toMatchObject({ canEdit: true, canManage: true });
    // Los de antes (sin dueño) son del dueño del workspace.
    expect(dashboardRights(row({ owner_id: null }), v(ws, 'owner'), none).isOwner).toBe(true);
    expect(dashboardRights({ ...row({ visibility: 'everyone' }), user_id: 'other' }, v('bob'), none).canView).toBe(false);
  });
});

// ---------- Datos reales ----------

/**
 * Workspace con visibilidad "mine": el owner tiene 2 deals ganados por 1000
 * y 2000 y uno abierto por 5000; member tiene uno ganado por 300 y uno
 * abierto por 700. `arr` (monto propio de deals) está oculto para member.
 */
async function setup(label: string) {
  const w = await workspaceWithMember(label);
  const ws = w.owner.id;
  await setMemberVisibility(ws, 'mine');
  const arr = await createCustomField(ws, { entity: 'deals', name: 'arr', label: 'ARR', type: 'number' });
  await setFieldPermissions(ws, arr.id, [{ subject: MEMBER_SUBJECT, access: 'hidden' }]);
  const p = await createPipeline(ws, 'Sales');
  const open = (await createStage(ws, p.id, { name: 'Qualified', probability: 20 }))!;
  const won = (await createStage(ws, p.id, { name: 'Won', probability: 100 }))!;
  await updateStage(ws, won.id, { isWon: true });
  const deal = async (name: string, ownerId: string, amount: number, isWon: boolean, custom: Record<string, unknown> = {}) => {
    const r = await createDeal(ws, { name, pipelineId: p.id, stageId: open.id, ownerId, amount, custom });
    if (!r.ok) throw new Error('deal');
    if (isWon) await moveDeal(ws, r.deal.id, won.id);
    return r.deal;
  };
  await deal('Owner won A', ws, 1000, true, { arr: 777001 });
  await deal('Owner won B', ws, 2000, true, { arr: 777002 });
  await deal('Owner open', ws, 5000, false, { arr: 777003 });
  await deal('Member won', w.member.id, 300, true, { arr: 777004 });
  await deal('Member open', w.member.id, 700, false, { arr: 777005 });
  await createContact(ws, { firstName: 'Ana', lastName: 'Owner', ownerId: ws, source: 'ads' });
  await createContact(ws, { firstName: 'Bo', lastName: 'Member', ownerId: w.member.id, source: 'referral' });
  const team = await createSalesTeam(ws, { name: 'Field', members: [w.friend.id] });
  return { w, ws, p, open, won, team };
}

type Setup = Awaited<ReturnType<typeof setup>>;
const owner = (s: Setup) => asOwner(s.w.owner);
const member = (s: Setup) => asMember(s.w.owner, s.w.member);
const friend = (s: Setup) => asMember(s.w.owner, s.w.friend);
const stranger = (s: Setup) => asOwner(s.w.stranger);

async function as<T>(user: SessionUser | null, fn: () => Promise<T>): Promise<T> {
  session.user = user;
  return fn();
}

async function makeDashboard(s: Setup, body: Record<string, unknown> = {}) {
  const res = await as(owner(s), () => listRoute.POST(send('POST', { name: 'Sales', template: 'sales', visibility: 'everyone', ...body })));
  expect(res.status).toBe(201);
  return json<{ id: string; widgets: Array<{ id: string; type: string; config: string }> }>(res);
}

const widgetOf = (d: { widgets: Array<{ id: string; config: string }> }, key: string) =>
  d.widgets.find((w) => JSON.parse(w.config).reportKey === key)!.id;

async function tiles(user: SessionUser | null, dashboardId: string, filters: Record<string, unknown> = { range: 'last_30' }) {
  session.user = user;
  return dataRoute.POST(send('POST', { dashboardId, filters }));
}

async function drill(user: SessionUser | null, dashboardId: string, widgetId: string, segment: Record<string, unknown> = {}) {
  session.user = user;
  return drillRoute.POST(send('POST', { dashboardId, widgetId, filters: { range: 'last_30' }, segment }));
}

describe('acceso a dashboards y sus datos', () => {
  it('anónimo: 401 en todo', async () => {
    const s = await setup('p3-anon');
    const d = await makeDashboard(s);
    session.user = null;
    expect((await listRoute.GET()).status).toBe(401);
    expect((await listRoute.POST(send('POST', { name: 'x' }))).status).toBe(401);
    expect((await dashRoute.GET(send('GET', null), ctx(d.id))).status).toBe(401);
    expect((await dashRoute.PATCH(send('PATCH', { name: 'x' }), ctx(d.id))).status).toBe(401);
    expect((await widgetsRoute.POST(send('POST', { type: 'library', config: { reportKey: 'deals_created' } }), ctx(d.id))).status).toBe(401);
    expect((await widgetRoute.DELETE(send('DELETE', null), wctx(d.widgets[0].id))).status).toBe(401);
    expect((await tiles(null, d.id)).status).toBe(401);
    expect((await drill(null, d.id, d.widgets[0].id)).status).toBe(401);
  });

  it('otro workspace: no lo ve, no lo toca y no lee sus datos (404)', async () => {
    const s = await setup('p3-other');
    const d = await makeDashboard(s);
    const x = stranger(s);
    const list = await as(x, async () => json<{ rows: Array<{ id: string }> }>(await listRoute.GET()));
    expect(list.rows.some((r) => r.id === d.id)).toBe(false);
    expect((await as(x, () => dashRoute.GET(send('GET', null), ctx(d.id)))).status).toBe(404);
    expect((await as(x, () => dashRoute.PATCH(send('PATCH', { name: 'Hacked' }), ctx(d.id)))).status).toBe(404);
    expect((await as(x, () => dashRoute.DELETE(send('DELETE', null), ctx(d.id)))).status).toBe(404);
    expect((await as(x, () => widgetRoute.PATCH(send('PATCH', { size: 'wide' }), wctx(d.widgets[0].id)))).status).toBe(404);
    expect((await as(x, () => widgetsRoute.POST(send('POST', { type: 'library', config: { reportKey: 'deals_created' } }), ctx(d.id)))).status).toBe(404);
    expect((await tiles(x, d.id)).status).toBe(404);
    expect((await drill(x, d.id, d.widgets[0].id)).status).toBe(404);
    // Tampoco lo clona.
    expect((await as(x, () => listRoute.POST(send('POST', { name: 'Copy', cloneFrom: d.id })))).status).toBe(404);
  });

  it('privado, de un equipo y de todos; solo mirar vs editar', async () => {
    const s = await setup('p3-share');
    const priv = await makeDashboard(s, { visibility: 'private', name: 'Mine' });
    const ids = async (u: SessionUser) => (await as(u, async () => json<{ rows: Array<{ id: string }> }>(await listRoute.GET()))).rows.map((r) => r.id);
    expect(await ids(member(s))).not.toContain(priv.id);
    expect((await tiles(member(s), priv.id)).status).toBe(404);

    // Al equipo de friend: friend lo ve, member no.
    const shared = await as(owner(s), () => dashRoute.PATCH(send('PATCH', { visibility: 'team', teamId: s.team.id, access: 'view' }), ctx(priv.id)));
    expect(shared.status).toBe(200);
    expect(await ids(friend(s))).toContain(priv.id);
    expect(await ids(member(s))).not.toContain(priv.id);
    // Un equipo de otro workspace no vale.
    const otherTeam = await createSalesTeam(s.w.stranger.id, { name: 'X' });
    expect((await as(owner(s), () => dashRoute.PATCH(send('PATCH', { teamId: otherTeam.id }), ctx(priv.id)))).status).toBe(400);

    // Solo mirar: friend no edita ni comparte, pero sí elige su default y ve los datos.
    expect((await as(friend(s), () => dashRoute.PATCH(send('PATCH', { name: 'Mine now' }), ctx(priv.id)))).status).toBe(403);
    expect((await as(friend(s), () => dashRoute.PATCH(send('PATCH', { visibility: 'everyone' }), ctx(priv.id)))).status).toBe(403);
    expect((await as(friend(s), () => widgetRoute.DELETE(send('DELETE', null), wctx(priv.widgets[0].id)))).status).toBe(403);
    expect((await as(friend(s), () => dashRoute.DELETE(send('DELETE', null), ctx(priv.id)))).status).toBe(403);
    expect((await as(friend(s), () => dashRoute.PATCH(send('PATCH', { isDefault: true }), ctx(priv.id)))).status).toBe(200);
    expect((await tiles(friend(s), priv.id)).status).toBe(200);
    const friendView = await listVisibleDashboards({ workspaceId: s.ws, personId: s.w.friend.id, role: 'member' });
    expect(friendView.find((d) => d.id === priv.id)).toMatchObject({ isDefault: true, canEdit: false, canManage: false });

    // Con acceso de edición, mueve y cambia tiles pero no el acceso.
    await as(owner(s), () => dashRoute.PATCH(send('PATCH', { access: 'edit' }), ctx(priv.id)));
    expect((await as(friend(s), () => widgetRoute.PATCH(send('PATCH', { size: 'wide' }), wctx(priv.widgets[4].id)))).status).toBe(200);
    expect((await as(friend(s), () => dashRoute.PATCH(send('PATCH', { access: 'view' }), ctx(priv.id)))).status).toBe(403);

    // Owner: clona (la copia es privada y suya), borra.
    const clone = await as(owner(s), async () => json<{ id: string; visibility: string; widgets: unknown[] }>(await listRoute.POST(send('POST', { name: 'Copy', cloneFrom: priv.id }))));
    expect(clone.visibility).toBe('private');
    expect(clone.widgets).toHaveLength(12);
    expect((await as(owner(s), () => dashRoute.DELETE(send('DELETE', null), ctx(clone.id)))).status).toBe(204);
  });

  it('un workspace nuevo arranca con el dashboard Sales una sola vez', async () => {
    const s = await setup('p3-starter');
    const v = { workspaceId: s.ws, personId: s.ws, role: 'owner' as const };
    await ensureStarterDashboard(v, 'Sales');
    await ensureStarterDashboard(v, 'Sales');
    const list = await listVisibleDashboards(v);
    expect(list).toHaveLength(1);
    expect(list[0].widgets).toHaveLength(12);
    // Visible para todos: member lo ve con sus datos.
    expect((await listVisibleDashboards({ workspaceId: s.ws, personId: s.w.member.id, role: 'member' })).map((d) => d.id)).toEqual([list[0].id]);
  });
});

describe('los totales cuentan solo lo que quien mira ve', () => {
  it('owner ve todo; member con alcance "mine" ve solo lo suyo en el mismo dashboard compartido', async () => {
    const s = await setup('p3-scope');
    const d = await makeDashboard(s);
    const ownerTiles = (await json<{ tiles: Record<string, TileData> }>(await tiles(owner(s), d.id))).tiles;
    const memberTiles = (await json<{ tiles: Record<string, TileData> }>(await tiles(member(s), d.id))).tiles;

    const kpi = (t: Record<string, TileData>, key: string) => {
      const x = t[widgetOf(d, key)];
      if (x.kind !== 'kpi') throw new Error(x.kind);
      return x.value;
    };
    expect(kpi(ownerTiles, 'revenue_won_kpi')).toBe(3300);
    expect(kpi(memberTiles, 'revenue_won_kpi')).toBe(300);
    expect(kpi(ownerTiles, 'deals_created_kpi')).toBe(5);
    expect(kpi(memberTiles, 'deals_created_kpi')).toBe(2);

    const stage = (t: Record<string, TileData>) => {
      const x = t[widgetOf(d, 'pipeline_by_stage')];
      if (x.kind !== 'chart') throw new Error(x.kind);
      return x.total;
    };
    expect(stage(ownerTiles)).toBe(5700);
    expect(stage(memberTiles)).toBe(700);

    const byOwner = memberTiles[widgetOf(d, 'deals_won_lost_by_owner')];
    if (byOwner.kind !== 'chart') throw new Error(byOwner.kind);
    expect(byOwner.categories.map((c) => c.key)).toEqual([s.w.member.id]);

    // Ni un nombre de deal ajeno ni el valor del campo oculto viajan en la respuesta.
    const raw = JSON.stringify(memberTiles);
    expect(raw).not.toContain('Owner won');
    expect(raw).not.toContain('Owner open');
    expect(raw).not.toMatch(/77700\d/);

    // Drill-down: los registros detrás del número, solo los visibles.
    const ownerDrill = await json<DrillResult>(await drill(owner(s), d.id, widgetOf(d, 'revenue_won_kpi')));
    expect(ownerDrill.total).toBe(3);
    const memberDrill = await json<DrillResult>(await drill(member(s), d.id, widgetOf(d, 'revenue_won_kpi')));
    expect(memberDrill.rows.map((r) => r.name)).toEqual(['Member won']);
    expect(memberDrill.sum).toBe(300);
    const stageDrill = await json<DrillResult>(await drill(member(s), d.id, widgetOf(d, 'pipeline_by_stage'), { category: s.open.id }));
    expect(stageDrill.rows.map((r) => r.name)).toEqual(['Member open']);
    const sourceDrill = await json<DrillResult>(await drill(member(s), d.id, widgetOf(d, 'new_contacts_by_source'), { category: 'ads' }));
    expect(sourceDrill.total).toBe(0);
  });

  it('filtros del dashboard: owner, equipo y un pipeline ajeno', async () => {
    const s = await setup('p3-filters');
    const d = await makeDashboard(s);
    const won = async (u: SessionUser, filters: Record<string, unknown>) => {
      const t = (await json<{ tiles: Record<string, TileData> }>(await tiles(u, d.id, filters))).tiles[widgetOf(d, 'revenue_won_kpi')];
      if (t.kind !== 'kpi') throw new Error(t.kind);
      return t.value;
    };
    expect(await won(owner(s), { range: 'last_30', ownerId: s.w.member.id })).toBe(300);
    // El filtro no amplía el alcance: member filtrando por el owner ve 0.
    expect(await won(member(s), { range: 'last_30', ownerId: s.ws })).toBe(0);
    // Equipo de ventas (solo friend, que no tiene deals).
    expect(await won(owner(s), { range: 'last_30', teamId: s.team.id })).toBe(0);
    // Rango sin datos.
    expect(await won(owner(s), { range: 'custom', from: '2020-01-01', to: '2020-01-31' })).toBe(0);

    // Un pipeline de otro workspace no devuelve los nombres de sus etapas.
    const other = await createPipeline(s.w.stranger.id, 'Theirs');
    await createStage(s.w.stranger.id, other.id, { name: 'Secret stage name' });
    const t = await json<{ tiles: Record<string, TileData> }>(await tiles(owner(s), d.id, { range: 'last_30', pipelineId: other.id }));
    expect(JSON.stringify(t)).not.toContain('Secret stage name');
  });

  it('un reporte propio sobre un monto oculto: member no ve ni el total ni el campo; owner sí', async () => {
    const s = await setup('p3-hidden');
    const d = await makeDashboard(s, { template: 'blank' });
    const report = await createCustomReport(s.ws, {
      name: 'ARR by stage',
      config: reportConfigSchema.parse({ source: 'deals', dimensions: [{ field: 'deal.stage' }], metric: { agg: 'sum', field: 'deal.custom:arr' }, viz: 'bar' }),
      createdBy: s.ws,
    });
    const add = await as(owner(s), () => widgetsRoute.POST(send('POST', { type: 'custom_report', config: { reportId: report.id } }), ctx(d.id)));
    expect(add.status).toBe(201);
    const wid = (await json<{ id: string }>(add)).id;

    const asOwnerTile = (await json<{ tiles: Record<string, TileData> }>(await tiles(owner(s), d.id))).tiles[wid];
    if (asOwnerTile.kind !== 'custom') throw new Error(asOwnerTile.kind);
    if (asOwnerTile.report.result.kind !== 'aggregate') throw new Error('kind');
    expect(asOwnerTile.report.result.total).toBe(777001 + 777002 + 777003 + 777004 + 777005);

    const memberRaw = JSON.stringify((await json<{ tiles: Record<string, TileData> }>(await tiles(member(s), d.id))).tiles);
    expect(memberRaw).toContain('"kind":"error"');
    expect(memberRaw).not.toMatch(/77700\d/);
    expect(memberRaw).not.toContain('custom:arr');
    // Un reporte propio no tiene drill-down de biblioteca.
    expect((await drill(owner(s), d.id, wid)).status).toBe(400);
  });

  it('agregar de la biblioteca, duplicar, cambiar tamaño y orden, quitar', async () => {
    const s = await setup('p3-tiles');
    const d = await makeDashboard(s, { template: 'blank' });
    session.user = owner(s);
    expect((await widgetsRoute.POST(send('POST', { type: 'library', config: { reportKey: 'nope' } }), ctx(d.id))).status).toBe(400);
    const a = await json<{ id: string; w: number }>(await widgetsRoute.POST(send('POST', { type: 'library', config: { reportKey: 'deals_created', viz: 'donut' } }), ctx(d.id)));
    expect(a.w).toBe(6);
    const b = await json<{ id: string; position: number }>(await widgetsRoute.POST(send('POST', { type: 'library', duplicateOf: a.id }), ctx(d.id)));
    expect(b.position).toBe(1);
    // Una visualización que no aplica al reporte no se guarda.
    const patched = await json<{ config: string }>(await widgetRoute.PATCH(send('PATCH', { config: { viz: 'donut', title: 'Mine' } }), wctx(a.id)));
    expect(JSON.parse(patched.config)).toEqual({ reportKey: 'deals_created', title: 'Mine' });
    const reordered = await json<{ widgets: Array<{ id: string; w: number }> }>(
      await dashRoute.PATCH(send('PATCH', { order: [{ id: b.id, position: 0, size: 'wide' }, { id: a.id, position: 1 }] }), ctx(d.id)),
    );
    expect(reordered.widgets.map((w) => [w.id, w.w])).toEqual([[b.id, 12], [a.id, 6]]);
    expect((await widgetRoute.DELETE(send('DELETE', null), wctx(a.id))).status).toBe(204);
    const filters = await json<{ filters: string }>(await dashRoute.PATCH(send('PATCH', { filters: { range: 'this_quarter' } }), ctx(d.id)));
    expect(JSON.parse(filters.filters)).toEqual({ range: 'this_quarter' });
  });
});
