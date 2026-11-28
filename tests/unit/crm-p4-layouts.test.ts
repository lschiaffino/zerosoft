/**
 * Vista previa y tarjetas del board configurables (P4): GET/PUT/DELETE
 * /api/crm/layouts con las miradas de acceso (anónimo, otro workspace,
 * member, member con un campo oculto configurado, admin, owner) y la limpieza
 * pura de la configuración. Datos inventados.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createCustomField, createPipeline } from '@/lib/crm';
import { MEMBER_SUBJECT, sessionFieldViewer, setFieldPermissions } from '@/lib/crm-field-perms';
import { getCardLayout, getLeadCardLayout, getPreviewLayout, resolveCardLayout, resolveLeadCardLayout, resolvePreviewLayout } from '@/lib/crm-layouts';
import {
  DEFAULT_CARD_PROPERTIES,
  DEFAULT_LEAD_CARD_PROPERTIES,
  DEFAULT_PREVIEW_PROPERTIES,
  MAX_CARD_PROPERTIES,
  sanitizeCardLayout,
  sanitizePreviewLayout,
  withoutHidden,
} from '@/lib/crm-layouts-shared';
import type { SessionUser } from '@/lib/session';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({
  ...((await orig()) as object),
  getCurrentUser: async () => session.user,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

const route = await import('@/app/api/crm/layouts/route');

beforeEach(() => {
  session.user = null;
});

const req = (url: string, method = 'GET', body?: unknown) =>
  new NextRequest(url, body === undefined ? { method } : { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

async function setup(label: string) {
  const w = await workspaceWithMember(label);
  const ws = w.owner.id;
  const secret = await createCustomField(ws, { entity: 'deals', name: 'secret', label: 'Secret', type: 'text' });
  await setFieldPermissions(ws, secret.id, [{ subject: MEMBER_SUBJECT, access: 'hidden' }]);
  await createCustomField(ws, { entity: 'deals', name: 'plan', label: 'Plan', type: 'text' });
  const cSecret = await createCustomField(ws, { entity: 'contacts', name: 'secret', label: 'Secret', type: 'text' });
  await setFieldPermissions(ws, cSecret.id, [{ subject: MEMBER_SUBJECT, access: 'hidden' }]);
  const pipeline = await createPipeline(ws, 'Sales');
  return { w, ws, pipeline };
}

describe('crm layouts: limpieza pura', () => {
  it('saca claves desconocidas, repetidas y personalizadas que no existen; respeta el máximo', () => {
    const custom = new Set(['plan']);
    const card = sanitizeCardLayout(
      { properties: ['amount', 'amount', 'nope', 'custom.plan', 'custom.gone', 'closeDate', 'ownerId', 'priority', 'source', 'dealType', 'nextStep'] },
      custom,
    );
    expect(card.properties).toEqual(['amount', 'custom.plan', 'closeDate', 'ownerId', 'priority', 'source']);
    expect(card.properties.length).toBe(MAX_CARD_PROPERTIES);
    const preview = sanitizePreviewLayout('deals', { properties: ['amount', 'email', 'custom.plan'], sections: ['activity', 'bogus', 'activity', 'stage'] }, custom);
    expect(preview).toEqual({ properties: ['amount', 'custom.plan'], sections: ['activity', 'stage'] });
    expect(sanitizePreviewLayout('contacts', { properties: 'x', sections: null }, custom)).toEqual({ properties: [], sections: [] });
  });

  it('withoutHidden saca solo las personalizadas ocultas', () => {
    expect(withoutHidden({ properties: ['amount', 'custom.secret', 'custom.plan'] }, new Set(['secret'])).properties).toEqual(['amount', 'custom.plan']);
  });
});

describe('crm layouts: acceso', () => {
  it('anónimo: 401 en todo', async () => {
    const s = await setup('p4-anon');
    expect((await route.GET(req('http://x/api/crm/layouts?kind=preview&entity=deals'))).status).toBe(401);
    expect((await route.PUT(req('http://x/api/crm/layouts', 'PUT', { kind: 'card', pipelineId: s.pipeline.id, properties: ['amount'] }))).status).toBe(401);
    expect((await route.DELETE(req('http://x/api/crm/layouts?kind=preview&entity=deals', 'DELETE'))).status).toBe(401);
  });

  it('otro workspace: no lee ni cambia las tarjetas de un pipeline ajeno', async () => {
    const s = await setup('p4-other');
    session.user = asOwner(s.w.stranger);
    expect((await route.GET(req(`http://x/api/crm/layouts?kind=card&pipelineId=${s.pipeline.id}`))).status).toBe(404);
    expect((await route.PUT(req('http://x/api/crm/layouts', 'PUT', { kind: 'card', pipelineId: s.pipeline.id, properties: ['amount'] }))).status).toBe(404);
    expect((await route.DELETE(req(`http://x/api/crm/layouts?kind=card&pipelineId=${s.pipeline.id}`, 'DELETE'))).status).toBe(404);
    // Su propia vista previa no toca la del otro workspace.
    expect((await route.PUT(req('http://x/api/crm/layouts', 'PUT', { kind: 'preview', entity: 'deals', properties: ['name'], sections: [] }))).status).toBe(200);
    expect((await getPreviewLayout(s.ws, 'deals')).properties).toEqual([...DEFAULT_PREVIEW_PROPERTIES.deals]);
  });

  it('member: lee, pero no cambia ni vuelve a lo de por defecto', async () => {
    const s = await setup('p4-member');
    session.user = asMember(s.w.owner, s.w.member);
    const res = await route.GET(req('http://x/api/crm/layouts?kind=preview&entity=contacts'));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { canEdit: boolean }).canEdit).toBe(false);
    expect((await route.PUT(req('http://x/api/crm/layouts', 'PUT', { kind: 'preview', entity: 'contacts', properties: ['email'], sections: [] }))).status).toBe(403);
    expect((await route.PUT(req('http://x/api/crm/layouts', 'PUT', { kind: 'card', pipelineId: s.pipeline.id, properties: ['amount'] }))).status).toBe(403);
    expect((await route.DELETE(req('http://x/api/crm/layouts?kind=preview&entity=contacts', 'DELETE'))).status).toBe(403);
    expect((await getCardLayout(s.ws, s.pipeline.id)).properties).toEqual([...DEFAULT_CARD_PROPERTIES]);
  });

  it('member con un campo oculto configurado: no le llega ni en la tarjeta ni en la vista previa', async () => {
    const s = await setup('p4-hidden');
    session.user = asOwner(s.w.owner);
    const put = await route.PUT(req('http://x/api/crm/layouts', 'PUT', { kind: 'card', pipelineId: s.pipeline.id, properties: ['amount', 'custom.secret', 'custom.plan'] }));
    expect(put.status).toBe(200);
    expect(((await put.json()) as { layout: { properties: string[] } }).layout.properties).toEqual(['amount', 'custom.secret', 'custom.plan']);
    await route.PUT(req('http://x/api/crm/layouts', 'PUT', { kind: 'preview', entity: 'contacts', properties: ['email', 'custom.secret'], sections: ['activity'] }));

    session.user = asMember(s.w.owner, s.w.member);
    const card = await route.GET(req(`http://x/api/crm/layouts?kind=card&pipelineId=${s.pipeline.id}`));
    const cardText = await card.text();
    expect(card.status).toBe(200);
    expect(cardText).not.toContain('secret');
    expect((JSON.parse(cardText) as { layout: { properties: string[] } }).layout.properties).toEqual(['amount', 'custom.plan']);
    const preview = await route.GET(req('http://x/api/crm/layouts?kind=preview&entity=contacts'));
    const previewText = await preview.text();
    expect(previewText).not.toContain('secret');
    expect((JSON.parse(previewText) as { layout: { properties: string[]; sections: string[] } }).layout).toEqual({ properties: ['email'], sections: ['activity'] });
    // Lo mismo que usa el board en el server.
    expect((await resolveCardLayout(sessionFieldViewer(session.user), s.pipeline.id)).properties).not.toContain('custom.secret');
    expect((await resolvePreviewLayout(sessionFieldViewer(session.user), 'contacts')).properties).not.toContain('custom.secret');

    // El owner sí lo ve (las reglas no le aplican).
    expect((await resolveCardLayout(sessionFieldViewer(asOwner(s.w.owner)), s.pipeline.id)).properties).toContain('custom.secret');
  });

  it('admin: cambia, limpia lo que manda y vuelve a lo de por defecto', async () => {
    const s = await setup('p4-admin');
    session.user = asMember(s.w.owner, s.w.member, 'admin');
    const put = await route.PUT(
      req('http://x/api/crm/layouts', 'PUT', { kind: 'preview', entity: 'deals', properties: ['nextStep', 'amount', 'email', 'custom.plan'], sections: ['contacts', 'activity'] }),
    );
    expect(put.status).toBe(200);
    expect(await getPreviewLayout(s.ws, 'deals')).toEqual({ properties: ['nextStep', 'amount', 'custom.plan'], sections: ['contacts', 'activity'] });
    const card = await route.PUT(req('http://x/api/crm/layouts', 'PUT', { kind: 'card', pipelineId: s.pipeline.id, properties: ['ownerId', 'amount'] }));
    expect(card.status).toBe(200);
    expect((await getCardLayout(s.ws, s.pipeline.id)).properties).toEqual(['ownerId', 'amount']);

    expect((await route.DELETE(req('http://x/api/crm/layouts?kind=preview&entity=deals', 'DELETE'))).status).toBe(200);
    expect((await getPreviewLayout(s.ws, 'deals')).properties).toEqual([...DEFAULT_PREVIEW_PROPERTIES.deals]);
    expect((await route.DELETE(req(`http://x/api/crm/layouts?kind=card&pipelineId=${s.pipeline.id}`, 'DELETE'))).status).toBe(200);
    expect((await getCardLayout(s.ws, s.pipeline.id)).properties).toEqual([...DEFAULT_CARD_PROPERTIES]);
  });

  it('leads: tarjetas del board y vista previa por workspace, sin las personalizadas ocultas', async () => {
    const s = await setup('p4-leads');
    const ws = s.ws;
    const hidden = await createCustomField(ws, { entity: 'leads', name: 'budget', label: 'Budget', type: 'text' });
    await setFieldPermissions(ws, hidden.id, [{ subject: MEMBER_SUBJECT, access: 'hidden' }]);
    await createCustomField(ws, { entity: 'leads', name: 'channel', label: 'Channel', type: 'text' });
    expect((await getLeadCardLayout(ws)).properties).toEqual([...DEFAULT_LEAD_CARD_PROPERTIES]);

    // Member: lee, no cambia.
    session.user = asMember(s.w.owner, s.w.member);
    expect((await route.PUT(req('http://x/api/crm/layouts', 'PUT', { kind: 'card', entity: 'leads', properties: ['source'] }))).status).toBe(403);

    // Owner: guarda (sin claves de deals ni personalizadas que no existen) y el member no ve la oculta.
    session.user = asOwner(s.w.owner);
    const put = await route.PUT(
      req('http://x/api/crm/layouts', 'PUT', { kind: 'card', entity: 'leads', properties: ['source', 'amount', 'custom.budget', 'custom.channel', 'custom.gone'] }),
    );
    expect(put.status).toBe(200);
    expect((await getLeadCardLayout(ws)).properties).toEqual(['source', 'custom.budget', 'custom.channel']);
    await route.PUT(req('http://x/api/crm/layouts', 'PUT', { kind: 'preview', entity: 'leads', properties: ['stageId', 'custom.budget'], sections: ['contacts', 'activity'] }));

    session.user = asMember(s.w.owner, s.w.member);
    const card = await route.GET(req('http://x/api/crm/layouts?kind=card&entity=leads'));
    const cardText = await card.text();
    expect(cardText).not.toContain('budget');
    expect((JSON.parse(cardText) as { layout: { properties: string[] } }).layout.properties).toEqual(['source', 'custom.channel']);
    const preview = await route.GET(req('http://x/api/crm/layouts?kind=preview&entity=leads'));
    expect(await preview.text()).not.toContain('budget');
    expect((await resolveLeadCardLayout(sessionFieldViewer(session.user))).properties).not.toContain('custom.budget');

    // Otro workspace no toca estas tarjetas; el reset vuelve a lo de por defecto.
    session.user = asOwner(s.w.stranger);
    await route.PUT(req('http://x/api/crm/layouts', 'PUT', { kind: 'card', entity: 'leads', properties: ['ownerId'] }));
    expect((await getLeadCardLayout(ws)).properties).toEqual(['source', 'custom.budget', 'custom.channel']);
    session.user = asOwner(s.w.owner);
    expect((await route.DELETE(req('http://x/api/crm/layouts?kind=card&entity=leads', 'DELETE'))).status).toBe(200);
    expect((await getLeadCardLayout(ws)).properties).toEqual([...DEFAULT_LEAD_CARD_PROPERTIES]);
  });

  it('pedidos inválidos: 400', async () => {
    const s = await setup('p4-invalid');
    session.user = asOwner(s.w.owner);
    expect((await route.GET(req('http://x/api/crm/layouts?kind=preview&entity=tasks'))).status).toBe(400);
    // Una tarjeta de deals sin pipeline.
    expect((await route.PUT(req('http://x/api/crm/layouts', 'PUT', { kind: 'card', properties: ['amount'] }))).status).toBe(400);
    expect((await route.GET(req('http://x/api/crm/layouts?kind=other'))).status).toBe(400);
    expect((await route.PUT(req('http://x/api/crm/layouts', 'PUT', { kind: 'preview', entity: 'deals' }))).status).toBe(400);
  });
});
