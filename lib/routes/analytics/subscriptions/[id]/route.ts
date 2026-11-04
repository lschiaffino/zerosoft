import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { rateLimit } from '@/lib/rate-limit';
import { aError, analyticsActor, canManageAnalytics, isResponse, readJson, recordProject } from '@/lib/analytics/http';
import { deleteSubscription, deliverSubscription, getSubscription, SUBSCRIPTION_MAX_INSIGHTS, SUBSCRIPTION_MAX_RECIPIENTS, updateSubscription } from '@/lib/analytics/subscriptions';
import { subscriptionScheduleSchema } from '@/lib/analytics/subscriptions-core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  recipients: z.array(z.string().trim().email().max(320)).min(1).max(SUBSCRIPTION_MAX_RECIPIENTS).optional(),
  message: z.string().max(1000).optional(),
  schedule: subscriptionScheduleSchema.optional(),
  insightIds: z.array(z.string().max(64)).max(SUBSCRIPTION_MAX_INSIGHTS).optional(),
  enabled: z.boolean().optional(),
  /** Mandar ahora a sus destinatarios. */
  test: z.boolean().optional(),
  locale: z.string().max(8).optional(),
});

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const actor = await analyticsActor(req, 'write');
  if (isResponse(actor)) return actor;
  if (!canManageAnalytics(actor)) return aError(403, 'forbidden');
  const { id } = await ctx.params;
  const project = await recordProject(actor, 'analytics_subscriptions', id);
  if (isResponse(project)) return project;
  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) return aError(400, 'invalid_input');
  const { test, locale, ...patch } = parsed.data;
  if (test) {
    const cur = await getSubscription(project.id, id);
    if (!cur) return aError(404, 'not_found');
    if (!cur.enabled) return aError(409, 'subscription_disabled');
    const once = await rateLimit(`asub-test:${id}`, 5, 3600);
    if (!once.ok && process.env.RATE_LIMIT_DISABLED !== 'true') return aError(429, 'email_limit');
    const error = await deliverSubscription(project, cur, locale ?? cur.locale);
    if (error === 'email_limit') return aError(429, error);
    return error ? aError(502, error) : NextResponse.json({ ok: true });
  }
  const subscription = await updateSubscription(project, id, patch, Date.now(), locale);
  if (subscription === 'email_limit') return aError(429, 'email_limit');
  return subscription ? NextResponse.json({ subscription }) : aError(404, 'not_found');
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const actor = await analyticsActor(req, 'write');
  if (isResponse(actor)) return actor;
  if (!canManageAnalytics(actor)) return aError(403, 'forbidden');
  const { id } = await ctx.params;
  const project = await recordProject(actor, 'analytics_subscriptions', id);
  if (isResponse(project)) return project;
  await deleteSubscription(project.id, id);
  return NextResponse.json({ ok: true });
}
