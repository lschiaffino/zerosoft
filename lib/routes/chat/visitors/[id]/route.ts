import { NextResponse } from 'next/server';
import { cleanVisitorAttributes, getCompany, setCampaignOptIn, setVisitorProfile } from '@/lib/chat-companies';
import { canAccessWidget } from '@/lib/chat-access';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { recordChatAudit } from '@/lib/chat-audit';
import {
  getChatVisitor,
  getChatVisitorWithStats,
  getChatWidget,
  updateChatVisitor,
} from '@/lib/chat-data';

export const dynamic = 'force-dynamic';

async function canAccessVisitor(
  visitorId: string,
  user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>,
) {
  const visitor = await getChatVisitor(visitorId);
  if (!visitor) return { ok: false, visitor: null };
  const widget = await getChatWidget(visitor.widget_id);
  if (!widget) return { ok: false, visitor: null };
  if (!await canAccessWidget(widget, user)) {
    return { ok: false, visitor: null };
  }
  return { ok: true, visitor };
}

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { ok } = await canAccessVisitor(params.id, user);
  if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const visitor = await getChatVisitorWithStats(params.id);
  if (!visitor) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ...visitor, can_set_opt_in: isWorkspaceAdmin(user) });
}

export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { ok } = await canAccessVisitor(params.id, user);
  if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const metadata =
    typeof body.metadata === 'object' && body.metadata !== null
      ? (body.metadata as Record<string, unknown>)
      : undefined;

  // Consentimiento para campañas: solo un admin, y queda registrado.
  if (typeof body.campaignOptIn === 'boolean') {
    if (!isWorkspaceAdmin(user)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    await setCampaignOptIn(params.id, body.campaignOptIn);
    await recordChatAudit(user.id, realUserId(user), 'visitor.opt_in', { id: params.id, optIn: body.campaignOptIn });
    return NextResponse.json(await getChatVisitor(params.id));
  }
  // Empresa (del workspace) y atributos propios.
  if (body.companyId !== undefined || body.attributes !== undefined) {
    const companyId = body.companyId === null || body.companyId === '' ? null : typeof body.companyId === 'string' ? body.companyId : undefined;
    if (companyId && !(await getCompany(user.id, companyId))) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    let attributes: Record<string, string> | undefined;
    if (body.attributes !== undefined) {
      try {
        attributes = cleanVisitorAttributes(body.attributes);
      } catch {
        return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
      }
    }
    await setVisitorProfile(params.id, { companyId, attributes });
    return NextResponse.json(await getChatVisitor(params.id));
  }

  const updated = await updateChatVisitor(params.id, {
    name: typeof body.name === 'string' ? body.name : undefined,
    email: typeof body.email === 'string' ? body.email : undefined,
    // Lo carga alguien del equipo desde el inbox o la API: cuenta como verificado.
    emailVerified: true,
    // null borra la nota.
    notes: typeof body.notes === 'string' || body.notes === null ? body.notes : undefined,
    metadata,
  });

  if (!updated) return NextResponse.json({ error: 'generic' }, { status: 500 });
  return NextResponse.json(updated);
}
