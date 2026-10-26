import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { domainError, projectAccess } from '@/lib/track-triage-http';
import { createTriageRule, listTriageRules } from '@/lib/track-triage';
import { invalidBody, trackError } from '@/lib/track-http';

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
const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean().optional(),
  conditions: z.array(condition).max(10).default([]),
  actions,
});

/** Reglas de triage del proyecto, en el orden en que corren. */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const a = await projectAccess((await props.params).id);
  if (!a.ok) return a.res;
  return NextResponse.json({ rows: await listTriageRules(a.project.id) });
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const a = await projectAccess((await props.params).id);
  if (!a.ok) return a.res;
  if (!a.admin) return trackError(403, 'forbidden');
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  try {
    return NextResponse.json(await createTriageRule(a.project.id, parsed.data, a.actorId), { status: 201 });
  } catch (err) {
    return domainError(err);
  }
}
