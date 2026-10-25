import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createIssue, createIssueComment, createProject, getIssue, listIssueActivities, listIssueChildren, listIssues, listStatuses, updateIssue } from '@/lib/track-data';
import {
  decodeFilter,
  encodeFilter,
  filterToSql,
  normalizeFilter,
  resolveFilterDate,
  type FilterRule,
} from '@/lib/track-filter';
import {
  applySlashCommand,
  autoTask,
  continueList,
  detectTrigger,
  extractIssueRefs,
  indentListItem,
  renderTrackMarkdown,
  toggleTaskInSource,
} from '@/lib/track-markdown';
import { highlightCode } from '@/lib/track-highlight';
import { nestIssues } from '@/lib/track-views';
import { inversePatch, revertPatchFields } from '@/lib/track-tasks';
import { buildIssueActions, parseDueQuery, shortcutFor } from '@/components/track/trackCommands';
import { issueSignature, projectSignature, resolveIssueRefs } from '@/lib/track-ux';
import type { TrackIssueWithStatus } from '@/lib/track-data';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
  isWorkspaceAdmin: (u: { role?: string }) => u.role === 'owner' || u.role === 'admin',
}));

const reactionsRoute = await import('@/app/api/track/issues/[id]/comments/[commentId]/reactions/route');
const resolveRoute = await import('@/app/api/track/issues/[id]/comments/[commentId]/resolve/route');
const commentsRoute = await import('@/app/api/track/issues/[id]/comments/route');
const viewsRoute = await import('@/app/api/track/projects/[id]/views/route');
const viewRoute = await import('@/app/api/track/views/[id]/route');
const favoriteRoute = await import('@/app/api/track/views/[id]/favorite/route');
const favoritesRoute = await import('@/app/api/track/views/favorites/route');
const liveRoute = await import('@/app/api/track/live/route');
const refsRoute = await import('@/app/api/track/refs/route');
const projectIssuesRoute = await import('@/app/api/track/projects/[id]/issues/route');

