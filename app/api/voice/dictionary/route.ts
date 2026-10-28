import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { voiceAuth } from '@/lib/voice-route';
import { voiceErrorResponse, voiceJsonError } from '@/lib/voice-http';
import { addDictionaryEntry, listDictionary } from '@/lib/voice';
import { isWorkspaceAdmin } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** El diccionario propio más el del equipo (shared: true; lo administran los admins). */
export async function GET() {
  const auth = await voiceAuth();
  if (auth.res) return auth.res;
  return NextResponse.json({ entries: await listDictionary(auth.owner), canEditTeam: isWorkspaceAdmin(auth.user) });
}

const schema = z.object({
  kind: z.enum(['word', 'replace', 'snippet']),
  phrase: z.string().trim().min(1).max(100),
  replacement: z.string().max(2000).optional(),
  /** Del equipo: la usa todo el workspace. Solo admins. */
  shared: z.boolean().optional(),
});

/** Palabra (cómo se escribe), reemplazo (lo que se oye → lo que se escribe) o snippet (frase → texto guardado). */
export async function POST(req: NextRequest) {
  const auth = await voiceAuth({ bucket: 'write' });
  if (auth.res) return auth.res;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return voiceJsonError(400, 'invalid_input');
  if (parsed.data.kind !== 'word' && !parsed.data.replacement?.trim()) return voiceJsonError(400, 'invalid_input');
  if (parsed.data.shared && !isWorkspaceAdmin(auth.user)) return voiceJsonError(403, 'forbidden');
  try {
    return NextResponse.json(await addDictionaryEntry(auth.owner, parsed.data), { status: 201 });
  } catch (err) {
    return voiceErrorResponse(err);
  }
}
