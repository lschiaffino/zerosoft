import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareIssues, insertIssueSorted, type IssueSort } from '@/lib/track-views';
import { issueKeyAction, issueKeyHint } from '@/lib/track-keys';
import { defaultIssueStatus } from '@/lib/track-tasks';
import { createIssue, createProject, listStatuses } from '@/lib/track-data';
import { makeUser } from './helpers';

/** Arreglos del benchmark (Track, Cal, Link): la lógica detrás de cada uno. */

type I = Parameters<typeof compareIssues>[1];
const issue = (id: string, over: Partial<I> = {}): I => ({
  id,
  identifier: `P-${id}`,
  created_at: `2030-01-0${id}T00:00:00.000Z`,
  updated_at: `2030-01-0${id}T00:00:00.000Z`,
  priority: 'medium',
  due_date: null,
  ...over,
});

describe('Track: el issue nuevo va donde lo pone el orden', () => {
  const list = [issue('3'), issue('2'), issue('1')];
  const fresh = issue('9', { created_at: '2030-02-01T00:00:00.000Z', updated_at: '2030-02-01T00:00:00.000Z' });

  it('Newest y Updated: arriba; Oldest: abajo', () => {
    expect(insertIssueSorted(list, fresh, 'newest')[0].id).toBe('9');
    expect(insertIssueSorted(list, fresh, 'updated')[0].id).toBe('9');
    const oldest = insertIssueSorted([...list].reverse(), fresh, 'oldest');
    expect(oldest.at(-1)?.id).toBe('9');
  });

  it('Priority y Due: en su lugar, no al final', () => {
    const byPrio = [issue('1', { priority: 'urgent' }), issue('2', { priority: 'medium' }), issue('3', { priority: 'low' })];
    const high = issue('9', { priority: 'high', created_at: '2030-02-01T00:00:00.000Z' });
    expect(insertIssueSorted(byPrio, high, 'priority').map((i) => i.id)).toEqual(['1', '9', '2', '3']);
    const byDue = [issue('1', { due_date: '2030-03-01' }), issue('2', { due_date: '2030-03-10' }), issue('3')];
    const due = issue('9', { due_date: '2030-03-05' });
    expect(insertIssueSorted(byDue, due, 'due').map((i) => i.id)).toEqual(['1', '9', '2', '3']);
    // Sin fecha va con los sin fecha (al final).
    expect(insertIssueSorted(byDue, issue('8'), 'due').at(-1)?.id).toBe('3');
  });

  it('el comparador sigue al ORDER BY de cada orden', () => {
    const a = issue('1');
    const b = issue('2');
    const cases: Array<[IssueSort, number]> = [
      ['newest', 1],
      ['oldest', -1],
      ['identifier', -1],
    ];
    for (const [sort, sign] of cases) expect(Math.sign(compareIssues(sort, a, b))).toBe(sign);
  });
});

describe('Track: atajos del issue', () => {
  const key = (k: Partial<Parameters<typeof issueKeyAction>[0]>) =>
    issueKeyAction({ key: '', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...k });

  it('⌘⌫ / Ctrl+Backspace borra y ⌘⇧, copia el link', () => {
    expect(key({ key: 'Backspace', metaKey: true })).toBe('delete');
    expect(key({ key: 'Delete', ctrlKey: true })).toBe('delete');
    expect(key({ key: ',', metaKey: true, shiftKey: true })).toBe('copyLink');
    expect(key({ key: '<', code: 'Comma', ctrlKey: true, shiftKey: true })).toBe('copyLink');
  });

  it('sin modificador (o con Alt) no hace nada', () => {
    expect(key({ key: 'Backspace' })).toBeNull();
    expect(key({ key: 'Backspace', metaKey: true, altKey: true })).toBeNull();
    expect(key({ key: ',', metaKey: true })).toBeNull();
  });

  it('la pista cambia según la plataforma', () => {
    expect(issueKeyHint('delete', true)).toBe('⌘⌫');
    expect(issueKeyHint('copyLink', false)).toBe('Ctrl+Shift+,');
  });
});

describe('Track: un solo status por defecto', () => {
  const st = (id: string, category: 'backlog' | 'todo' | 'in_progress' | 'done' | 'cancelled', position: number) => ({
    id,
    name: id,
    color: '#000',
    category,
    position,
  });

  it('Todo antes que Backlog; si no hay, Backlog; si no, el primero abierto', () => {
    expect(defaultIssueStatus([st('b', 'backlog', 0), st('t', 'todo', 1), st('d', 'done', 2)])?.id).toBe('t');
    expect(defaultIssueStatus([st('d', 'done', 0), st('b', 'backlog', 1)])?.id).toBe('b');
    expect(defaultIssueStatus([st('d', 'done', 0), st('p', 'in_progress', 1)])?.id).toBe('p');
    expect(defaultIssueStatus([])).toBeUndefined();
  });

  it('createIssue sin statusId (API, Flow, agentes) usa el mismo que el quick-create', async () => {
    const u = await makeUser('default-status');
    const project = await createProject(u.id, null, { name: `P ${crypto.randomUUID().slice(0, 6)}` });
    const statuses = await listStatuses(project.id);
    const created = await createIssue(project.id, u.id, { title: 'sin status' } as Parameters<typeof createIssue>[2]);
    expect(created.status_id).toBe(defaultIssueStatus(statuses)?.id);
    expect(created.status_category).toBe('todo');
  });
});

describe('Breadcrumb de la app: cada sección tiene su nombre', () => {
  const root = join(process.cwd(), 'app/[locale]/app');
  const layout = readFileSync(join(root, 'layout.tsx'), 'utf8');
  const sections = [...layout.matchAll(/\{ href: '([^']+)', label:/g)].map((m) => m[1]);

  function staticRoutes(dir: string, prefix = '/app'): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (!statSync(full).isDirectory() || name.startsWith('[') || name.startsWith('(')) continue;
      const route = `${prefix}/${name}`;
      if (readdirSync(full).includes('page.tsx')) out.push(route);
      out.push(...staticRoutes(full, route));
    }
    return out;
  }

  const sectionFor = (path: string) =>
    sections.filter((s) => path === s || path.startsWith(`${s}/`)).sort((a, b) => b.length - a.length)[0];

  it('las secciones nuevas (analytics de Cal, carpetas, duplicados, tablas) tienen la suya', () => {
    for (const r of ['/app/calendar/analytics', '/app/links/folders', '/app/crm/companies/duplicates', '/app/flow/tables']) {
      expect(sectionFor(r)).toBe(r);
    }
  });

  it('ninguna página de una app cae en el "Overview" de su producto', () => {
    const products = new Set(sections.filter((s) => s.split('/').length === 3));
    // Rutas que redirigen o que son un paso de su sección (/new, ajustes de la cuenta).
    const allowed = /\/new$|^\/app\/settings\/|^\/app\/chat\/settings$/;
    const orphans = staticRoutes(root).filter((r) => r.split('/').length >= 4 && !allowed.test(r) && products.has(sectionFor(r)));
    expect(orphans).toEqual([]);
  });
});
