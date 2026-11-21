import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SessionUser } from '@/lib/session';
import { createActivity, createCompany, createContact } from '@/lib/crm';
import { setMemberVisibility } from '@/lib/crm-visibility';
import { asMember, roles, workspaceWithMember } from './access-helpers';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({ ...((await orig()) as object), getCurrentUser: async () => session.user }));

import { GET, POST } from '@/app/api/crm/timeline/route';

function get(qs: string) {
  return GET(new NextRequest(`http://test.local/api/crm/timeline?${qs}`));
}
function post(body: unknown) {
  return POST(new NextRequest('http://test.local/api/crm/timeline', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }));
}

describe('GET/POST /api/crm/timeline', () => {
  it('anonymous 401, other workspace 404, teammate and owner read the page', async () => {
    const w = await workspaceWithMember('tl-acc');
    const company = await createCompany(w.owner.id, { name: 'Acc Co' });
    const note = await createActivity(w.owner.id, { type: 'note', body: 'zq acc note', companyId: company.id });
    const expected = { anonymous: 401, other_workspace: 404, teammate: 200, owner: 200 } as const;
    for (const r of roles(w)) {
      session.user = r.user;
      const res = await get(`kind=company&id=${company.id}&offset=0`);
      expect(res.status, r.name).toBe(expected[r.name]);
      const pin = await post({ activityId: note.id, kind: 'company', id: company.id, pinned: true });
      expect(pin.status, `pin ${r.name}`).toBe(expected[r.name]);
    }
    session.user = null;
  });

  it('a member who cannot see the record gets 404, and bad input 400', async () => {
    const w = await workspaceWithMember('tl-acc2');
    await setMemberVisibility(w.owner.id, 'mine');
    const company = await createCompany(w.owner.id, { name: 'Hidden Co' });
    const contact = await createContact(w.owner.id, { firstName: 'Hidden', companyId: company.id });
    await createActivity(w.owner.id, { type: 'note', body: 'zq hidden note', contactId: contact.id });
    session.user = asMember(w.owner, w.member);
    const res = await get(`kind=company&id=${company.id}&offset=0`);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('zq hidden note');
    expect((await get(`kind=lead&id=${company.id}`)).status).toBe(400);
    expect((await get(`kind=company&id=${company.id}&offset=-3`)).status).toBe(400);
    session.user = null;
  });
});
