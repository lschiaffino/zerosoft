import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { domainError, projectAccess } from '@/lib/track-triage-http';
import { deleteTriageRule, getTriageRule, updateTriageRule } from '@/lib/track-triage';
import { invalidBody, notFound, trackError } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const condition = z.object({
  field: z.enum(['source', 'text', 'priority', 'label', 'customer']),
  op: z.enum(['is', 'is_not', 'contains']),
  values: z.array(z.string().trim().min(1).max(120)).max(20),
});
const actions = z.object({
  priority: z.enum(['urgent', 'high', 'medium', 'low']).optional(),
  assigneeId: z.string().trim().min(1).max(64).optional(),
  labelIds: z.array(z.string().trim().min(1).max(64)).max(10).optional(),
  cycleId: z.string().trim().min(1).max(64).optional(),
  acceptStatusId: z.string().trim().min(1).max(64).optional(),
});
const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  position: z.number().int().min(0).max(1000).optional(),
  conditions: z.array(condition).max(10).optional(),
  actions: actions.optional(),
});

async function load(id: string) {
  const rule = await getTriageRule(id);
  if (!rule) return { res: notFound() } as const;
  const a = await projectAccess(rule.projectId);
  if (!a.ok) return { res: a.res } as const;
  if (!a.admin) return { res: trackError(403, 'forbidden') } as const;
  return { rule } as const;
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const l = await load((await props.params).id);
  if ('res' in l) return l.res;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  try {
    return NextResponse.json(await updateTriageRule(l.rule, parsed.data));
  } catch (err) {
    return domainError(err);
  }
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const l = await load((await props.params).id);
  if ('res' in l) return l.res;
  await deleteTriageRule(l.rule.id);
  return NextResponse.json({ ok: true });
}
