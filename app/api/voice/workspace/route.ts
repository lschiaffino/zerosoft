import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { voiceAuth } from '@/lib/voice-route';
import { voiceJsonError } from '@/lib/voice-http';
import { isWorkspaceAdmin, realUserId } from '@/lib/session';
import { getWorkspaceSettings, saveWorkspaceSettings } from '@/lib/voice-library';
import { VOICE_RETENTION_DAYS } from '@/lib/voice-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Ajustes de Voice del workspace (cualquiera los ve: así sabe cuánto duran sus transcripciones). */
export async function GET() {
  const auth = await voiceAuth();
  if (auth.res) return auth.res;
  return NextResponse.json({ settings: await getWorkspaceSettings(auth.owner.workspaceId), canEdit: isWorkspaceAdmin(auth.user) });
}

const schema = z.object({
  retentionDays: z
    .number()
    .int()
    .refine((d) => (VOICE_RETENTION_DAYS as readonly number[]).includes(d))
    .optional(),
});

/** Solo admins: tope de días para las transcripciones de todo el workspace. */
export async function PATCH(req: NextRequest) {
  const auth = await voiceAuth({ bucket: 'write' });
  if (auth.res) return auth.res;
  if (!isWorkspaceAdmin(auth.user)) return voiceJsonError(403, 'forbidden');
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return voiceJsonError(400, 'invalid_input');
  return NextResponse.json({ settings: await saveWorkspaceSettings(auth.owner.workspaceId, realUserId(auth.user), parsed.data), canEdit: true });
}
