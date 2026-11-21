import { describe, expect, it } from 'vitest';
import {
  applyFilters,
  groupTimeline,
  matchesQuery,
  tabCounts,
  timelineAuthors,
  TIMELINE_TYPES,
  type ModelItem,
  type TimelineFilters,
} from '@/components/crm/timelineModel';

const NOW = new Date(2026, 10, 21, 12, 0, 0); // 21 nov 2026, hora local

function item(p: Partial<ModelItem> & { id: string; type: string }): ModelItem {
  return { subject: '', body: '', due_at: null, created_at: '2026-11-20 10:00:00', done: 0, pinned: 0, ...p };
}

const base: TimelineFilters = { tab: 'all', types: [...TIMELINE_TYPES], users: null, query: '', associated: true };

describe('timeline model', () => {
  const items = [
    item({ id: 'n1', type: 'note', body: 'Habló de la Reunión anual', author_id: 'u1', author_name: 'Ana' }),
    item({ id: 'c1', type: 'call', subject: 'Intro', author_id: 'u2', author_name: 'Beto', rollup: 1, contact_name: 'Carla' }),
    item({ id: 't1', type: 'task', subject: 'Follow up', due_at: '2026-11-25 15:00:00', author_id: 'u1', author_name: 'Ana' }),
    item({ id: 'e1', type: 'email', subject: 'Pricing', thread: { messages: [{ snippet: 'the quote is attached' }] } }),
    item({ id: 'w1', type: 'whatsapp', subject: 'Chat', wa: { messages: [{ who: 'Cliente', text: 'hola necesito factura' }] } }),
  ];

  it('tabs count what is in view, with or without associated activity', () => {
    expect(tabCounts(items, true)).toMatchObject({ all: 5, note: 1, call: 1, task: 1, email: 1, whatsapp: 1, meeting: 0 });
    expect(tabCounts(items, false)).toMatchObject({ all: 4, call: 0 });
  });

  it('filters by tab, by checked types, by user and hides associated activity', () => {
    expect(applyFilters(items, { ...base, tab: 'task' }).map((i) => i.id)).toEqual(['t1']);
    expect(applyFilters(items, { ...base, types: ['note', 'call'] }).map((i) => i.id)).toEqual(['n1', 'c1']);
    expect(applyFilters(items, { ...base, users: ['u1'] }).map((i) => i.id)).toEqual(['n1', 't1']);
    expect(applyFilters(items, { ...base, associated: false }).map((i) => i.id)).not.toContain('c1');
    // En una pestaña de tipo, los tipos tildados no cuentan.
    expect(applyFilters(items, { ...base, tab: 'call', types: ['note'] }).map((i) => i.id)).toEqual(['c1']);
  });

  it('search ignores case and accents and reads emails, chats and associated names', () => {
    expect(matchesQuery(items[0], 'reunion ANUAL')).toBe(true);
    expect(applyFilters(items, { ...base, query: 'quote' }).map((i) => i.id)).toEqual(['e1']);
    expect(applyFilters(items, { ...base, query: 'factura' }).map((i) => i.id)).toEqual(['w1']);
    expect(applyFilters(items, { ...base, query: 'carla' }).map((i) => i.id)).toEqual(['c1']);
    expect(applyFilters(items, { ...base, query: 'nothing here' })).toEqual([]);
  });

  it('authors are listed once, by name', () => {
    expect(timelineAuthors(items)).toEqual([
      { id: 'u1', name: 'Ana' },
      { id: 'u2', name: 'Beto' },
    ]);
  });

  it('groups: pinned, upcoming (soonest first), this month, then each month back', () => {
    const g = groupTimeline(
      [
        item({ id: 'p', type: 'note', pinned: 1, created_at: '2026-01-01 10:00:00' }),
        item({ id: 'later', type: 'task', due_at: '2026-12-10 10:00:00' }),
        item({ id: 'soon', type: 'meeting', due_at: '2026-11-22 10:00:00' }),
        item({ id: 'doneFuture', type: 'task', done: 1, due_at: '2026-11-30 10:00:00' }),
        item({ id: 'now1', type: 'note', created_at: '2026-11-05 10:00:00' }),
        item({ id: 'overdue', type: 'task', due_at: '2026-11-10 10:00:00' }),
        item({ id: 'oct', type: 'call', created_at: '2026-10-15 10:00:00' }),
        item({ id: 'aug', type: 'call', created_at: '2026-08-15 10:00:00' }),
      ],
      NOW,
    );
    expect(g.map((x) => x.kind)).toEqual(['pinned', 'upcoming', 'thisMonth', 'month', 'month']);
    // Las vencidas también, primero (de la más vieja a la más lejana).
    expect(g[1].items.map((i) => i.id)).toEqual(['overdue', 'soon', 'later']);
    // Una tarea ya hecha con fecha futura no es "próxima".
    expect(g[2].items.map((i) => i.id)).toEqual(['doneFuture', 'now1']);
    expect(g[3].month?.getMonth()).toBe(9);
    expect(g[4].items.map((i) => i.id)).toEqual(['aug']);
  });
});
