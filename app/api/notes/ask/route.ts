import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { aiEnabled } from '@/lib/ai';
import { askNotes, noteOwner } from '@/lib/notes';
import { noteAskSchema } from '@/lib/notes-schema';
import { invalidInput, jsonError, limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** ¿Está la AI configurada? (el panel se oculta si no). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  return NextResponse.json({ enabled: aiEnabled() });
}

/** "Preguntale a tus notas": recuperación por palabras clave + respuesta citando títulos. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const owner = noteOwner(user);
  const limited = await limitWrites('notes:ask', owner.personId, 20);
  if (limited) return limited;
  const parsed = noteAskSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidInput(parsed.error);
  const res = await askNotes(owner, parsed.data.question);
  if (res.ok) return NextResponse.json({ answer: res.answer, sources: res.sources });
  const status =
    res.code === 'ai_disabled' ? 503 : res.code === 'rate_limited' || res.code === 'quota_exceeded' ? 429 : res.code === 'no_matches' ? 200 : 502;
  return NextResponse.json({ error: res.code, answer: null, sources: [] }, { status });
}
