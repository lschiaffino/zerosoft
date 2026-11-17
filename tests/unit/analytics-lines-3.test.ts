import { describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import { analyticsRange } from '@/lib/analytics-kit/period';
import { aggregateDocs, aggregateDocsSite, dedupeEdits, docsAnalytics, isDocsAnalyticsEmpty, isDocsSiteEmpty, stampMs } from '@/lib/docs-analytics';
import { aggregateBoard, boardAnalytics, isBoardAnalyticsEmpty } from '@/lib/board-analytics';
import { createDocPage } from '@/lib/docs';
import { createTeamspace } from '@/lib/docs-access';
import { maybeAutoSnapshot } from '@/lib/docs-versions';
import { createBoard, saveBoardScene } from '@/lib/boards';
import { markHour } from '@/lib/edit-marks';
import { makeUser } from './helpers';

const now = new Date('2030-03-12T12:00:00Z');
const range = analyticsRange({ days: 7, tz: 'UTC' }, now);
const at = (iso: string) => Date.parse(iso);

describe('Docs: analítica con el kit', () => {
  const pages = [
    { id: 'p1', title: 'Guía', icon: null, teamspace_id: null, created_at: '2030-03-10T09:00:00.000Z' },
    { id: 'p2', title: 'Ventas', icon: null, teamspace_id: 'ts1', created_at: '2030-03-01 09:00:00' },
    { id: 'p3', title: 'Vieja', icon: null, teamspace_id: null, created_at: '2029-01-01T00:00:00.000Z' },
  ];
  const input = {
    pages,
    edits: [
      { page_id: 'p1', person_id: 'ana', at: at('2030-03-10T09:00:00Z') },
      { page_id: 'p1', person_id: 'ana', at: at('2030-03-10T10:00:00Z') },
      { page_id: 'p1', person_id: 'bo', at: at('2030-03-11T15:00:00Z') },
      { page_id: 'p2', person_id: 'bo', at: at('2030-03-02T15:00:00Z') },
      // De una página que no ve: no cuenta.
      { page_id: 'px', person_id: 'bo', at: at('2030-03-11T15:00:00Z') },
    ],
    views: [
      { page_id: 'p1', viewer_id: 'ana', day: '2030-03-10', views: 3 },
      { page_id: 'p1', viewer_id: 'bo', day: '2030-03-11', views: 1 },
      { page_id: 'p2', viewer_id: 'bo', day: '2030-03-03', views: 2 },
    ],
    comments: [
      { page_id: 'p1', user_id: 'bo', created_at: '2030-03-11T16:00:00.000Z' },
      { page_id: 'p2', user_id: 'bo', created_at: '2030-03-02T16:00:00.000Z' },
    ],
    names: new Map([
      ['ana', 'Ana'],
      ['bo', 'Bo'],
    ]),
    spaces: [{ id: 'ts1', name: 'Ventas' }],
  };

  it('cuenta creadas, ediciones, vistas, lectores y comentarios contra el período anterior', () => {
    const d = aggregateDocs(range, input);
    expect(d.kpis.created).toEqual({ value: 1, prev: 1 });
    expect(d.kpis.edited).toEqual({ value: 1, prev: 1 });
    expect(d.kpis.edits).toEqual({ value: 3, prev: 1 });
    expect(d.kpis.views).toEqual({ value: 4, prev: 2 });
    expect(d.kpis.readers).toEqual({ value: 2, prev: 1 });
    expect(d.kpis.comments).toEqual({ value: 1, prev: 1 });
    expect(d.perDay.find((p) => p.day === '2030-03-10')).toMatchObject({ created: 1, edits: 2, views: 3 });
    expect(d.prevViews.reduce((a, b) => a + b, 0)).toBe(2);
    expect(d.people.map((p) => [p.name, p.edits, p.pages, p.prevEdits])).toEqual([
      ['Ana', 2, 1, 0],
      ['Bo', 1, 1, 1],
    ]);
    expect(d.pages[0]).toMatchObject({ id: 'p1', views: 4, readers: 2, edits: 3, editors: 2, comments: 1 });
    // 2030-03-11 fue lunes.
    expect(d.heat[0][15]).toBe(1);
    expect(isDocsAnalyticsEmpty(d)).toBe(false);
  });

  it('filtra por teamspace o por las páginas del workspace', () => {
    expect(aggregateDocs(range, input, 'ts1').kpis.edits).toEqual({ value: 0, prev: 1 });
    expect(aggregateDocs(range, input, 'none').kpis.edits).toEqual({ value: 3, prev: 0 });
  });

  it('sin páginas o sin nada, está vacío', () => {
    expect(isDocsAnalyticsEmpty(aggregateDocs(range, { ...input, pages: [] }))).toBe(true);
    expect(isDocsAnalyticsEmpty(aggregateDocs(range, { ...input, pages: [pages[2]], edits: [], views: [], comments: [] }))).toBe(true);
  });

  it('lee fechas ISO y de SQLite, y las marcas no se repiten', () => {
    expect(stampMs('2030-03-01 09:00:00')).toBe(at('2030-03-01T09:00:00Z'));
    expect(
      dedupeEdits([
        { page_id: 'a', person_id: 'x', hour: '2030-03-10T09' },
        { page_id: 'a', person_id: 'x', hour: '2030-03-10T09' },
        { page_id: 'a', person_id: null, hour: '2030-03-10T09' },
      ]),
    ).toHaveLength(2);
  });

  it('sitio publicado: visitas, visitantes por día, páginas y si les sirvió', () => {
    const d = aggregateDocsSite(
      range,
      [
        { page_id: 'p1', day: '2030-03-10', visitor: 'v1', views: 2, referrer: 'google.com' },
        { page_id: '', day: '2030-03-10', visitor: 'v1', views: 1, referrer: null },
        { page_id: 'p1', day: '2030-03-11', visitor: 'v1', views: 1, referrer: null },
        { page_id: 'p1', day: '2030-03-02', visitor: 'v9', views: 5, referrer: null },
      ],
      new Map([['p1', 'Guía']]),
      [
        { page_id: 'p1', helpful: 1, created_at: '2030-03-10T10:00:00.000Z' },
        { page_id: 'p1', helpful: 0, created_at: '2030-03-10T11:00:00.000Z' },
      ],
      1,
    );
    expect(d.kpis.views).toEqual({ value: 4, prev: 5 });
    expect(d.kpis.visitors).toEqual({ value: 2, prev: 1 });
    expect(d.kpis.pages).toEqual({ value: 1, prev: 1 });
    expect(d.kpis.helpful.value).toBeCloseTo(0.5);
    expect(d.pages[0]).toMatchObject({ id: 'p1', views: 3, visitors: 2, helpful: 1, notHelpful: 1 });
    expect(d.referrers).toEqual([{ host: 'google.com', visitors: 1 }]);
    expect(isDocsSiteEmpty(d)).toBe(false);
  });

  it('con la base: las marcas del guardado y sin las páginas de un teamspace privado ajeno', async () => {
    const owner = await makeUser('docs-an');
    const member = await makeUser('docs-an-m');
    const open = await createDocPage(owner.id, { title: 'Abierta' });
    const ts = await createTeamspace(owner.id, owner.id, { name: 'Privado', access: 'private' });
    const secret = await createDocPage(owner.id, { title: 'Secreta', teamspace_id: ts.id });
    const t0 = new Date();
    await maybeAutoSnapshot(owner.id, open.id, member.id, null, t0);
    await maybeAutoSnapshot(owner.id, secret.id, owner.id, null, t0);
    const mark = (await getDb().prepare('SELECT saves FROM docs_edit_marks WHERE page_id = ? AND person_id = ? AND hour = ?').get(open.id, member.id, markHour(t0))) as { saves: number };
    expect(Number(mark.saves)).toBe(1);
    const q = { days: 7, tz: 'UTC' };
    const all = await docsAnalytics({ workspaceId: owner.id, hidden: [] }, undefined, q);
    expect(all.kpis.edits.value).toBe(2);
    expect(all.kpis.created.value).toBe(2);
    const forMember = await docsAnalytics({ workspaceId: owner.id, hidden: [ts.id] }, undefined, q);
    expect(forMember.kpis.edits.value).toBe(1);
    expect(forMember.pages.map((p) => p.id)).toEqual([open.id]);
    expect(forMember.spaceList.map((s) => s.id)).not.toContain(ts.id);
  });
});

describe('Board: analítica con el kit', () => {
  const boards = [
    { id: 'b1', name: 'Retro', folder_id: 'f1', created_at: '2030-03-10T09:00:00.000Z', elements: 12 },
    { id: 'b2', name: 'Mapa', folder_id: null, created_at: '2030-03-02T09:00:00.000Z', elements: 3 },
  ];
  const input = {
    boards,
    edits: [
      { board_id: 'b1', person_id: 'ana', at: at('2030-03-10T09:00:00Z') },
      { board_id: 'b1', person_id: 'bo', at: at('2030-03-11T09:00:00Z') },
      { board_id: 'b2', person_id: 'ana', at: at('2030-03-03T09:00:00Z') },
    ],
    comments: [
      { board_id: 'b1', author_id: 'cy', created_at: '2030-03-11T10:00:00.000Z' },
      { board_id: 'b2', author_id: 'ana', created_at: '2030-03-03T10:00:00.000Z' },
    ],
    names: new Map([
      ['ana', 'Ana'],
      ['bo', 'Bo'],
      ['cy', 'Cy'],
    ]),
    folders: [{ id: 'f1', name: 'Equipo' }],
  };

  it('cuenta creadas, ediciones, colaboradores, comentarios y elementos', () => {
    const d = aggregateBoard(range, input);
    expect(d.kpis.created).toEqual({ value: 1, prev: 1 });
    expect(d.kpis.edited).toEqual({ value: 1, prev: 1 });
    expect(d.kpis.edits).toEqual({ value: 2, prev: 1 });
    expect(d.kpis.people).toEqual({ value: 3, prev: 1 });
    expect(d.kpis.comments).toEqual({ value: 1, prev: 1 });
    expect(d.kpis.elements).toEqual({ value: 15 });
    expect(d.boards[0]).toMatchObject({ id: 'b1', edits: 2, editors: 2, comments: 1, elements: 12 });
    expect(d.folders).toEqual([{ id: 'f1', name: 'Equipo', edits: 2, created: 1, boards: 1 }]);
    expect(d.people.find((p) => p.id === 'cy')).toMatchObject({ edits: 0, comments: 1 });
    expect(isBoardAnalyticsEmpty(d)).toBe(false);
  });

  it('filtra por carpeta', () => {
    expect(aggregateBoard(range, input, 'none').kpis.edits).toEqual({ value: 0, prev: 1 });
    expect(aggregateBoard(range, input, 'f1').kpis.elements.value).toBe(12);
    expect(isBoardAnalyticsEmpty(aggregateBoard(range, { ...input, boards: [] }))).toBe(true);
  });

  it('con la base: marcas al guardar, elementos sin los borrados y sin las restringidas ajenas', async () => {
    const owner = await makeUser('board-an');
    const member = await makeUser('board-an-m');
    const scene = {
      elements: [
        { id: 'e1', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, version: 1, isDeleted: false },
        { id: 'e2', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, version: 1, isDeleted: true },
      ],
      appState: {},
      files: {},
    };
    const open = await createBoard(owner.id, owner.id, 'Abierta');
    const empty = await createBoard(owner.id, owner.id, 'Vacía');
    const closed = await createBoard(owner.id, owner.id, 'Restringida');
    await getDb().prepare("UPDATE boards SET access = 'restricted' WHERE id = ?").run(closed.id);
    const saved = await saveBoardScene(owner.id, member.id, open.id, scene as never, 1);
    expect(saved.ok).toBe(true);
    await saveBoardScene(owner.id, owner.id, closed.id, scene as never, 1);
    const q = { days: 7, tz: 'UTC' };
    const admin = await boardAnalytics({ workspaceId: owner.id, personId: owner.id, isAdmin: true }, undefined, q);
    expect(admin.boardCount).toBe(3);
    expect(admin.kpis.edits.value).toBe(2);
    expect(admin.boards.find((b) => b.id === open.id)).toMatchObject({ elements: 1, editors: 1 });
    expect(admin.kpis.elements.value).toBeGreaterThanOrEqual(1);
    const asMember = await boardAnalytics({ workspaceId: owner.id, personId: member.id, isAdmin: false }, undefined, q);
    expect(asMember.boardCount).toBe(2);
    expect(asMember.boards.map((b) => b.id)).toEqual([open.id]);
    expect(asMember.kpis.edits.value).toBe(1);
    expect(empty.id).toBeTruthy();
  });
});
