import { describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import { createPost, saveDiscoveredAccounts, setAccountMembers, type SocialActor } from '@/lib/social';
import { countTags, matchTags, tagAtCaret } from '@/lib/social-tag-match';
import { socialTagSuggestions } from '@/lib/social-tags';
import { makeUser } from './helpers';

describe('Social: sugerencias de hashtags y menciones', () => {
  it('cuenta por texto, sin distinguir mayúsculas, y se queda con la forma más usada', () => {
    const r = countTags(['Hola #Coffee @ana', '#coffee y #coffee #roast', 'otra #Coffee @ana @bob']);
    expect(r.hashtags).toEqual([
      { tag: 'Coffee', n: 3 },
      { tag: 'roast', n: 1 },
    ]);
    expect(r.mentions[0]).toEqual({ tag: 'ana', n: 2 });
  });

  it('encuentra el tag que se está escribiendo antes del cursor', () => {
    expect(tagAtCaret('Hola #caf', 9)).toEqual({ kind: '#', query: 'caf', start: 5 });
    expect(tagAtCaret('#', 1)).toEqual({ kind: '#', query: '', start: 0 });
    expect(tagAtCaret('hi @ana.b', 9)).toEqual({ kind: '@', query: 'ana.b', start: 3 });
    // Pegado a una palabra (un mail) o con espacio después: no.
    expect(tagAtCaret('mail@x', 6)).toBeNull();
    expect(tagAtCaret('#caf ', 5)).toBeNull();
    expect(tagAtCaret('#a.b', 4)).toBeNull();
  });

  it('sugiere los que empiezan con lo escrito, sin el que ya está completo', () => {
    const list = [
      { tag: 'coffee', n: 3 },
      { tag: 'Coffeeshop', n: 2 },
      { tag: 'roast', n: 1 },
    ];
    expect(matchTags(list, 'cof').map((x) => x.tag)).toEqual(['coffee', 'Coffeeshop']);
    expect(matchTags(list, 'coffee').map((x) => x.tag)).toEqual(['Coffeeshop']);
    expect(matchTags(list, '').length).toBe(3);
  });

  it('salen de lo que la persona ve y de los grupos de hashtags', async () => {
    const o = await makeUser('tagowner');
    const m = await makeUser('tagmember');
    const teamId = `t-${o.id}`;
    const db = getDb();
    await db.prepare("INSERT INTO teams (id, name, owner_id) VALUES (?, 'T', ?)").run(teamId, o.id);
    await db.prepare('INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, ?, ?)').run(teamId, m.id, 'member', '["social"]');
    const owner: SocialActor = { workspaceId: o.id, personId: o.id, role: 'owner' };
    const member: SocialActor = { workspaceId: o.id, personId: m.id, role: 'member' };
    const [fb, li] = await saveDiscoveredAccounts(o.id, o.id, [
      { network: 'facebook', kind: 'page', externalId: 'tp1', name: 'Page', tokens: { accessToken: 'a', expiresAt: null } },
      { network: 'linkedin', kind: 'profile', externalId: 'urn:li:person:t1', name: 'Me', tokens: { accessToken: 'b', expiresAt: null }, meta: { author: 'urn:li:person:t1' } },
    ]);
    await setAccountMembers(owner, fb, [member.personId]);
    await createPost(owner, { text: 'Para todos #public', accountIds: [fb], action: 'draft' });
    await createPost(owner, { text: 'Solo LinkedIn #secret @boss', accountIds: [li], action: 'draft' });
    await db
      .prepare("INSERT INTO social_library (id, workspace_id, kind, name, body, created_by, created_at, updated_at) VALUES (?, ?, 'hashtags', 'Set', '#fromset', ?, ?, ?)")
      .run(`lib-${o.id}`, o.id, o.id, new Date().toISOString(), new Date().toISOString());

    const mine = await socialTagSuggestions(owner);
    expect(mine.hashtags.map((x) => x.tag).sort()).toEqual(['fromset', 'public', 'secret']);
    expect(mine.mentions.map((x) => x.tag)).toEqual(['boss']);
    const theirs = await socialTagSuggestions(member);
    expect(theirs.hashtags.map((x) => x.tag).sort()).toEqual(['fromset', 'public']);
    expect(theirs.mentions).toEqual([]);
  });
});
