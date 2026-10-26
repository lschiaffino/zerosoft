import { NextRequest, NextResponse } from 'next/server';
import { domainError, issueAccess } from '@/lib/track-triage-http';
import { summarizeIssue } from '@/lib/track-ai';
import { reqLocale } from '@/lib/track-triage-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Resumen con IA del issue y su discusión. */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const a = await issueAccess((await props.params).id);
  if (!a.ok) return a.res;
  try {
    return NextResponse.json(await summarizeIssue(a.issue.id, reqLocale(req)));
  } catch (err) {
    return domainError(err);
  }
}
