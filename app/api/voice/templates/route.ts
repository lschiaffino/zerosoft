import { NextRequest, NextResponse } from 'next/server';
import { voiceTemplateSchema as templateSchema } from '@/lib/voice-schema';
import { voiceAuth } from '@/lib/voice-route';
import { voiceErrorResponse, voiceJsonError } from '@/lib/voice-http';
import { createCustomTemplate, listCustomTemplates } from '@/lib/voice';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await voiceAuth();
  if (auth.res) return auth.res;
  return NextResponse.json({ templates: await listCustomTemplates(auth.owner) });
}

export async function POST(req: NextRequest) {
  const auth = await voiceAuth({ bucket: 'write' });
  if (auth.res) return auth.res;
  const parsed = templateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return voiceJsonError(400, 'invalid_input');
  try {
    return NextResponse.json(await createCustomTemplate(auth.owner, parsed.data), { status: 201 });
  } catch (err) {
    return voiceErrorResponse(err);
  }
}
