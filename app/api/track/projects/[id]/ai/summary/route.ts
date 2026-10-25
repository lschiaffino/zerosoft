import { NextRequest, NextResponse } from 'next/server';
import { domainError, projectAccess } from '@/lib/track-triage-http';
import { summarizeProject } from '@/lib/track-ai';
import { reqLocale } from '@/lib/track-triage-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Borrador con IA del update del proyecto (últimos N días). */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const a = await projectAccess((await props.params).id);
  if (!a.ok) return a.res;
  const body = (await req.json().catch(() => ({}))) as { days?: unknown };
  const days = typeof body.days === 'number' && body.days >= 1 && body.days <= 90 ? Math.round(body.days) : 14;
  try {
    return NextResponse.json({ summary: await summarizeProject(a.project.id, reqLocale(req), days) });
  } catch (err) {
    return domainError(err);
  }
}
