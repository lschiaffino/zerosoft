/**
 * CRM Dashboards (P6): el rango del dashboard en los reportes propios, el
 * drill-down de un reporte propio y la velocidad de ventas con los deals
 * abiertos al cierre de cada período. Miradas: anónimo, otro workspace,
 * miembro con alcance "mine", miembro con un campo oculto y owner. Datos
 * inventados.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { createCustomField, createDeal, createPipeline, createStage, moveDeal, updateStage } from '@/lib/crm';
import { MEMBER_SUBJECT, setFieldPermissions } from '@/lib/crm-field-perms';
import { setMemberVisibility } from '@/lib/crm-visibility';
import { createCustomReport } from '@/lib/crm-custom-reports';
import { reportConfigSchema } from '@/lib/crm-report-builder';
import { bucketLabel, bucketsSpanYears } from '@/lib/crm-buckets';
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
const widgetsRoute = await import('@/lib/routes/crm/dashboards/[id]/widgets/route');
const dataRoute = await import('@/app/api/crm/dashboards/data/route');
const drillRoute = await import('@/app/api/crm/dashboards/drill/route');

beforeEach(() => {
  session.user = null;
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const send = (method: string, body: unknown) =>
  new NextRequest('http://x', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const json = async <T,>(res: Response) => (await res.json()) as T;

describe('etiquetas de período con año', () => {
  it('un rango que cruza años lleva el año; uno dentro del mismo año no', () => {
    expect(bucketsSpanYears(['2025-11', '2025-12', '2026-01'])).toBe(true);
    expect(bucketsSpanYears(['2026-01', '2026-02'])).toBe(false);
    expect(bucketLabel('2025-11', 'en', true)).toBe('Nov 2025');
    expect(bucketLabel('2025-11', 'en')).toBe('Nov');
    expect(bucketLabel('2025-12-29', 'en', true)).toBe('Dec 29, 2025');
  });
});

/**
 * Workspace "mine": owner con un deal abierto (Owner open, 5000) y uno ganado
 * (Owner won, 1000); member con uno abierto (Member open, 700). `arr` es un
 * campo propio oculto para member.
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
  const lost = (await createStage(ws, p.id, { name: 'Lost', probability: 0 }))!;
  await updateStage(ws, lost.id, { isLost: true });
  const deal = async (name: string, ownerId: string, amount: number, stage: string | null = null) => {
    const r = await createDeal(ws, { name, pipelineId: p.id, stageId: open.id, ownerId, amount, custom: { arr: 777000 + amount } });
    if (!r.ok) throw new Error('deal');
    if (stage) await moveDeal(ws, r.deal.id, stage);
    return r.deal;
  };
  const deals = {
    ownerOpen: await deal('Owner open', ws, 5000),
    ownerWon: await deal('Owner won', ws, 1000, won.id),
    memberOpen: await deal('Member open', w.member.id, 700),
  };
  return { w, ws, p, open, won, lost, deal, deals };
}
type Setup = Awaited<ReturnType<typeof setup>>;
const owner = (s: Setup) => asOwner(s.w.owner);
const member = (s: Setup) => asMember(s.w.owner, s.w.member);
const stranger = (s: Setup) => asOwner(s.w.stranger);

async function dashboardWith(s: Setup, config: Record<string, unknown>, template: 'blank' | 'sales' = 'blank') {
  session.user = owner(s);
  const d = await json<{ id: string; widgets: Array<{ id: string; config: string }> }>(
    await listRoute.POST(send('POST', { name: 'P6', template, visibility: 'everyone' })),
  );
  const report = await createCustomReport(s.ws, { name: 'Custom', config: reportConfigSchema.parse(config), createdBy: s.ws });
  const add = await widgetsRoute.POST(send('POST', { type: 'custom_report', config: { reportId: report.id } }), ctx(d.id));
  expect(add.status).toBe(201);
  return { d, wid: (await json<{ id: string }>(add)).id };
}

async function tile(user: SessionUser | null, dashboardId: string, wid: string, filters: Record<string, unknown> = { range: 'last_30' }) {
  session.user = user;
  const res = await dataRoute.POST(send('POST', { dashboardId, filters }));
  if (res.status !== 200) return { status: res.status, tile: null };
  return { status: 200, tile: (await json<{ tiles: Record<string, TileData> }>(res)).tiles[wid] };
}

async function drill(user: SessionUser | null, dashboardId: string, widgetId: string, keys: Array<string | null> = [], filters: Record<string, unknown> = { range: 'last_30' }) {
  session.user = user;
  return drillRoute.POST(send('POST', { dashboardId, widgetId, filters, segment: { keys } }));
}

function total(t: TileData | null): number {
  if (!t || t.kind !== 'custom') throw new Error(t?.kind ?? 'none');
  const r = t.report.result;
  return r.kind === 'aggregate' ? r.total : r.total;
}

describe('reportes propios: el rango del dashboard', () => {
  it('se aplica al campo de fecha del reporte (dimensión de fecha) y no a uno sin fecha', async () => {
    const s = await setup('p6-range');
    const dated = await dashboardWith(s, { source: 'deals', dimensions: [{ field: 'deal.created', bucket: 'month' }], metric: { agg: 'count' }, viz: 'bar' });
    const now = await tile(owner(s), dated.d.id, dated.wid);
    expect(total(now.tile)).toBe(3);
    if (now.tile?.kind !== 'custom') throw new Error('kind');
    expect(now.tile.report.result.dateField).toBe('deal.created');
    // Un rango sin datos deja el reporte en cero.
    expect(total((await tile(owner(s), dated.d.id, dated.wid, { range: 'custom', from: '2020-01-01', to: '2020-01-31' })).tile)).toBe(0);

    // Sin campo de fecha: el rango no cambia nada y el resultado no dice que se aplicó.
    const plain = await dashboardWith(s, { source: 'deals', dimensions: [{ field: 'deal.stage' }], metric: { agg: 'count' }, viz: 'bar' });
    const old = (await tile(owner(s), plain.d.id, plain.wid, { range: 'custom', from: '2020-01-01', to: '2020-01-31' })).tile;
    expect(total(old)).toBe(3);
    if (old?.kind !== 'custom') throw new Error('kind');
    expect(old.report.result.dateField).toBeUndefined();

    // Un reporte que ya filtra su campo de fecha manda: el rango del dashboard no lo vacía.
    const own = await dashboardWith(s, {
      source: 'deals',
      dimensions: [{ field: 'deal.created', bucket: 'month' }],
      filters: [{ f: 'deal.created', o: 'last', v: '3650' }],
      metric: { agg: 'count' },
      viz: 'bar',
    });
    const ownTile = (await tile(owner(s), own.d.id, own.wid, { range: 'custom', from: '2020-01-01', to: '2020-01-31' })).tile;
    expect(total(ownTile)).toBe(3);
    if (ownTile?.kind !== 'custom') throw new Error('kind');
    expect(ownTile.report.result.dateField).toBeUndefined();

    // Una tabla de registros usa su primera columna de fecha.
    const table = await dashboardWith(s, { source: 'deals', columns: ['deal.name', 'deal.created'], viz: 'table' });
    expect(total((await tile(owner(s), table.d.id, table.wid, { range: 'custom', from: '2020-01-01', to: '2020-01-31' })).tile)).toBe(0);
    expect(total((await tile(owner(s), table.d.id, table.wid)).tile)).toBe(3);
  });

  it('member con alcance "mine" cuenta solo lo suyo también con rango', async () => {
    const s = await setup('p6-range-scope');
    const { d, wid } = await dashboardWith(s, { source: 'deals', dimensions: [{ field: 'deal.created', bucket: 'month' }], metric: { agg: 'sum', field: 'deal.amount' }, viz: 'bar' });
    expect(total((await tile(owner(s), d.id, wid)).tile)).toBe(6700);
    expect(total((await tile(member(s), d.id, wid)).tile)).toBe(700);
  });
});

describe('reportes propios: drill-down', () => {
  const byStage = { source: 'deals', dimensions: [{ field: 'deal.stage' }], metric: { agg: 'sum', field: 'deal.amount' }, viz: 'bar' };

  it('anónimo 401 y otro workspace 404', async () => {
    const s = await setup('p6-drill-access');
    const { d, wid } = await dashboardWith(s, byStage);
    expect((await drill(null, d.id, wid, [s.open.id])).status).toBe(401);
    expect((await drill(stranger(s), d.id, wid, [s.open.id])).status).toBe(404);
  });

  it('owner ve los registros del segmento; member con alcance "mine" solo los suyos', async () => {
    const s = await setup('p6-drill-scope');
    const { d, wid } = await dashboardWith(s, byStage);
    const o = await json<DrillResult>(await drill(owner(s), d.id, wid, [s.open.id]));
    expect(o.object).toBe('deal');
    expect(o.rows.map((r) => r.name).sort()).toEqual(['Member open', 'Owner open']);
    expect(o.rows.find((r) => r.name === 'Owner open')).toMatchObject({ amount: 5000, status: 'Qualified', previewType: 'deal' });

    const m = await json<DrillResult>(await drill(member(s), d.id, wid, [s.open.id]));
    expect(m.rows.map((r) => r.name)).toEqual(['Member open']);
    expect(JSON.stringify(m)).not.toContain('Owner open');

    // Sin claves: todo el reporte (lo que la persona ve).
    expect((await json<DrillResult>(await drill(member(s), d.id, wid))).total).toBe(1);
    // Más claves que dimensiones: 400.
    expect((await drill(owner(s), d.id, wid, ['a', 'b'])).status).toBe(400);
  });

  it('el drill respeta el rango del dashboard en la fecha del reporte', async () => {
    const s = await setup('p6-drill-range');
    const { d, wid } = await dashboardWith(s, { source: 'deals', dimensions: [{ field: 'deal.created', bucket: 'month' }], metric: { agg: 'count' }, viz: 'bar' });
    const month = new Date().toISOString().slice(0, 7);
    expect((await json<DrillResult>(await drill(owner(s), d.id, wid, [month]))).total).toBe(3);
    expect((await json<DrillResult>(await drill(owner(s), d.id, wid, [month], { range: 'custom', from: '2020-01-01', to: '2020-01-31' }))).total).toBe(0);
  });

  it('un reporte sobre un campo oculto: member recibe 403 y ningún valor; owner lo abre', async () => {
    const s = await setup('p6-drill-hidden');
    const { d, wid } = await dashboardWith(s, { source: 'deals', dimensions: [{ field: 'deal.custom:arr' }], metric: { agg: 'count' }, viz: 'bar' });
    const res = await drill(member(s), d.id, wid, ['782000']);
    expect(res.status).toBe(403);
    expect(await res.text()).not.toMatch(/77\d{4}|78\d{4}/);
    const o = await json<DrillResult>(await drill(owner(s), d.id, wid, ['782000']));
    expect(o.rows.map((r) => r.name)).toEqual(['Owner open']);
  });
});

describe('velocidad de ventas', () => {
  it('fórmula estándar; el período anterior cuenta los deals abiertos al cierre de ese período', async () => {
    const s = await setup('p6-velocity');
    const db = getDb();
    const at = (deal: { id: string }, created: number, closed: number | null) =>
      db
        .prepare(
          `UPDATE crm_deals SET created_at = datetime('now', ?), closed_at = ${closed === null ? 'NULL' : "datetime('now', ?)"} WHERE id = ?`,
        )
        .run(...[`-${created} days`, ...(closed === null ? [] : [`-${closed} days`]), deal.id]);
    // Sacamos del cálculo los deals del setup (los creamos hace mucho y cerrados antes de los dos períodos).
    for (const x of Object.values(s.deals)) {
      await moveDeal(s.ws, x.id, s.lost.id);
      await at(x, 400, 399);
    }
    // Período anterior (31 a 60 días atrás): un ganado de 1000 con ciclo de 10 días y un perdido.
    const prevWon = await s.deal('Prev won', s.ws, 1000, s.won.id);
    await at(prevWon, 50, 40);
    const prevLost = await s.deal('Prev lost', s.ws, 500, s.lost.id);
    await at(prevLost, 55, 45);
    // A: abierto desde hace 50 días. B: creado hoy. C: creado hace 50 días y ganado hace 10 (4000, ciclo 40).
    const a = await s.deal('A open', s.ws, 100);
    await at(a, 50, null);
    await s.deal('B open', s.ws, 100);
    const c = await s.deal('C won', s.ws, 4000, s.won.id);
    await at(c, 50, 10);

    session.user = owner(s);
    const d = await json<{ id: string; widgets: Array<{ id: string; config: string }> }>(
      await listRoute.POST(send('POST', { name: 'Velocity', template: 'sales', visibility: 'everyone' })),
    );
    const wid = d.widgets.find((w) => JSON.parse(w.config).reportKey === 'sales_velocity')!.id;
    const t = (await json<{ tiles: Record<string, TileData> }>(await dataRoute.POST(send('POST', { dashboardId: d.id, filters: { range: 'last_30' } })))).tiles[wid];
    if (t.kind !== 'kpi') throw new Error(t.kind);
    // Ahora: 2 abiertos (A, B) × 100% × 4000 ÷ 40 días = 200 por día.
    expect(t.value).toBe(200);
    expect(t.detail).toMatchObject({ count: 2, rate: 100, avg: 4000 });
    expect(Math.round(t.detail?.cycle ?? 0)).toBe(40);
    // Antes: abiertos hace 30 días eran A y C (B no existía) → 2 × 50% × 1000 ÷ 10 = 100.
    expect(t.prev).toBe(100);

    // El drill del período anterior lista los mismos abiertos que cuenta (A y C), no los de hoy.
    const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
    const prevDrill = await json<DrillResult>(
      await drillRoute.POST(send('POST', { dashboardId: d.id, widgetId: wid, filters: { range: 'custom', from: day(59), to: day(30) }, segment: {} })),
    );
    expect(prevDrill.rows.map((r) => r.name).sort()).toEqual(['A open', 'C won']);
    const nowDrill = await json<DrillResult>(await drillRoute.POST(send('POST', { dashboardId: d.id, widgetId: wid, filters: { range: 'last_30' }, segment: {} })));
    expect(nowDrill.rows.map((r) => r.name).sort()).toEqual(['A open', 'B open']);
  });
});
