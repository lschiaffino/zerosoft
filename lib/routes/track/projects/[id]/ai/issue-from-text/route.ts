import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { domainError, projectAccess } from '@/lib/track-triage-http';
import { issueFromText } from '@/lib/track-ai';
import { reqLocale } from '@/lib/track-triage-http';
import { invalidBody } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ text: z.string().trim().min(3).max(6000) });

/** Borrador de issue (título, descripción, prioridad, labels) desde texto libre. */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const a = await projectAccess((await props.params).id);
  if (!a.ok) return a.res;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  try {
    return NextResponse.json(await issueFromText(a.project.id, parsed.data.text, reqLocale(req)));
  } catch (err) {
    return domainError(err);
  }
}
