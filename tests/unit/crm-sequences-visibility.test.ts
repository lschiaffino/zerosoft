/**
 * Secuencias del CRM y la visibilidad de miembros ('mine'): inscribir,
 * desinscribir, pausar y listar inscripciones respetan los contactos que la
 * persona ve, en la app y en la API v1. Y por la API un member no elige el
 * buzón de otra persona como remitente.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createContact } from '@/lib/crm';
import { createSequence, enrollContacts, getEnrollment, listEnrollments } from '@/lib/crm-sequences';
import { setMemberVisibility } from '@/lib/crm-visibility';
import { createApiKey } from '@/lib/api-auth';
import type { SessionUser } from '@/lib/session';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({
  ...((await orig()) as object),
  getCurrentUser: async () => session.user,
}));

const enrollRoute = await import('@/lib/routes/crm/sequences/[id]/enroll/route');
const sequenceRoute = await import('@/lib/routes/crm/sequences/[id]/route');
const enrollmentRoute = await import('@/lib/routes/crm/sequences/enrollments/[id]/route');
const v1Enroll = await import('@/lib/routes/v1/crm/sequences/[id]/enroll/route');
const v1Unenroll = await import('@/lib/routes/v1/crm/sequences/[id]/unenroll/route');

beforeEach(() => {
  session.user = null;
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (method: string, body?: unknown, key?: string) =>
  new NextRequest('http://x/api/crm/sequences', {
    method,
    headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/** Workspace con visibilidad 'mine', un contacto del member, uno del friend y una secuencia solo de tareas (sin Gmail). */
async function setup(label: string) {
  const w = await workspaceWithMember(label);
  await setMemberVisibility(w.owner.id, 'mine');
  const mine = await createContact(w.owner.id, { firstName: 'Mine', email: `mine-${label}@client.test`, ownerId: w.member.id });
  const hidden = await createContact(w.owner.id, { firstName: 'Hidden', email: `hidden-${label}@client.test`, ownerId: w.friend.id });
  const seq = await createSequence(w.owner.id, w.owner.id, {
    name: 'Seq',
    timezone: 'UTC',
    windowStart: '09:00',
    windowEnd: '17:00',
    businessDays: false,
    steps: [{ type: 'task', subject: 'Call' }],
  });
  return { w, mine, hidden, seq };
}

describe('secuencias del CRM: visibilidad de miembros', () => {
  it('la app saltea al inscribir los contactos que el member no ve', async () => {
    const { w, mine, hidden, seq } = await setup('seqvis-app');
    session.user = asMember(w.owner, w.member);
    const res = await enrollRoute.POST(req('POST', { contactIds: [mine.id, hidden.id] }), ctx(seq.id));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { enrolled: string[]; skipped: Array<{ contactId: string; reason: string }> };
    expect(body.enrolled).toEqual([mine.id]);
    expect(body.skipped).toEqual([{ contactId: hidden.id, reason: 'not_found' }]);
  });

  it('el detalle de la secuencia no lista inscripciones de contactos que el member no ve, y no puede pausarlas', async () => {
    const { w, mine, hidden, seq } = await setup('seqvis-list');
    await enrollContacts(w.owner.id, { sequenceId: seq.id, contactIds: [mine.id, hidden.id], senderId: w.owner.id, enrolledBy: w.owner.id });

    session.user = asMember(w.owner, w.member);
    const detail = (await (await sequenceRoute.GET(req('GET'), ctx(seq.id))).json()) as { enrollments: Array<{ contact_id: string }> };
    expect(detail.enrollments.map((e) => e.contact_id)).toEqual([mine.id]);

    const all = await listEnrollments(w.owner.id, { sequenceId: seq.id });
    const hiddenEnr = all.find((e) => e.contact_id === hidden.id)!;
    const mineEnr = all.find((e) => e.contact_id === mine.id)!;
    expect((await enrollmentRoute.PATCH(req('PATCH', { action: 'pause' }), ctx(hiddenEnr.id))).status).toBe(404);
    expect((await getEnrollment(w.owner.id, hiddenEnr.id))?.status).toBe('active');
    expect((await enrollmentRoute.PATCH(req('PATCH', { action: 'pause' }), ctx(mineEnr.id))).status).toBe(200);

    session.user = asOwner(w.owner);
    const ownerDetail = (await (await sequenceRoute.GET(req('GET'), ctx(seq.id))).json()) as { enrollments: unknown[] };
    expect(ownerDetail.enrollments).toHaveLength(2);
  });

  it('la API v1 con key de member: saltea contactos ocultos, no desinscribe ocultos y no elige otro remitente', async () => {
    const { w, mine, hidden, seq } = await setup('seqvis-v1');
    const memberKey = (await createApiKey(w.owner.id, 'member', w.member.id)).key;
    const ownerKey = (await createApiKey(w.owner.id, 'owner', w.owner.id)).key;

    const asOther = await v1Enroll.POST(req('POST', { contactIds: [mine.id], senderId: w.friend.id }, memberKey), ctx(seq.id));
    expect(asOther.status).toBe(403);

    const res = await v1Enroll.POST(req('POST', { contactIds: [mine.id, hidden.id] }, memberKey), ctx(seq.id));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { enrolled: string[]; skipped: Array<{ contactId: string; reason: string }> };
    expect(body.enrolled).toEqual([mine.id]);
    expect(body.skipped).toEqual([{ contactId: hidden.id, reason: 'not_found' }]);
    const memberEnr = (await listEnrollments(w.owner.id, { sequenceId: seq.id }))[0];
    expect(memberEnr.sender_id).toBe(w.member.id);

    await enrollContacts(w.owner.id, { sequenceId: seq.id, contactIds: [hidden.id], senderId: w.owner.id, enrolledBy: w.owner.id });
    expect((await v1Unenroll.POST(req('POST', { contactId: hidden.id }, memberKey), ctx(seq.id))).status).toBe(404);
    const stillActive = (await listEnrollments(w.owner.id, { sequenceId: seq.id, contactId: hidden.id }))[0];
    expect(stillActive.status).toBe('active');

    // El owner ve todo y puede elegir el remitente.
    const unenroll = await v1Unenroll.POST(req('POST', { contactId: hidden.id }, ownerKey), ctx(seq.id));
    expect(await unenroll.json()).toEqual({ exited: 1 });
  });
});
