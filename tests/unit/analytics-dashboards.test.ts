import { afterAll, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { getDb, upsertUser } from '@/lib/db';
import { applyDashboard, layoutOf, moveInLayout, normalizeSettings, transferTile } from '@/lib/analytics/dashboard-core';
import { DASHBOARD_TEMPLATES, templateContent } from '@/lib/analytics/dashboard-templates';
import { parseIngestBody } from '@/lib/analytics/ingest-core';
import { storeEvents } from '@/lib/analytics/ingest';
import { createProject, getProject, type ProjectRow } from '@/lib/analytics/projects';
import { runInsight } from '@/lib/analytics/query';
import { createDashboard, createDashboardFromTemplate, createInsight, getCohort, getDashboard, transferDashboardTile, updateDashboard } from '@/lib/analytics/records';
import { createShare } from '@/lib/analytics/records-more';
import { publicShareView } from '@/lib/analytics/share-view';
import { dashboardSettingsSchema, funnelQuerySchema, insightQuerySchema, trendsQuerySchema, type DashboardSettings } from '@/lib/analytics/types';

async function setupOne() {
  const user = await upsertUser({ email: `an-dash-c-${nanoid(8)}@test.dev` });
  return { project: await createProject(user.id, user.id, 'C') };
}

const trend = trendsQuerySchema.parse({ kind: 'trends', series: [{ event: 'x' }], dateRange: { from: '-7d' }, filters: [{ key: 'a', op: 'eq', value: 1 }] });
const base = (patch: Partial<DashboardSettings> = {}): DashboardSettings => ({ ...normalizeSettings(null), ...patch });
const filter = { key: 'plan', op: 'eq' as const, value: 'pro', type: 'event' as const };

describe('dashboard core', () => {
  it('date range: tile, then dashboard, then insight', () => {
    expect((applyDashboard(trend, base()) as typeof trend).dateRange).toEqual({ from: '-7d' });
    const board = base({ dateRange: { from: '-30d' } });
    expect((applyDashboard(trend, board) as typeof trend).dateRange).toEqual({ from: '-30d' });
    expect((applyDashboard(trend, board, { dateRange: { from: '-1d' } }) as typeof trend).dateRange).toEqual({ from: '-1d' });
  });

  it('filters add up to those of the insight', () => {
    const out = applyDashboard(trend, base({ filters: [filter] }), { filters: [{ ...filter, key: 'other' }] }) as typeof trend;
    expect(out.filters.map((f) => f.key)).toEqual(['a', 'plan', 'other']);
    expect(trend.filters).toHaveLength(1);
  });

  it('a tile that ignores the dashboard takes neither its dates nor filters nor cohort, but keeps its own', () => {
    const out = applyDashboard(trend, base({ dateRange: { from: '-30d' }, filters: [filter], cohortId: 'c', internal: 'on' }), { ignoreFilters: true, filters: [{ ...filter, key: 'own' }] }) as typeof trend;
    expect(out.dateRange).toEqual({ from: '-7d' });
    expect(out.filters.map((f) => f.key)).toEqual(['a', 'own']);
    expect(out.cohortId).toBeUndefined();
    expect(out.excludeInternal).toBeUndefined();
  });

  it('internal people can be forced either way or left to each insight', () => {
    const own = trendsQuerySchema.parse({ kind: 'trends', series: [{ event: 'x' }], excludeInternal: true });
    expect((applyDashboard(own, base({ internal: 'inherit' })) as typeof own).excludeInternal).toBe(true);
    expect((applyDashboard(own, base({ internal: 'off' })) as typeof own).excludeInternal).toBe(false);
    expect((applyDashboard(trend, base({ internal: 'on' })) as typeof trend).excludeInternal).toBe(true);
  });

  it('sql goes untouched and retention keeps its periods', () => {
    const sql = insightQuerySchema.parse({ kind: 'sql', sql: 'SELECT 1' });
    expect(applyDashboard(sql, base({ dateRange: { from: '-30d' }, filters: [filter] }))).toEqual(sql);
    const ret = insightQuerySchema.parse({ kind: 'retention' });
    expect(applyDashboard(ret, base({ dateRange: { from: '-30d' } }))).not.toHaveProperty('dateRange');
    const funnel = funnelQuerySchema.parse({ kind: 'funnel', steps: [{ event: 'a' }, { event: 'b' }] });
    expect((applyDashboard(funnel, base(), { interval: 'week' }) as typeof funnel).interval).toBe('week');
  });

  it('display options of the tile win over those of the insight', () => {
    const q = trendsQuerySchema.parse({ kind: 'trends', series: [{ event: 'x' }], options: { unit: 'percentage', showValues: false } });
    const out = applyDashboard(q, base(), { options: { showValues: true } }) as typeof q;
    expect(out.options).toEqual({ unit: 'percentage', showValues: true });
  });

  it('layout follows the order and new things go last; moving stays in bounds', () => {
    const s = base({ texts: [{ id: 't1', body: 'x' }], order: ['t1', 'b'] });
    const layout = layoutOf(['a', 'b'], s);
    expect(layout.map((r) => r.id)).toEqual(['t1', 'b', 'a']);
    expect(layout[0].kind).toBe('text');
    expect(moveInLayout(layout, 'b', -1)).toEqual(['b', 't1', 'a']);
    expect(moveInLayout(layout, 't1', -1)).toEqual(['t1', 'b', 'a']);
    expect(moveInLayout(layout, 'a', 1)).toEqual(['t1', 'b', 'a']);
    expect(layoutOf(['a'], base({ order: ['gone', 'a'] })).map((r) => r.id)).toEqual(['a']);
  });

  it('copying keeps the source and its tile options; moving takes them out', () => {
    const from = { insightIds: ['a'], settings: base({ tiles: { a: { size: 'l' } }, texts: [{ id: 't', body: 'hi' }], order: ['t', 'a'] }) };
    const to = { insightIds: [], settings: base() };
    const copy = transferTile(from, to, { kind: 'insight', id: 'a' }, false, () => 'n');
    expect(copy.to.insightIds).toEqual(['a']);
    expect(copy.to.settings.tiles.a).toEqual({ size: 'l' });
    expect(copy.from.insightIds).toEqual(['a']);
    const move = transferTile(from, to, { kind: 'insight', id: 'a' }, true, () => 'n');
    expect(move.from.insightIds).toEqual([]);
    expect(move.from.settings.tiles.a).toBeUndefined();
    expect(move.from.settings.order).toEqual(['t']);
    const text = transferTile(from, to, { kind: 'text', id: 't' }, true, () => 'n');
    expect(text.to.settings.texts).toEqual([{ id: 'n', body: 'hi' }]);
    expect(text.from.settings.texts).toEqual([]);
    // Dos veces al mismo tablero no duplica el insight.
    expect(transferTile(from, copy.to, { kind: 'insight', id: 'a' }, false, () => 'n').to.insightIds).toEqual(['a']);
  });

  it('settings saved before parse fine', () => {
    expect(dashboardSettingsSchema.parse({})).toEqual({ filters: [], texts: [], order: [], tiles: {} });
  });
});

describe('cohort on a board', () => {
  it('the route refuses a cohort from elsewhere', async () => {
    const { project } = await setupOne();
    expect(await getCohort(project.id, 'ac_other-workspace')).toBeNull();
  });
});

describe('templates', () => {
  it('every query is valid, in the three languages', () => {
    for (const k of DASHBOARD_TEMPLATES) {
      for (const l of ['en', 'es', 'pt', 'fr']) {
        const c = templateContent(k, l);
        expect(c.name).toBeTruthy();
        expect(c.insights.length).toBeGreaterThan(3);
      }
    }
    expect(templateContent('website', 'es').name).toBe('Sitio web');
    expect(templateContent('website', 'fr').name).toBe('Website');
  });
});

describe('dashboards on stored data', () => {
  const created: string[] = [];
  afterAll(async () => {
    for (const id of created) {
      await getDb().prepare('DELETE FROM analytics_events WHERE project_id = ?').run(id);
      await getDb().prepare('DELETE FROM analytics_projects WHERE id = ?').run(id);
    }
  });
  async function setup(): Promise<{ project: ProjectRow; userId: string }> {
    const user = await upsertUser({ email: `an-dash-${nanoid(8)}@test.dev` });
    const project = await createProject(user.id, user.id, 'D');
    created.push(project.id);
    return { project, userId: user.id };
  }
  async function ingest(project: ProjectRow, events: Array<{ event: string; who: string; props?: Record<string, unknown> }>) {
    const parsed = parseIngestBody(JSON.stringify({ api_key: project.public_key, batch: events.map((e) => ({ event: e.event, distinct_id: e.who, timestamp: new Date(Date.now() - 1000).toISOString(), properties: e.props ?? {} })) }));
    if (!parsed.ok) throw new Error(parsed.error);
    await storeEvents((await getProject(project.workspace_id, project.id))!, parsed.events, null);
  }

  it('templates run, on an empty project too', async () => {
    const { project, userId } = await setup();
    for (const k of DASHBOARD_TEMPLATES) {
      const d = await createDashboardFromTemplate(project.id, userId, k, 'en');
      expect(d.insightIds.length).toBe(templateContent(k, 'en').insights.length);
      for (const i of templateContent(k, 'en').insights) await expect(runInsight(project, i.query)).resolves.toBeTruthy();
    }
  });

  it('settings persist, a transfer stays inside the project, and the public link shows the same numbers', async () => {
    const { project, userId } = await setup();
    await ingest(project, [
      { event: 'x', who: 'a', props: { plan: 'pro' } },
      { event: 'x', who: 'b', props: { plan: 'free' } },
    ]);
    const insight = await createInsight(project.id, userId, { name: 'X', query: trendsQuerySchema.parse({ kind: 'trends', series: [{ event: 'x' }], dateRange: { from: '-7d' } }) });
    const d = await createDashboard(project.id, userId, { name: 'One' });
    await updateDashboard(project.id, d.id, { insightIds: [insight.id], settings: base({ filters: [filter], texts: [{ id: 't', body: '**Note**' }], order: ['t', insight.id], tiles: { [insight.id]: { size: 'l' } } }) });
    const saved = await getDashboard(project.id, d.id);
    expect(saved?.settings.filters).toHaveLength(1);
    expect(saved?.settings.tiles[insight.id].size).toBe('l');

    const share = await createShare(project.id, userId, { dashboardId: d.id });
    const view = await publicShareView(share.token);
    expect(view?.tiles.map((t) => t.text ?? t.name)).toEqual(['**Note**', 'X']);
    const r = view?.tiles[1].result;
    // El filtro del tablero se aplica también en el link público: solo 'a'.
    expect(r?.kind === 'trends' && r.series[0].total).toBe(1);
    expect(view?.tiles[1].size).toBe('l');
    expect(JSON.stringify(view)).not.toContain('"plan"');

    const other = await createDashboard(project.id, userId, { name: 'Two' });
    await transferDashboardTile(project.id, d.id, other.id, { kind: 'insight', id: insight.id }, true);
    expect((await getDashboard(project.id, other.id))?.insightIds).toEqual([insight.id]);
    expect((await getDashboard(project.id, d.id))?.insightIds).toEqual([]);

    // Otro proyecto no existe para esta cuenta.
    const { project: foreign, userId: foreignUser } = await setup();
    const elsewhere = await createDashboard(foreign.id, foreignUser, { name: 'Other' });
    await expect(transferDashboardTile(project.id, other.id, elsewhere.id, { kind: 'insight', id: insight.id }, false)).resolves.toBeNull();
    expect((await getDashboard(foreign.id, elsewhere.id))?.insightIds).toEqual([]);
  });
});
