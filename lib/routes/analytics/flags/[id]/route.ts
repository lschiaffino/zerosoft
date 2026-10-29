import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { flagKeySchema, flagVariantSchema, propertyFilterSchema } from '@/lib/analytics/types';
import { variantsValid } from '@/lib/analytics/flags-core';
import { deleteFlag, getFlag, updateFlag } from '@/lib/analytics/records';
import { aError, analyticsActor, isResponse, readJson, recordProject } from '@/lib/analytics/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  key: flagKeySchema.optional(),
  name: z.string().trim().max(200).optional(),
  active: z.boolean().optional(),
  rollout: z.number().int().min(0).max(100).optional(),
  variants: z.array(flagVariantSchema).max(10).optional(),
  conditions: z.array(propertyFilterSchema.extend({ type: z.literal('person').default('person') })).max(10).optional(),
});

export async function GET(req: NextRequest, ctx: Ctx) {
  const actor = await analyticsActor(req, 'read');
  if (isResponse(actor)) return actor;
  const { id } = await ctx.params;
  const project = await recordProject(actor, 'analytics_flags', id);
  if (isResponse(project)) return project;
  return NextResponse.json({ flag: await getFlag(project.id, id) });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const actor = await analyticsActor(req, 'write');
  if (isResponse(actor)) return actor;
  const { id } = await ctx.params;
  const project = await recordProject(actor, 'analytics_flags', id);
  if (isResponse(project)) return project;
  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) return aError(400, 'invalid_input');
  if (parsed.data.variants && !variantsValid(parsed.data.variants)) return aError(400, 'variants_must_sum_100');
  const flag = await updateFlag(project.id, id, parsed.data);
  if (flag === 'duplicate_key') return aError(409, 'duplicate_key');
  return NextResponse.json({ flag });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const actor = await analyticsActor(req, 'write');
  if (isResponse(actor)) return actor;
  const { id } = await ctx.params;
  const project = await recordProject(actor, 'analytics_flags', id);
  if (isResponse(project)) return project;
  await deleteFlag(project.id, id);
  return NextResponse.json({ ok: true });
}
