import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { domainError, projectAccess } from '@/lib/track-triage-http';
import { getTriageSettings, updateTriageSettings } from '@/lib/track-triage';
import { currentTriageOwner, nextTriageHandoff } from '@/lib/track-triage-shared';
import { invalidBody, trackError } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const hours = z.number().int().min(1).max(24 * 365).nullable();
const mode = z.enum(['show', 'auto', 'off']);
const patchSchema = z.object({
  ownerIds: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
  ownerRotation: z.enum(['daily', 'weekly']).optional(),
  ownerAction: z.enum(['off', 'notify', 'assign']).optional(),
  ownerAnchor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  slaEnabled: z.boolean().optional(),
  slaHours: z.object({ urgent: hours, high: hours, medium: hours, low: hours }).partial().optional(),
  aiModes: z.object({ assignee: mode, labels: mode, priority: mode, duplicate: mode }).partial().optional(),
});

function withOwner(settings: Awaited<ReturnType<typeof getTriageSettings>>) {
  const handoff = nextTriageHandoff(settings);
  return { ...settings, currentOwnerId: currentTriageOwner(settings), nextHandoffAt: handoff ? handoff.toISOString() : null };
}

/** Ajustes de triage del proyecto: responsable de turno, SLAs por prioridad e IA. */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const a = await projectAccess((await props.params).id);
  if (!a.ok) return a.res;
  return NextResponse.json(withOwner(await getTriageSettings(a.project.id)));
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const a = await projectAccess((await props.params).id);
  if (!a.ok) return a.res;
  if (!a.admin) return trackError(403, 'forbidden');
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  try {
    return NextResponse.json(withOwner(await updateTriageSettings(a.project.id, parsed.data)));
  } catch (err) {
    return domainError(err);
  }
}
