import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { canSeeActivity, canSeeRecord, sessionScope } from '@/lib/crm-visibility';
import { sessionChatReader } from '@/lib/crm-chat-privacy';
import { buildRecordTimeline, pinOnRecord, type TimelineRecordKind } from '@/lib/crm-timeline';
import { crmError, invalidBody, notFound, unauthorized } from '@/lib/crm-http';
import { requestLocale } from '@/lib/request-locale';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TABLES = { contact: 'crm_contacts', company: 'crm_companies', deal: 'crm_deals' } as const;
const kindSchema = z.enum(['contact', 'company', 'deal']);

/** "Ver más" del timeline de una ficha: la página siguiente de actividades (con las de sus asociados). */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const kind = kindSchema.safeParse(sp.get('kind'));
  const id = sp.get('id') ?? '';
  const offset = Number(sp.get('offset') ?? '0');
  if (!kind.success || !id || !Number.isInteger(offset) || offset < 0 || offset > 100_000) return crmError(400, 'invalid_input');
  const scope = await sessionScope(user);
  if (!(await canSeeRecord(user.id, TABLES[kind.data], id, scope))) return notFound();
  const chatReader = await sessionChatReader(user, requestLocale(req.cookies.get('NEXT_LOCALE')?.value, req.headers.get('accept-language')));
  const out = await buildRecordTimeline(user, { kind: kind.data, id }, { ownerScope: scope, chatReader, offset });
  return NextResponse.json(out);
}

const pinSchema = z.object({
  activityId: z.string().min(1).max(64),
  kind: kindSchema,
  id: z.string().min(1).max(64),
  pinned: z.boolean(),
});

/** Fijar en la ficha: una sola actividad fijada por registro, como en HubSpot. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = pinSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const { activityId, kind, id, pinned } = parsed.data;
  const scope = await sessionScope(user);
  if (!(await canSeeRecord(user.id, TABLES[kind as TimelineRecordKind], id, scope))) return notFound();
  if (!(await canSeeActivity(user.id, activityId, scope))) return notFound();
  if (!(await pinOnRecord(user.id, activityId, { kind, id }, pinned))) return notFound();
  return NextResponse.json({ ok: true });
}
