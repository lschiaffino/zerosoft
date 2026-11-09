import { describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import { createApiKey, listApiKeys, validateApiKey } from '@/lib/api-auth';
import { getIntegration, upsertIntegration } from '@/lib/integrations';
import { open, seal } from '@/lib/secret-box';
import { addMember, createTeam, getMemberRole, removeMember, roleAtLeast, setMemberRole } from '@/lib/teams';
import { makeUser } from './helpers';

describe('roles de team', () => {
  it('owner > admin > member', () => {
    expect(roleAtLeast('owner', 'admin')).toBe(true);
    expect(roleAtLeast('admin', 'admin')).toBe(true);
    expect(roleAtLeast('member', 'admin')).toBe(false);
  });

  it('asigna, cambia y protege el rol del owner', async () => {
    const owner = await makeUser('owner');
    const m = await makeUser('m');
    const team = await createTeam(owner.id, 'T');
    await addMember(team.id, m.id);
    expect(await getMemberRole(team.id, owner.id)).toBe('owner');
    expect(await getMemberRole(team.id, m.id)).toBe('member');
    expect(await setMemberRole(team.id, m.id, 'admin')).toBe(true);
    expect(await getMemberRole(team.id, m.id)).toBe('admin');
    expect(await setMemberRole(team.id, owner.id, 'member')).toBe(false);
    expect(await getMemberRole(team.id, owner.id)).toBe('owner');
  });

  it('al sacar a un member se revocan las API keys que creó', async () => {
    const owner = await makeUser('owner');
    const m = await makeUser('m');
    const team = await createTeam(owner.id, 'T');
    await addMember(team.id, m.id);
    const mine = await createApiKey(owner.id, 'owner key', owner.id);
    const theirs = await createApiKey(owner.id, 'member key', m.id);
    expect((await listApiKeys(owner.id, m.id)).map((k) => k.id)).toEqual([theirs.id]);

    await removeMember(team.id, m.id);
    expect(await validateApiKey(theirs.key)).toBeNull();
    expect((await validateApiKey(mine.key))?.id).toBe(owner.id);
  });
});

describe('tokens OAuth cifrados', () => {
  it('seal/open ida y vuelta, y texto plano heredado se lee igual', () => {
    const sealed = seal('ya29.token');
    expect(sealed.startsWith('enc:v1:')).toBe(true);
    expect(sealed).not.toContain('ya29');
    expect(open(sealed)).toBe('ya29.token');
    expect(open('legacy-plain')).toBe('legacy-plain');
    expect(open('enc:v1:roto.roto.roto')).toBe('');
  });

  it('la base guarda el token cifrado y getIntegration lo devuelve en claro', async () => {
    const u = await makeUser('g');
    await upsertIntegration({
      userId: u.id, provider: 'gmail', email: 'x@y.com',
      accessToken: 'ACCESS', refreshToken: 'REFRESH', expiresAt: Date.now() + 3_600_000, scope: 's',
    });
    const raw = (await getDb()
      .prepare('SELECT access_token, refresh_token FROM integrations WHERE user_id = ?')
      .get(u.id)) as { access_token: string; refresh_token: string };
    expect(raw.access_token).not.toContain('ACCESS');
    expect(raw.refresh_token).not.toContain('REFRESH');
    const row = await getIntegration(u.id, 'gmail');
    expect(row?.access_token).toBe('ACCESS');
    expect(row?.refresh_token).toBe('REFRESH');
  });
});