const json = (url: string, method: string, body?: unknown) =>
  new NextRequest(`http://x${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never;
const app = { source: 'app' as const };

// ---------- Puros ----------

describe('track-filter', () => {
  it('convierte filtros viejos de vistas guardadas en reglas', () => {
    const f = normalizeFilter({ statusId: ['s1', 's2'], priority: 'high', dueBefore: '2026-11-01', q: 'login' });
    expect(f.rules).toEqual([
      { field: 'status', op: 'is', values: ['s1', 's2'] },
      { field: 'priority', op: 'is', values: ['high'] },
      { field: 'due', op: 'before', values: ['2026-11-01'] },
    ]);
    expect(f.q).toBe('login');
    expect(f.match).toBe('and');
  });

  it('descarta reglas inválidas y corrige operadores', () => {
    const f = normalizeFilter({
      match: 'or',
      rules: [
        { field: 'nope', op: 'is', values: ['x'] },
        { field: 'status', op: 'before', values: ['s1'] },
        { field: 'assignee', op: 'is', values: [] },
        { field: 'label', op: 'empty', values: ['ignored'] },
      ],
    });
    expect(f.match).toBe('or');
    expect(f.rules).toEqual([
      { field: 'status', op: 'is', values: ['s1'] },
      { field: 'label', op: 'empty', values: [] },
    ]);
    expect(decodeFilter(encodeFilter(f))).toEqual({ match: 'or', rules: f.rules });
    expect(decodeFilter('{oops')).toEqual({ match: 'and', rules: [] });
  });

  it('fechas relativas', () => {
    expect(resolveFilterDate('today', '2026-10-25')).toBe('2026-10-25');
    expect(resolveFilterDate('-7d', '2026-10-25')).toBe('2026-10-18');
    expect(resolveFilterDate('+14d', '2026-12-25')).toBe('2027-01-08');
    expect(resolveFilterDate('ayer', '2026-10-25')).toBeNull();
  });

  it('arma SQL parametrizado con AND/OR, negación y "sin valor"', () => {
    const rules: FilterRule[] = [
      { field: 'assignee', op: 'is_not', values: ['u1'] },
      { field: 'assignee', op: 'is', values: ['__none__'] },
    ];
    const and = filterToSql({ match: 'and', rules }, '2026-10-25')!;
    expect(and.sql).toContain(' AND ');
    expect(and.sql).toContain('i.assignee_id IS NULL OR NOT');
    expect(and.args).toEqual(['u1']);
    const or = filterToSql({ match: 'or', rules }, '2026-10-25')!;
    expect(or.sql).toContain(' OR ');
    // Nada del valor del usuario va pegado al SQL.
    const evil = filterToSql({ match: 'and', rules: [{ field: 'status', op: 'is', values: ["x') OR 1=1 --"] }] }, '2026-10-25')!;
    expect(evil.sql).not.toContain('OR 1=1');
    expect(filterToSql({ match: 'and', rules: [] }, '2026-10-25')).toBeNull();
  });
});

describe('editor de markdown', () => {
  it('listas siguen con Enter y se cortan en un ítem vacío', () => {
    expect(continueList('- uno', 5)).toEqual({ value: '- uno\n- ', cursor: 8 });
    expect(continueList('3. tres', 7)).toEqual({ value: '3. tres\n4. ', cursor: 11 });
    expect(continueList('- [x] hecha', 11)).toEqual({ value: '- [x] hecha\n- [ ] ', cursor: 18 });
    expect(continueList('a\n- ', 4)).toEqual({ value: 'a\n', cursor: 2 });
    expect(continueList('texto', 5)).toBeNull();
    expect(continueList('```\n- no', 8)).toBeNull();
  });

  it('Tab anida, [] crea tarea, / inserta bloques', () => {
    expect(indentListItem('- a', 3, false)).toEqual({ value: '  - a', cursor: 5 });
    expect(indentListItem('  - a', 5, true)).toEqual({ value: '- a', cursor: 3 });
    expect(indentListItem('hola', 4, false)).toBeNull();
    expect(autoTask('[] ', 3)).toEqual({ value: '- [ ] ', cursor: 6 });
    expect(applySlashCommand('hola /co', 5, 8, 'code')).toEqual({ value: 'hola \n```\n\n```', cursor: 10 });
    expect(applySlashCommand('/h2', 0, 3, 'h2')).toEqual({ value: '## ', cursor: 3 });
  });

  it('detecta "/", "@" y "#" solo al principio de una palabra', () => {
    expect(detectTrigger('hola /co', 8)).toEqual({ kind: 'slash', start: 5, query: 'co' });
    expect(detectTrigger('cc @an', 6)).toEqual({ kind: 'mention', start: 3, query: 'an' });
    expect(detectTrigger('ver #ZER', 8)).toEqual({ kind: 'issue', start: 4, query: 'ZER' });
    expect(detectTrigger('http://x', 8)).toBeNull();
    expect(detectTrigger('# título', 1)).toBeNull();
  });

  it('tildar tareas desde la lectura (sin contar las de bloques de código)', () => {
    const src = '- [ ] uno\n```\n- [ ] no\n```\n- [x] dos';
    expect(toggleTaskInSource(src, 0)).toBe('- [x] uno\n```\n- [ ] no\n```\n- [x] dos');
    expect(toggleTaskInSource(src, 1)).toBe('- [ ] uno\n```\n- [ ] no\n```\n- [ ] dos');
    expect(toggleTaskInSource(src, 5)).toBe(src);
    const html = renderTrackMarkdown(src, { interactive: true });
    expect(html).toContain('data-task="0"');
    expect(html).toContain('data-task="1" checked');
    expect(html).not.toContain('disabled');
    expect(renderTrackMarkdown('- [ ] a')).toContain('disabled');
  });

  it('referencias a issues, imágenes propias y código resaltado', () => {
    const html = renderTrackMarkdown('Ver ZER-12 y @ABC-3, no UTF8-x ni aZER-1 `ZER-9`');
    expect(html).toContain('data-issue-ref="ZER-12"');
    expect(html).toContain('data-issue-ref="ABC-3"');
    expect(html).not.toContain('data-issue-ref="ZER-1"');
    expect(html).not.toContain('data-issue-ref="ZER-9"');
    expect(extractIssueRefs('ZER-1 ZER-1 [x](/en/app/track/issues/abcdef12-3456)')).toEqual(['ZER-1', 'abcdef12-3456']);
    expect(renderTrackMarkdown('![p](/uploads/track/a.png)')).toContain('<img src="/uploads/track/a.png" alt="p" loading="lazy">');
    expect(renderTrackMarkdown('![p](https://evil.com/a.png)')).not.toContain('<img');
    const code = renderTrackMarkdown('```ts\nconst a = "<b>"; // hi\n```');
    expect(code).toContain('<span class="tk-k">const</span>');
    expect(code).toContain('<span class="tk-s">&quot;&lt;b&gt;&quot;</span>');
    expect(code).toContain('<span class="tk-c">// hi</span>');
    expect(highlightCode('<x>', 'nope')).toBe('&lt;x&gt;');
  });

  it('identificadores con guiones y colores de glifo legibles en ambos temas', async () => {
    expect(renderTrackMarkdown('Depende de SHOTS-7980-12.')).toContain('data-issue-ref="SHOTS-7980-12"');
    const { glyphColor } = await import('@/lib/track-color');
    expect(glyphColor('#0d0d0d')).toBe('var(--ink)');
    expect(glyphColor('#fafafa')).toBe('var(--ink)');
    expect(glyphColor('#e5484d')).toBe('#e5484d');
    expect(glyphColor('url(x)')).toBe('#767676');
  });
});

