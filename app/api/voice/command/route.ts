import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { voiceAuth } from '@/lib/voice-route';
import { builtinPrompts, fakeTextFromRequest, readAudio, voiceErrorResponse, voiceJsonError } from '@/lib/voice-http';
import { getVoiceSettings, listDictionary } from '@/lib/voice';
import { transcribeAudio } from '@/lib/voice-transcribe';
import { applyDictionary } from '@/lib/voice-cleanup';
import { runCommand } from '@/lib/voice-prep';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_TEXT = 20_000;

const jsonSchema = z.object({
  text: z.string().min(1).max(MAX_TEXT),
  transformId: z.string().max(80).optional(),
  instruction: z.string().max(2000).optional(),
  locale: z.string().max(5).optional(),
});

/**
 * Reescribir el texto seleccionado (Command Mode y transforms de Wispr Flow).
 * - multipart: audio + text (la selección) + locale. Lo dicho es la
 *   instrucción ("hacelo más corto"); hace falta Command Mode prendido.
 * - JSON: { text, transformId } (un transform guardado o de fábrica) o
 *   { text, instruction }.
 * No queda en el historial de dictados. Devuelve { text, instruction, transform }.
 */
export async function POST(req: NextRequest) {
  const auth = await voiceAuth({ bucket: 'ai', limit: 30 });
  if (auth.res) return auth.res;
  try {
    const isForm = (req.headers.get('content-type') ?? '').includes('multipart/form-data');
    if (isForm) {
      const { bytes, type, fields } = await readAudio(req);
      const text = String(fields.get('text') ?? '').slice(0, MAX_TEXT);
      const locale = String(fields.get('locale') ?? 'en');
      if (!text.trim()) return voiceJsonError(400, 'invalid_input');
      const [settings, dictionary] = await Promise.all([getVoiceSettings(auth.owner), listDictionary(auth.owner)]);
      if (!settings.commandMode) return voiceJsonError(400, 'command_off');
      const tr = await transcribeAudio({
        workspaceId: auth.owner.workspaceId,
        audio: bytes,
        mimeType: type,
        language: settings.language,
        vocabulary: [],
        durationHintMs: Number(fields.get('durationMs')) || 0,
        fakeText: await fakeTextFromRequest(),
      });
      const instruction = applyDictionary(tr.text.trim(), dictionary.filter((d) => d.kind === 'replace'));
      if (!instruction) return voiceJsonError(400, 'nothing_heard');
      return NextResponse.json(await runCommand({ owner: auth.owner, text, instruction, locale, builtin: builtinPrompts(locale, 'transform') }));
    }
    const parsed = jsonSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success || (!parsed.data.transformId && !parsed.data.instruction?.trim())) return voiceJsonError(400, 'invalid_input');
    const locale = parsed.data.locale ?? 'en';
    return NextResponse.json(
      await runCommand({
        owner: auth.owner,
        text: parsed.data.text,
        instruction: parsed.data.instruction,
        transformId: parsed.data.transformId,
        locale,
        builtin: builtinPrompts(locale, 'transform'),
      }),
    );
  } catch (err) {
    return voiceErrorResponse(err);
  }
}
