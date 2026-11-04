import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { actorProject, aError, analyticsActor, canManageAnalytics, isResponse, readJson } from '@/lib/analytics/http';
import { createSubscription, listSubscriptions, SUBSCRIPTION_MAX_INSIGHTS, SUBSCRIPTION_MAX_RECIPIENTS } from '@/lib/analytics/subscriptions';
import { subscriptionScheduleSchema } from '@/lib/analytics/subscriptions-core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const actor = await analyticsActor(req, 'read');
  if (isResponse(actor)) return actor;
  const project = await actorProject(actor, req.nextUrl.searchParams.get('project'));
  if (isResponse(project)) return project;
  const list = await listSubscriptions(project.id);
  // Las direcciones las ve quien puede administrar: un miembro ve cuántas son.
  const visible = canManageAnalytics(actor) ? list : list.map((s) => ({ ...s, recipients: [], recipientState: {} }));
  return NextResponse.json({ subscriptions: visible, me: actor.personId });
}

const subscriptionBody = z.object({
  name: z.string().trim().min(1).max(200),
  recipients: z.array(z.string().trim().email().max(320)).min(1).max(SUBSCRIPTION_MAX_RECIPIENTS),
  message: z.string().max(1000).optional(),
  schedule: subscriptionScheduleSchema,
  insightIds: z.array(z.string().max(64)).max(SUBSCRIPTION_MAX_INSIGHTS).optional(),
  enabled: z.boolean().optional(),
});
const createSchema = subscriptionBody.extend({ projectId: z.string().max(64), insightId: z.string().max(64).nullable().optional(), dashboardId: z.string().max(64).nullable().optional(), locale: z.string().max(8).optional() });

/** Una suscripción manda datos por email a cualquier dirección: como un link público, solo admins. */
export async function POST(req: NextRequest) {
  const actor = await analyticsActor(req, 'write');
  if (isResponse(actor)) return actor;
  if (!canManageAnalytics(actor)) return aError(403, 'forbidden');
  const parsed = createSchema.safeParse(await readJson(req));
  if (!parsed.success) return aError(400, 'invalid_input');
  const project = await actorProject(actor, parsed.data.projectId);
  if (isResponse(project)) return project;
  const created = await createSubscription(project, actor.personId, parsed.data, Date.now(), parsed.data.locale ?? 'en');
  if (created === 'email_limit') return aError(429, 'email_limit');
  if (!created) return aError(404, 'not_found');
  return NextResponse.json({ subscription: created }, { status: 201 });
}