const issue = (over: Partial<TrackIssueWithStatus>): TrackIssueWithStatus =>
  ({
    id: crypto.randomUUID(),
    project_id: 'p1',
    identifier: 'ZER-1',
    title: 't',
    description: '[]',
    status_id: 's1',
    status_name: 'Todo',
    status_color: '#000',
    status_category: 'todo',
    priority: 'medium',
    assignee_id: null,
    assignee_name: null,
    assignee_email: null,
    creator_id: 'u',
    cycle_id: null,
    cycle_name: null,
    estimate: null,
    parent_id: null,
    start_date: null,
    due_date: null,
    labels: '[]',
    created_at: '',
    updated_at: '',
    child_count: 0,
    ...over,
  }) as TrackIssueWithStatus;

describe('sub-issues, deshacer y comandos', () => {
  it('nestIssues pone cada sub-issue bajo su padre', () => {
    const a = issue({ id: 'a' });
    const b = issue({ id: 'b' });
    const a1 = issue({ id: 'a1', parent_id: 'a' });
    const a1x = issue({ id: 'a1x', parent_id: 'a1' });
    const orphan = issue({ id: 'o', parent_id: 'zzz' });
    expect(nestIssues([a1x, b, a1, a, orphan]).map((r) => `${r.issue.id}:${r.depth}`)).toEqual(['b:0', 'a:0', 'a1:1', 'a1x:2', 'o:0']);
  });

  it('inversePatch devuelve los valores de antes', () => {
    const prev = issue({ priority: 'low', estimate: 3, labels: '[{"id":"l1","name":"A","color":"#000"}]', parent_id: 'p' });
    expect(inversePatch(prev, { priority: 'high', estimate: 5, labels: [], parentId: null })).toEqual({
      priority: 'low',
      estimate: 3,
      labels: [{ id: 'l1' }],
      parentId: 'p',
    });
    const reverted = revertPatchFields(issue({ priority: 'high' }), prev, { priority: 'high' });
    expect(reverted.priority).toBe('low');
  });

  it('atajos de Linear', () => {
    const k = (key: string, extra: Partial<KeyboardEvent> = {}) =>
      shortcutFor({ key, code: '', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...extra });
    expect(k('s')).toEqual({ page: 'status' });
    expect(k('p')).toEqual({ page: 'priority' });
    expect(k('a')).toEqual({ page: 'assignee' });
    expect(k('l')).toEqual({ page: 'labels' });
    expect(k('i')).toEqual({ run: 'assign-me' });
    expect(k('E', { shiftKey: true, code: 'KeyE' })).toEqual({ page: 'estimate' });
    expect(k('D', { shiftKey: true, code: 'KeyD' })).toEqual({ page: 'due' });
    expect(k('!', { shiftKey: true, code: 'Digit1' })).toEqual({ run: 'priority:1' });
    expect(k('o', { metaKey: true, shiftKey: true, code: 'KeyO' })).toEqual({ run: 'sub-issue' });
    expect(k('p', { metaKey: true, shiftKey: true, code: 'KeyP' })).toEqual({ page: 'parent' });
    expect(k('.', { ctrlKey: true, code: 'Period' })).toEqual({ run: 'copy-id' });
    expect(k('x')).toBeNull();
    expect(k('s', { altKey: true })).toBeNull();
  });

  it('fechas tipeadas en la paleta', () => {
    expect(parseDueQuery('2026-11-03', '2026-10-25')).toBe('2026-11-03');
    expect(parseDueQuery('+5', '2026-10-25')).toBe('2026-10-30');
    expect(parseDueQuery('3d', '2026-10-25')).toBe('2026-10-28');
    expect(parseDueQuery('3/11', '2026-10-25')).toBe('2026-11-03');
    expect(parseDueQuery('1/1', '2026-10-25')).toBe('2027-01-01');
    expect(parseDueQuery('31/2', '2026-10-25')).toBeNull();
    expect(parseDueQuery('mañana', '2026-10-25')).toBeNull();
  });

  it('acciones de ⌘K sobre el issue y sobre varios', () => {
    const applied: unknown[] = [];
    const data = {
      statuses: [
        { id: 's1', name: 'Todo', color: '#000', category: 'todo', position: 1, project_id: 'p1' },
        { id: 's2', name: 'Done', color: '#0a0', category: 'done', position: 2, project_id: 'p1' },
      ],
      members: [{ id: 'me', name: 'Yo', email: 'yo@x' }],
      labels: [{ id: 'l1', name: 'Bug', color: '#f00' }],
      cycles: [],
      milestones: [],
      priorities: [{ value: 'urgent', label: 'Urgent' }],
      meId: 'me',
      today: '2026-10-25',
    };
    const t = (k: string) => k;
    const one = buildIssueActions([issue({ id: 'x' })], data, { apply: (_t, p) => applied.push(p), remove: () => undefined }, t, (d) => d);
    const ids = one.map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(['status', 'priority', 'assignee', 'assign-me', 'labels', 'estimate', 'due', 'parent', 'copy-id', 'copy-link', 'copy-branch', 'delete']));
    one.find((a) => a.id === 'status')!.children!().find((c) => c.id === 'status:s2')!.run!();
    one.find((a) => a.id === 'labels')!.children!()[0].run!();
    expect(applied[0]).toEqual({ statusId: 's2' });
    expect(typeof applied[1]).toBe('function');
    expect((applied[1] as (i: TrackIssueWithStatus) => unknown)(issue({}))).toEqual({ labels: [{ id: 'l1', name: 'Bug', color: '#f00' }] });
    // Issues de dos proyectos: sin estado (cada proyecto tiene los suyos) ni copiar ID.
    const mixed = buildIssueActions([issue({ project_id: 'p1' }), issue({ project_id: 'p2' })], data, { apply: () => undefined }, t, (d) => d);
    expect(mixed.map((a) => a.id)).not.toContain('status');
    expect(mixed.map((a) => a.id)).not.toContain('copy-id');
  });
});

