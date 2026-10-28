import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { snapshotPage } from '@/lib/robots';
import { AiError, assertRobotsAi, stepsFromDescription } from '@/lib/robots-ai';
import { aiErrorCode, canEditRobots, forbidden, robotError, unauthorized } from '@/lib/robots-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const body = z.object({
  description: z.string().trim().min(1).max(3000),
  url: z.string().trim().max(2000).optional().default(''),
  inputs: z.array(z.string().max(40)).max(20).optional().default([]),
});

/** "Escribir con IA": tarea en lenguaje natural → pasos (con la página leída si viene una URL). No guarda nada. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditRobots(user)) return forbidden();
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return robotError(400, 'invalid_input');
  try {
    await assertRobotsAi(user.id);
  } catch (err) {
    if (err instanceof AiError) return robotError(err.code === 'ai_disabled' ? 503 : 429, aiErrorCode(err.code));
    throw err;
  }
  let snapshot = null;
  const url = parsed.data.url && !parsed.data.url.includes('{{') ? (/^https?:\/\//i.test(parsed.data.url) ? parsed.data.url : `https://${parsed.data.url}`) : '';
  if (url) {
    const snap = await snapshotPage(user.id, url);
    if (!snap.ok && (snap.error === 'private_host' || snap.error === 'invalid_url')) return robotError(400, snap.error);
    // Sin poder leer la página igual se escriben los pasos (con selectores por texto).
    if (snap.ok) snapshot = snap.snapshot;
  }
  try {
    const steps = await stepsFromDescription(user.id, parsed.data.description, snapshot, parsed.data.inputs);
    return NextResponse.json({ steps });
  } catch (err) {
    if (err instanceof AiError) return robotError(err.code === 'ai_disabled' ? 503 : 429, aiErrorCode(err.code));
    return robotError(502, 'generic');
  }
}
