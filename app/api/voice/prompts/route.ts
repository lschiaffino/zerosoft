import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { voiceAuth } from '@/lib/voice-route';
import { voiceErrorResponse, voiceJsonError } from '@/lib/voice-http';
import { createPrompt, listPrompts } from '@/lib/voice-library';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Recipes (?kind=recipe) o transforms (?kind=transform): propios y los que el equipo compartió. */
export async function GET(req: NextRequest) {
  const auth = await voiceAuth();
  if (auth.res) return auth.res;
  const kind = new URL(req.url).searchParams.get('kind') === 'transform' ? 'transform' : 'recipe';
  return NextResponse.json({ prompts: await listPrompts(auth.owner, kind) });
}

const schema = z.object({
  kind: z.enum(['recipe', 'transform']),
  name: z.string().trim().min(1).max(80),
  prompt: z.string().trim().min(1).max(4000),
  shared: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const auth = await voiceAuth({ bucket: 'write' });
  if (auth.res) return auth.res;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return voiceJsonError(400, 'invalid_input');
  try {
    return NextResponse.json(await createPrompt(auth.owner, parsed.data), { status: 201 });
  } catch (err) {
    return voiceErrorResponse(err);
  }
}
