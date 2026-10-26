import { describe, expect, it } from 'vitest';
import { createTeamspace, pageVisibleToWorkspace } from '@/lib/docs-access';
import { makeUser } from './helpers';

describe('Docs: page.created no sale de teamspaces cerrados o privados', () => {
  it('solo las páginas que ve todo el workspace disparan el evento', async () => {
    const owner = await makeUser('pcp');
    const open = await createTeamspace(owner.id, owner.id, { name: 'Open', access: 'open' });
    const closed = await createTeamspace(owner.id, owner.id, { name: 'Closed', access: 'closed' });
    const priv = await createTeamspace(owner.id, owner.id, { name: 'Private', access: 'private' });
    expect(await pageVisibleToWorkspace(null)).toBe(true);
    expect(await pageVisibleToWorkspace(open.id)).toBe(true);
    expect(await pageVisibleToWorkspace(closed.id)).toBe(false);
    expect(await pageVisibleToWorkspace(priv.id)).toBe(false);
  });
});
