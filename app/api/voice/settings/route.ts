import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { voiceAuth } from '@/lib/voice-route';
import { voiceJsonError } from '@/lib/voice-http';
import { getVoiceSettings, saveVoiceSettings } from '@/lib/voice';
import { transcriptionConfigured } from '@/lib/voice-transcribe';
import { voiceAiAvailable } from '@/lib/voice-ai';
import { VOICE_CONTEXTS, VOICE_REMINDER_MINUTES, VOICE_RETENTION_DAYS, VOICE_SHORTCUTS, VOICE_TONES } from '@/lib/voice-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Ajustes de dictado de la persona + si hay con qué transcribir y limpiar. */
export async function GET() {
  const auth = await voiceAuth();
  if (auth.res) return auth.res;
  return NextResponse.json({
    settings: await getVoiceSettings(auth.owner),
    transcription: transcriptionConfigured(),
    ai: await voiceAiAvailable(),
  });
}

const tone = z.enum(VOICE_TONES);
const schema = z.object({
  styles: z.object(Object.fromEntries(VOICE_CONTEXTS.map((c) => [c, tone.optional()])) as Record<(typeof VOICE_CONTEXTS)[number], z.ZodOptional<typeof tone>>).optional(),
  language: z.string().regex(/^(auto|[a-z]{2})$/).optional(),
  shortcut: z.enum(VOICE_SHORTCUTS).optional(),
  showBar: z.boolean().optional(),
  aiCleanup: z.boolean().optional(),
  commandMode: z.boolean().optional(),
  learnCorrections: z.boolean().optional(),
  reminders: z.boolean().optional(),
  reminderMinutes: z
    .number()
    .int()
    .refine((n) => (VOICE_REMINDER_MINUTES as readonly number[]).includes(n))
    .optional(),
  retentionDays: z
    .number()
    .int()
    .refine((n) => (VOICE_RETENTION_DAYS as readonly number[]).includes(n))
    .optional(),
});

export async function PATCH(req: NextRequest) {
  const auth = await voiceAuth({ bucket: 'write' });
  if (auth.res) return auth.res;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return voiceJsonError(400, 'invalid_input');
  const { styles, ...rest } = parsed.data;
  const clean = Object.fromEntries(Object.entries(styles ?? {}).filter(([, v]) => v)) as Record<string, (typeof VOICE_TONES)[number]>;
  return NextResponse.json({ settings: await saveVoiceSettings(auth.owner, { ...rest, ...(styles ? { styles: clean as never } : {}) }) });
}
