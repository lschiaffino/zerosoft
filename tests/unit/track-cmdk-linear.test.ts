import { describe, expect, it } from 'vitest';
import { hasExactOption, queryRank, rankPageItems, type CommandAction } from '@/lib/cmdk-context';
import { buildIssueActions, issueHref, PRIORITY_MENU_ORDER, shortcutFor } from '@/components/track/trackCommands';
import type { TrackIssueWithStatus } from '@/lib/track-data';

const opt = (id: string, label: string, extra: Partial<CommandAction> = {}): CommandAction => ({ id, label, ...extra });

const issue = (over: Partial<TrackIssueWithStatus> = {}): TrackIssueWithStatus =>
  ({
    id: 'i1',
    project_id: 'p1',
    identifier: 'MOB-12',
    title: 'Arreglar el login',
    description: '[]',
    status_id: 's1',
    status_name: 'Todo',
    status_color: '#000',
    status_category: 'todo',
    priority: 'none',
    assignee_id: null,
    labels: '[]',
    child_count: 0,
    ...over,
  }) as TrackIssueWithStatus;

const data = {
  statuses: [
    { id: 's1', name: 'Todo', color: '#000', category: 'todo', position: 1, project_id: 'p1' },
    { id: 's2', name: 'In Progress', color: '#f90', category: 'in_progress', position: 2, project_id: 'p1' },
    { id: 's3', name: 'Done', color: '#0a0', category: 'done', position: 3, project_id: 'p1' },
  ],
  members: [{ id: 'me', name: 'Yo', email: 'yo@x' }],
  labels: [],
  cycles: [],
  milestones: [],
  priorities: [
    { value: 'urgent', label: 'Urgent' },
    { value: 'high', label: 'High' },
    { value: 'medium', label: 'Medium' },
    { value: 'low', label: 'Low' },
    { value: 'none', label: 'No priority' },
  ],
  meId: 'me',
  today: '2026-10-25',
};
const t = (k: string, v?: Record<string, string | number>) => (v ? `${k}:${Object.values(v).join(',')}` : k);

describe('menús de ⌘K como Linear', () => {
  it('al tipear, "Sin X" va después de lo que coincide (⇧P + "pro" no elige "No project")', () => {
    const items = [opt('project:none', 'No project', { isNone: true }), opt('project:a', 'Pagos'), opt('project:b', 'Producto web')];
    const ranked = rankPageItems(items, 'pro');
    expect(ranked[0].id).toBe('project:b');
    expect(ranked.at(-1)!.id).toBe('project:none');
    // Lo del servidor se queda aunque el label no coincida; "No project" sin coincidencia se va.
    const server = opt('project:c', 'Checkout');
    expect(rankPageItems([items[0], server], 'zzz', new Set([server])).map((a) => a.id)).toEqual(['project:c']);
    expect(rankPageItems(items, '')).toBe(items);
  });

  it('ranking y opción exacta (sin tildes)', () => {
    expect(queryRank(opt('x', 'Diseño'), 'dise')).toBe(0.5);
    expect(queryRank(opt('x', 'MOB-1 Login'), 'mob-1')).toBe(0);
    expect(rankPageItems([opt('a', 'MOB-12 Otro'), opt('b', 'MOB-10 X'), opt('c', 'MOB-1 Login')], 'MOB-1')[0].id).toBe('c');
    expect(queryRank(opt('x', 'Nuevo diseño'), 'dis')).toBe(1);
    expect(queryRank(opt('x', 'Rediseño'), 'dis')).toBe(2);
    expect(queryRank(opt('x', 'Algo', { keywords: 'bug' }), 'bug')).toBe(3);
    expect(queryRank(opt('x', 'Algo'), 'zz')).toBe(-1);
    expect(hasExactOption([opt('a', 'Bug')], 'bug')).toBe(true);
    expect(hasExactOption([opt('a', 'Bug')], 'bugs')).toBe(false);
  });

  it('prioridad con "No priority" y dígitos 0–4; estado con 1–9; labels siempre con crear', () => {
    const actions = buildIssueActions([issue()], data, { apply: () => undefined }, t, (d) => d);
    const prio = actions.find((a) => a.id === 'priority')!.children!();
    expect(prio.map((p) => p.id)).toEqual(PRIORITY_MENU_ORDER.map((v) => `priority:${v}`));
    expect(prio.map((p) => p.digit)).toEqual(['0', '1', '2', '3', '4']);
    expect(prio[0].checked).toBe(true);
    const status = actions.find((a) => a.id === 'status')!.children!();
    expect(status.map((s) => s.digit)).toEqual(['1', '2', '3']);
    expect(status[1].icon).toEqual({ kind: 'status', color: '#f90', category: 'in_progress' });
    // Team sin labels: L igual existe y ofrece crear.
    const labels = actions.find((a) => a.id === 'labels')!;
    expect(labels.create?.label('bug')).toBe('createLabel:bug');
    // Atajos planos solo al tipear.
    expect(actions.find((a) => a.id === 'flat-status:s3')?.searchOnly).toBe(true);
  });

  it('atajos nuevos: ⌘⌫ borra, ⇧0 sin prioridad, ⇧L quita labels, ⌘⇧, copia la URL', () => {
    const k = (over: Partial<KeyboardEvent>) => ({ key: '', code: '', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...over });
    expect(shortcutFor(k({ key: 'Backspace', metaKey: true }))).toEqual({ run: 'delete' });
    expect(shortcutFor(k({ key: ')', code: 'Digit0', shiftKey: true }))).toEqual({ run: 'priority:0' });
    expect(shortcutFor(k({ key: 'L', code: 'KeyL', shiftKey: true }))).toEqual({ page: 'remove-labels' });
    expect(shortcutFor(k({ key: '<', code: 'Comma', shiftKey: true, metaKey: true }))).toEqual({ run: 'copy-link' });
  });

  it('URL del issue por identificador con slug del título', () => {
    expect(issueHref({ id: 'x', identifier: 'MOB-12', title: 'Arreglar el login (iOS)' })).toBe('/app/track/issue/MOB-12/arreglar-el-login-ios');
    expect(issueHref({ id: 'x', identifier: 'MOB-12' })).toBe('/app/track/issue/MOB-12');
  });
});

