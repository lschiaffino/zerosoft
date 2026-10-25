import { NextRequest, NextResponse } from 'next/server';
import { domainError, issueAccess } from '@/lib/track-triage-http';
import { generateTriageSuggestions, getTriageSuggestions } from '@/lib/track-ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const a = await issueAccess((await props.params).id);
  if (!a.ok) return a.res;
  return NextResponse.json(await getTriageSuggestions(a.issue.id));
}

/** Pide (o vuelve a pedir) sugerencias de triage con IA: asignado, labels, prioridad, duplicados. */
export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const a = await issueAccess((await props.params).id);
  if (!a.ok) return a.res;
  try {
    const suggestions = await generateTriageSuggestions(a.issue.id, { autoApply: a.issue.triage === 1, actorId: a.actorId });
    return NextResponse.json({ suggestions });
  } catch (err) {
    return domainError(err);
  }
}