// ---------- Con base ----------

describe('Track UX: datos y rutas', () => {
  it('hilos: respuestas cuelgan del comentario raíz y borrar la raíz borra el hilo', async () => {
    const a = await makeUser('th');
    const p = await createProject(a.id, null, { name: 'Hilos' });
    const i = await createIssue(p.id, a.id, { title: 'x', description: [] }, app);
    const root = await createIssueComment(i.id, a.id, { body: 'raíz' });
    const reply = await createIssueComment(i.id, a.id, { body: 'r1', parentId: root.id });
    const nested = await createIssueComment(i.id, a.id, { body: 'r2', parentId: reply.id });
    expect(reply.parent_id).toBe(root.id);
    expect(nested.parent_id).toBe(root.id);
    const meta = (await listIssueActivities(i.id))
      .filter((x) => x.type === 'comment')
      .map((x) => JSON.parse(x.meta) as { parentId: string | null });
    expect(meta.filter((m) => m.parentId === root.id)).toHaveLength(2);

    session.user = { ...a, team: null, role: 'owner' };
    const params = (commentId: string) => ({ params: Promise.resolve({ id: i.id, commentId }) });
    // Resolver: solo la raíz.
    expect((await resolveRoute.POST(json('/x', 'POST', { resolved: true }), params(reply.id))).status).toBe(400);
    expect((await resolveRoute.POST(json('/x', 'POST', { resolved: true }), params(root.id))).status).toBe(200);
    const rootMeta = (await listIssueActivities(i.id)).find((x) => x.id === root.id)!;
    expect(JSON.parse(rootMeta.meta).resolvedAt).toBeTruthy();
    // Responder reabre.
    await commentsRoute.POST(json('/x', 'POST', { body: 'otra', parentId: root.id }), { params: Promise.resolve({ id: i.id }) });
    expect(JSON.parse((await listIssueActivities(i.id)).find((x) => x.id === root.id)!.meta).resolvedAt).toBeNull();

    // Reacciones: alterna y solo emojis permitidos.
    const r1 = await reactionsRoute.POST(json('/x', 'POST', { emoji: '👍' }), params(root.id));
    expect(((await r1.json()) as { active: boolean; reactions: unknown[] }).reactions).toHaveLength(1);
    const r2 = await reactionsRoute.POST(json('/x', 'POST', { emoji: '👍' }), params(root.id));
    expect(((await r2.json()) as { active: boolean }).active).toBe(false);
    expect((await reactionsRoute.POST(json('/x', 'POST', { emoji: '💩' }), params(root.id))).status).toBe(400);

    // Otro workspace no ve ni reacciona.
    const b = await makeUser('th2');
    session.user = { ...b, team: null, role: 'owner' };
    expect((await reactionsRoute.POST(json('/x', 'POST', { emoji: '👍' }), params(root.id))).status).toBe(404);
  });

  it('vistas de equipo y favoritas: se ven en el equipo, solo el dueño edita', async () => {
    const owner = await makeUser('vo');
    const mate = await makeUser('vm');
    const { createTeam } = await import('@/lib/teams');
    const team = await createTeam(owner.id, 'Vistas T1');
    const p = await createProject(owner.id, team.id, { name: 'Vistas' });
    const pid = { params: Promise.resolve({ id: p.id }) };

    session.user = { ...owner, team, role: 'owner' };
    const res = await viewsRoute.POST(
      json('/x', 'POST', { name: 'Urgentes', viewType: 'board', filters: { rules: [{ field: 'priority', op: 'is', values: ['urgent'] }] }, shared: true }),
      pid,
    );
    expect(res.status).toBe(201);
    const view = (await res.json()) as { id: string; shared: boolean };
    expect(view.shared).toBe(true);
    const personal = (await (await viewsRoute.POST(json('/x', 'POST', { name: 'Mía', viewType: 'list' }), pid)).json()) as { id: string };

    // La compañera ve la de equipo, no la personal; puede marcarla favorita pero no editarla.
    session.user = { ...owner, id: owner.id, actingUser: { id: mate.id }, team, role: 'member' };
    const list = (await (await viewsRoute.GET(json('/x', 'GET'), pid)).json()) as { rows: Array<{ id: string }> };
    expect(list.rows.map((r) => r.id)).toEqual([view.id]);
    const vp = (id: string) => ({ params: Promise.resolve({ id }) });
    expect((await viewRoute.GET(json('/x', 'GET'), vp(personal.id))).status).toBe(404);
    expect((await viewRoute.PATCH(json('/x', 'PATCH', { name: 'hack' }), vp(view.id))).status).toBe(404);
    expect((await viewRoute.DELETE(json('/x', 'DELETE'), vp(view.id))).status).toBe(404);
    expect((await favoriteRoute.POST(json('/x', 'POST', { favorite: true }), vp(view.id))).status).toBe(200);
    const favs = (await (await favoritesRoute.GET()).json()) as { rows: Array<{ id: string; project_name: string }> };
    expect(favs.rows.map((r) => [r.id, r.project_name])).toEqual([[view.id, 'Vistas']]);

    // El dueño la vuelve personal: desaparece para la compañera (y de sus favoritas).
    session.user = { ...owner, team, role: 'owner' };
    expect((await viewRoute.PATCH(json('/x', 'PATCH', { shared: false }), vp(view.id))).status).toBe(200);
    session.user = { ...owner, id: owner.id, actingUser: { id: mate.id }, team, role: 'member' };
    expect(((await (await favoritesRoute.GET()).json()) as { rows: unknown[] }).rows).toHaveLength(0);
  });

  it('filtros avanzados por la API, sub-issues ocultos y orden manual', async () => {
    const a = await makeUser('fa');
    const p = await createProject(a.id, null, { name: 'Filtros' });
    const parent = await createIssue(p.id, a.id, { title: 'padre', description: [], priority: 'urgent' }, app);
    const c1 = await createIssue(p.id, a.id, { title: 'hijo 1', description: [], parentId: parent.id, estimate: 3 }, app);
    const c2 = await createIssue(p.id, a.id, { title: 'hijo 2', description: [], parentId: parent.id, assigneeId: a.id }, app);
    session.user = { ...a, team: null, role: 'owner' };
    const get = async (qs: string) =>
      (await (await projectIssuesRoute.GET(json(`/x?${qs}`, 'GET'), { params: Promise.resolve({ id: p.id }) })).json()) as {
        rows: Array<{ id: string; child_count: number; child_done: number; parent_identifier: string | null }>;
        total: number;
      };
    const f = (rules: unknown, match = 'and') => `filter=${encodeURIComponent(JSON.stringify({ match, rules }))}`;
    expect((await get(f([{ field: 'hierarchy', op: 'is', values: ['sub'] }]))).total).toBe(2);
    expect((await get(f([{ field: 'assignee', op: 'is', values: ['__none__'] }]))).total).toBe(2);
    expect((await get(f([{ field: 'estimate', op: 'gte', values: ['2'] }]))).rows.map((r) => r.id)).toEqual([c1.id]);
    expect(
      (await get(f([{ field: 'priority', op: 'is', values: ['urgent'] }, { field: 'estimate', op: 'not_empty', values: [] }], 'or'))).total,
    ).toBe(2);
    expect((await get(f([{ field: 'creator', op: 'is_not', values: [a.id] }]))).total).toBe(0);
    expect((await get('topLevel=1')).rows.map((r) => r.id)).toEqual([parent.id]);
    const top = (await get('topLevel=1')).rows[0];
    expect([top.child_count, top.child_done]).toEqual([2, 0]);
    expect((await get(f([{ field: 'hierarchy', op: 'is', values: ['sub'] }]))).rows[0].parent_identifier).toBe(parent.identifier);
    // La lista vieja (statusId=) sigue andando.
    const statuses = await listStatuses(p.id);
    expect((await listIssues(p.id, { statusId: [statuses[0].id] })).total).toBeGreaterThanOrEqual(0);

    // Orden manual de sub-issues.
    await updateIssue(c2.id, { subOrder: 1 }, a.id);
    await updateIssue(c1.id, { subOrder: 2 }, a.id);
    expect((await listIssueChildren(parent.id)).map((c) => c.id)).toEqual([c2.id, c1.id]);
    expect((await getIssue(c1.id))!.sub_order).toBe(2);
  });

  it('firmas en vivo cambian con cada cambio y las refs respetan el workspace', async () => {
    const a = await makeUser('lv');
    const b = await makeUser('lv2');
    const p = await createProject(a.id, null, { name: 'Vivo' });
    const i = await createIssue(p.id, a.id, { title: 'uno', description: [] }, app);
    const s1 = await projectSignature(p.id);
    const is1 = await issueSignature(i.id);
    await new Promise((r) => setTimeout(r, 5));
    await updateIssue(i.id, { title: 'dos' }, a.id);
    expect(await projectSignature(p.id)).not.toBe(s1);
    await createIssueComment(i.id, a.id, { body: 'hola' });
    expect(await issueSignature(i.id)).not.toBe(is1);
    expect(await issueSignature('nope')).toBe('gone');

    expect((await resolveIssueRefs([i.identifier], null, a.id)).map((r) => r.id)).toEqual([i.id]);
    expect(await resolveIssueRefs([i.identifier, i.id], null, b.id)).toEqual([]);

    session.user = { ...a, team: null, role: 'owner' };
    const live = (await (await liveRoute.POST(json('/x', 'POST', { issueId: i.id, present: true }))).json()) as { sig: string; viewers: unknown[] };
    expect(live.viewers).toEqual([]);
    // b abre el mismo issue: no tiene acceso.
    session.user = { ...b, team: null, role: 'owner' };
    expect((await liveRoute.POST(json('/x', 'POST', { issueId: i.id, present: true }))).status).toBe(404);
    expect((await liveRoute.POST(json('/x', 'POST', { projectId: p.id }))).status).toBe(404);
    expect((await refsRoute.GET(json(`/x?refs=${i.identifier}`, 'GET'))).status).toBe(200);
    expect(((await (await refsRoute.GET(json(`/x?refs=${i.identifier}`, 'GET'))).json()) as { rows: unknown[] }).rows).toEqual([]);
  });
});