// ---------- Con base: IDs viejos, claves por workspace y prioridad "none" ----------

import { createIssue, createProject, getAccessibleIssue, moveIssueToTeam, resolveIssueRef, updateIssue } from '@/lib/track-data';
import { titleFromComment } from '@/lib/track-comment-title';
import { makeUser } from './helpers';

describe('Track: IDs como Linear', () => {
  it('el ID viejo de un issue movido de team resuelve al issue (y la URL con identificador abre)', async () => {
    const u = await makeUser('alias');
    const a = await createProject(u.id, null, { name: 'Origen' });
    const b = await createProject(u.id, null, { name: 'Destino' });
    const issue = await createIssue(a.id, u.id, { title: 'mover', description: [] });
    const old = issue.identifier;
    const moved = (await moveIssueToTeam(issue.id, b.id, u.id))!;
    expect(moved.identifier).not.toBe(old);
    expect(await resolveIssueRef(old, null, u.id)).toBe(issue.id);
    expect(await resolveIssueRef(moved.identifier.toLowerCase(), null, u.id)).toBe(issue.id);
    expect((await getAccessibleIssue(old, null, u.id))?.issue.id).toBe(issue.id);
    // Otro workspace no lo ve aunque tenga la misma clave.
    const other = await makeUser('alias2');
    await createProject(other.id, null, { name: 'Origen' });
    expect(await getAccessibleIssue(old, null, other.id)).toBeNull();
  });

  it('"No priority" se guarda y las claves de team son de tres letras', async () => {
    const u = await makeUser('nopri');
    const p = await createProject(u.id, null, { name: 'Mobile App' });
    expect(p.slug).toBe('mob');
    const issue = await createIssue(p.id, u.id, { title: 'sin prioridad', description: [], priority: 'none' });
    expect(issue.priority).toBe('none');
    expect(issue.identifier).toBe('MOB-1');
    const up = await updateIssue(issue.id, { priority: 'urgent' }, u.id);
    expect(up?.priority).toBe('urgent');
  });

  it('título de sub-issue desde un comentario: la primera línea sin markdown', () => {
    expect(titleFromComment('\n- [ ] **Revisar** el `login`\notra')).toBe('Revisar el login');
    expect(titleFromComment('## Título\ncuerpo')).toBe('Título');
    expect(titleFromComment('   ')).toBe('');
  });
});

import { listFavoriteIssues, setIssueFavorite } from '@/lib/track-issue-favorites';

describe('Track: issues favoritos (estrella)', () => {
  it('se marcan por persona y el listado solo trae los que se pueden ver', async () => {
    const u = await makeUser('fav');
    const p = await createProject(u.id, null, { name: 'Fav' });
    const issue = await createIssue(p.id, u.id, { title: 'estrella', description: [] });
    expect(await setIssueFavorite(issue.id, u.id, true)).toBe(true);
    expect((await listFavoriteIssues(null, u.id, u.id)).map((i) => i.id)).toEqual([issue.id]);
    const other = await makeUser('fav2');
    await setIssueFavorite(issue.id, other.id, true);
    // Otro workspace: no lo ve aunque lo haya marcado.
    expect(await listFavoriteIssues(null, other.id, other.id)).toEqual([]);
    expect(await setIssueFavorite(issue.id, u.id, false)).toBe(false);
    expect(await listFavoriteIssues(null, u.id, u.id)).toEqual([]);
  });
});

import { createCycle } from '@/lib/track-data';
import { createLabel } from '@/lib/track-labels';
import { searchApps } from '@/lib/app-search';
import { estimateChoices } from '@/components/track/trackCommands';

describe('⌘K de Track: cycles, labels y teams', () => {
  it('encuentra cycles y labels del workspace y el team va bajo "Teams"', async () => {
    const word = `zeta${crypto.randomUUID().slice(0, 5)}`;
    const u = await makeUser('cmdk3');
    const p = await createProject(u.id, null, { name: `Team ${word}` });
    await createCycle(p.id, { name: `Sprint ${word}`, startAt: '2026-10-20', endAt: '2026-11-03' });
    const label = await createLabel(u.id, { name: `lbl-${word}` });
    expect(label.ok).toBe(true);
    const groups = (await searchApps(u, word)).map((i) => i.group);
    expect(groups).toEqual(expect.arrayContaining(['teams', 'trackCycles', 'trackLabels']));
    expect(groups).not.toContain('projects');
  });

  it('escalas de estimación como Linear', () => {
    expect(estimateChoices().map((o) => o.value)).toEqual([0, 1, 2, 3, 5, 8]);
    expect(estimateChoices('tshirt').map((o) => o.label)).toEqual(['XS', 'S', 'M', 'L', 'XL']);
    expect(estimateChoices('none')).toEqual([]);
  });
});
