import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', async (orig) => ({ ...(await orig<object>()), getCurrentUser: async () => session.user }));

import { GET } from '@/app/api/agents/[id]/approvals/route';
import { POST } from '@/app/api/agents/[id]/approvals/[aid]/route';

beforeEach(() => {
  session.user = null;
});

describe('Agents: aprobaciones solo para admins', () => {
  it('un miembro no lista ni decide acciones pendientes', async () => {
    session.user = { id: 'ws-1', email: 'm@x.com', role: 'member', actingUser: { id: 'm-1', email: 'm@x.com' } };
    const list = await GET(new NextRequest('http://x/api/agents/a/approvals?status=pending'), { params: Promise.resolve({ id: 'a' }) });
    expect(list.status).toBe(403);
    const decide = await POST(new NextRequest('http://x/api/agents/a/approvals/z', { method: 'POST', body: JSON.stringify({ decision: 'approve' }) }), {
      params: Promise.resolve({ id: 'a', aid: 'z' }),
    });
    expect(decide.status).toBe(403);
  });

  it('un admin sí (404 si la acción no existe)', async () => {
    session.user = { id: 'ws-1', email: 'a@x.com', role: 'admin' };
    const list = await GET(new NextRequest('http://x/api/agents/a/approvals'), { params: Promise.resolve({ id: 'a' }) });
    expect(list.status).toBe(200);
    const decide = await POST(new NextRequest('http://x/api/agents/a/approvals/z', { method: 'POST', body: JSON.stringify({ decision: 'reject' }) }), {
      params: Promise.resolve({ id: 'a', aid: 'z' }),
    });
    expect(decide.status).toBe(404);
  });
});
