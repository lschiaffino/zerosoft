import { describe, expect, it } from 'vitest';
import {
  EMPTY_INBOX_FILTER,
  INBOX_NONE,
  compareInbox,
  inboxFilterCount,
  inboxFilterParams,
  inboxGroupKey,
  inboxKind,
  matchesInboxFilter,
  parseInboxFilter,
  type InboxFacts,
} from '@/lib/notification-inbox-filter';
import { issueIdOf } from '@/lib/notification-inbox';

const fact = (over: Partial<InboxFacts & { projectName: string | null }> = {}): InboxFacts & { projectName: string | null } => ({
  kind: 'mention',
  projectId: null,
  projectName: null,
  team: null,
  actorId: null,
  read: false,
  at: '2026-11-10T10:00:00.000Z',
  ...over,
});

describe('bandeja de Track: filtros', () => {
  it('agrupa los tipos de aviso en los que ve la persona', () => {
    expect(inboxKind('status_change')).toBe('status');
    expect(inboxKind('subtask')).toBe('update');
    expect(inboxKind('track_reminder')).toBe('reminder');
    expect(inboxKind('crm_quote')).toBe('other');
  });

  it('lee la URL y la vuelve a escribir solo con lo que no es por defecto', () => {
    const f = parseInboxFilter(new URLSearchParams('read=unread&kind=mention&kind=nope&kind=mention&project=p1&from=u1&order=oldest&group=project'));
    expect(f).toEqual({ read: 'unread', kinds: ['mention'], projects: ['p1'], teams: [], actors: ['u1'], order: 'oldest', group: 'project' });
    expect(inboxFilterParams(f).toString()).toBe('read=unread&kind=mention&project=p1&from=u1&order=oldest&group=project');
    expect(inboxFilterParams(EMPTY_INBOX_FILTER).toString()).toBe('');
    expect(parseInboxFilter(new URLSearchParams('read=maybe&order=sideways&group=x'))).toEqual(EMPTY_INBOX_FILTER);
    expect(inboxFilterCount(f)).toBe(4);
  });

  it('filtra por leídas, tipo, project (y sin project), team y quién', () => {
    const a = fact({ read: true, kind: 'assigned', projectId: 'p1', team: 'Web', actorId: 'u1' });
    const b = fact({ kind: 'comment' });
    expect(matchesInboxFilter(a, { ...EMPTY_INBOX_FILTER, read: 'unread' })).toBe(false);
    expect(matchesInboxFilter(a, { ...EMPTY_INBOX_FILTER, read: 'read' })).toBe(true);
    expect(matchesInboxFilter(b, { ...EMPTY_INBOX_FILTER, kinds: ['assigned', 'comment'] })).toBe(true);
    expect(matchesInboxFilter(b, { ...EMPTY_INBOX_FILTER, projects: [INBOX_NONE] })).toBe(true);
    expect(matchesInboxFilter(a, { ...EMPTY_INBOX_FILTER, projects: [INBOX_NONE] })).toBe(false);
    expect(matchesInboxFilter(a, { ...EMPTY_INBOX_FILTER, teams: ['Web'], actors: ['u1'] })).toBe(true);
    expect(matchesInboxFilter(b, { ...EMPTY_INBOX_FILTER, actors: ['u1'] })).toBe(false);
  });

  it('ordena por fecha y, agrupado, primero por grupo con "sin" al final', () => {
    const old = fact({ at: '2026-11-01T00:00:00.000Z', kind: 'comment', projectId: 'p2', projectName: 'Beta' });
    const mid = fact({ at: '2026-11-05T00:00:00.000Z', kind: 'mention' });
    const now = fact({ at: '2026-11-09T00:00:00.000Z', kind: 'comment', projectId: 'p1', projectName: 'Alpha' });
    const rows = [old, mid, now];
    expect([...rows].sort(compareInbox({ order: 'newest', group: 'none' }))).toEqual([now, mid, old]);
    expect([...rows].sort(compareInbox({ order: 'oldest', group: 'none' }))).toEqual([old, mid, now]);
    expect([...rows].sort(compareInbox({ order: 'newest', group: 'kind' }))).toEqual([mid, now, old]);
    expect([...rows].sort(compareInbox({ order: 'newest', group: 'project' }))).toEqual([now, old, mid]);
    expect(inboxGroupKey(mid, 'project')).toBe(INBOX_NONE);
    expect(inboxGroupKey(now, 'kind')).toBe('comment');
  });

  it('saca el issue de un aviso por su origen o por el link', () => {
    expect(issueIdOf({ source_type: 'track_issue', source_id: 'i1', href: null })).toBe('i1');
    expect(issueIdOf({ source_type: 'track_comment', source_id: 'c1', href: '/app/track/issues/i2#c1' })).toBe('i2');
    expect(issueIdOf({ source_type: 'docs_page', source_id: 'd1', href: '/app/docs/d1' })).toBeNull();
  });
});
