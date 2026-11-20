/**
 * Documentos y videos del CRM con visibilidad de miembros ('mine'): el link o
 * el video se sigue viendo (es del workspace), pero el contacto vinculado que
 * la persona no ve queda sin nombre, email ni id, y no se puede vincular.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createContact } from '@/lib/crm';
import { createDocument, createDocumentLink, createVideo } from '@/lib/crm-media';
import { setMemberVisibility } from '@/lib/crm-visibility';
import type { SessionUser } from '@/lib/session';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({
  ...((await orig()) as object),
  getCurrentUser: async () => session.user,
}));

const videosRoute = await import('@/app/api/crm/videos/route');
const videoRoute = await import('@/lib/routes/crm/videos/[id]/route');
const documentRoute = await import('@/lib/routes/crm/documents/[id]/route');
const linksRoute = await import('@/lib/routes/crm/documents/[id]/links/route');

beforeEach(() => {
  session.user = null;
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (method: string, body?: unknown) =>
  new NextRequest('http://x/api/crm/videos', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function setup(label: string) {
  const w = await workspaceWithMember(label);
  await setMemberVisibility(w.owner.id, 'mine');
  const mine = await createContact(w.owner.id, { firstName: 'Mine', email: `mine-${label}@client.test`, ownerId: w.member.id });
  const hidden = await createContact(w.owner.id, { firstName: 'Hidden', email: `hidden-${label}@client.test`, ownerId: w.friend.id });
  const video = await createVideo(w.owner.id, {
    title: `Video ${label}`,
    url: '/uploads/crm/v.webm',
    contentType: 'video/webm',
    size: 10,
    contactId: hidden.id,
    createdBy: w.member.id,
  });
  const doc = await createDocument(w.owner.id, { name: 'Doc', filename: 'doc.pdf', url: '/uploads/crm/d.pdf', size: 10, createdBy: w.member.id });
  await createDocumentLink(w.owner.id, doc.id, { contactId: hidden.id, createdBy: w.owner.id });
  await createDocumentLink(w.owner.id, doc.id, { contactId: mine.id, createdBy: w.owner.id });
  return { w, mine, hidden, video, doc };
}

type Linked = { contact_id: string | null; contact_name: string | null; contact_email?: string | null };

describe('CRM: documentos y videos respetan la visibilidad de miembros', () => {
  it('lista y detalle de videos sin el contacto que el member no ve', async () => {
    const { w, hidden, video } = await setup('media-vis-video');
    session.user = asMember(w.owner, w.member);
    const list = (await (await videosRoute.GET(req('GET'))).json()) as { rows: Array<Linked & { id: string }> };
    const row = list.rows.find((r) => r.id === video.id)!;
    expect(row).toMatchObject({ contact_id: null, contact_name: null });
    const detail = (await (await videoRoute.GET(req('GET'), ctx(video.id))).json()) as { video: Linked };
    expect(detail.video).toMatchObject({ contact_id: null, contact_name: null });

    session.user = asOwner(w.owner);
    const ownerDetail = (await (await videoRoute.GET(req('GET'), ctx(video.id))).json()) as { video: Linked };
    expect(ownerDetail.video.contact_id).toBe(hidden.id);
  });

  it('los links de un documento no muestran nombre ni email del contacto oculto', async () => {
    const { w, mine, doc } = await setup('media-vis-doc');
    session.user = asMember(w.owner, w.member);
    const body = (await (await documentRoute.GET(req('GET'), ctx(doc.id))).json()) as { links: Linked[] };
    expect(body.links.map((l) => l.contact_id).sort()).toEqual([mine.id, null].sort());
    const masked = body.links.find((l) => l.contact_id === null)!;
    expect(masked).toMatchObject({ contact_name: null, contact_email: null });
  });

  it('no se puede vincular un contacto que el member no ve', async () => {
    const { w, mine, hidden, video, doc } = await setup('media-vis-link');
    session.user = asMember(w.owner, w.member);
    expect((await linksRoute.POST(req('POST', { contactId: hidden.id }), ctx(doc.id))).status).toBe(400);
    expect((await videoRoute.PATCH(req('PATCH', { contactId: hidden.id }), ctx(video.id))).status).toBe(400);
    const ok = await videoRoute.PATCH(req('PATCH', { contactId: mine.id }), ctx(video.id));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as Linked).contact_id).toBe(mine.id);
  });
});
