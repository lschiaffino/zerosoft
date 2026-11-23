import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { crmError, forbidden, invalidBody, notFound, unauthorized } from '@/lib/crm-http';
import { sessionFieldViewer } from '@/lib/crm-field-perms';
import {
  pipelineInWorkspace,
  resetLayout,
  resolveCardLayout,
  resolvePreviewLayout,
  setCardLayout,
  setPreviewLayout,
} from '@/lib/crm-layouts';
import { isLayoutEntity, LAYOUT_ENTITIES, MAX_PREVIEW_PROPERTIES } from '@/lib/crm-layouts-shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const key = z.string().min(1).max(120);
const putSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('preview'),
    entity: z.enum(LAYOUT_ENTITIES),
    properties: z.array(key).max(MAX_PREVIEW_PROPERTIES + 10),
    sections: z.array(key).max(20),
  }),
  z.object({
    kind: z.literal('card'),
    pipelineId: z.string().min(1).max(64),
    properties: z.array(key).max(20),
  }),
]);

/**
 * GET ?kind=preview&entity=contacts|companies|deals → la vista previa para
 * quien pregunta. GET ?kind=card&pipelineId= → las tarjetas de ese pipeline.
 * Las propiedades personalizadas que la persona tiene ocultas no salen.
 * `canEdit`: owner/admin (el link "Personalizar").
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const viewer = sessionFieldViewer(user);
  const canEdit = isWorkspaceAdmin(user);
  if (sp.get('kind') === 'card') {
    const pipelineId = sp.get('pipelineId') ?? '';
    if (!pipelineId || !(await pipelineInWorkspace(user.id, pipelineId))) return notFound();
    return NextResponse.json({ kind: 'card', pipelineId, layout: await resolveCardLayout(viewer, pipelineId), canEdit });
  }
  const entity = sp.get('entity');
  if (sp.get('kind') !== 'preview' || !isLayoutEntity(entity)) return crmError(400, 'invalid_input');
  return NextResponse.json({ kind: 'preview', entity, layout: await resolvePreviewLayout(viewer, entity), canEdit });
}

/** Guarda la vista previa de un objeto o las tarjetas de un pipeline (owner/admin). */
export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const body = parsed.data;
  if (body.kind === 'preview') {
    const layout = await setPreviewLayout(user.id, body.entity, body);
    return NextResponse.json({ kind: 'preview', entity: body.entity, layout });
  }
  const layout = await setCardLayout(user.id, body.pipelineId, body);
  if (!layout) return notFound();
  return NextResponse.json({ kind: 'card', pipelineId: body.pipelineId, layout });
}

/** DELETE ?kind=preview&entity= | ?kind=card&pipelineId= → vuelve a lo de por defecto (owner/admin). */
export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  const sp = req.nextUrl.searchParams;
  if (sp.get('kind') === 'card') {
    const pipelineId = sp.get('pipelineId') ?? '';
    if (!pipelineId || !(await pipelineInWorkspace(user.id, pipelineId))) return notFound();
    await resetLayout(user.id, 'card', 'deals', pipelineId);
    return NextResponse.json({ ok: true });
  }
  const entity = sp.get('entity');
  if (sp.get('kind') !== 'preview' || !isLayoutEntity(entity)) return crmError(400, 'invalid_input');
  await resetLayout(user.id, 'preview', entity, '');
  return NextResponse.json({ ok: true });
}
