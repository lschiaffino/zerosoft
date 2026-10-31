import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { noteOwner } from '@/lib/notes';
import { invalidInput, jsonError, limitWrites } from '@/lib/write-limit';
import { z } from 'zod';
import { resolveNoteAccess } from '@/lib/notes-shares';
import { findFileBlock } from '@/lib/docs-files';
import { fileBlockResponse } from '@/lib/upload-serve';
import { AiError } from '@/lib/ai';
import { readBytesCapped } from '@/lib/notes-clip';
import { providerDiarizes, transcribeAudio, transcriptionConfigured, VoiceTranscribeError } from '@/lib/voice-transcribe';
import type { DocsBlock } from '@/lib/docs-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Lo que acepta el proveedor de transcripción por archivo. */
const MAX_TRANSCRIBE_BYTES = 25 * 1024 * 1024;

type Ctx = { params: Promise<{ id: string }> };

/** Hay con qué transcribir, y si separa hablantes. */
export async function GET() {
  return NextResponse.json({ available: transcriptionConfigured(), speakers: providerDiarizes() });
}

/** Transcribe un bloque de audio de la nota. El texto lo inserta el editor, que es dueño del contenido. */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const owner = noteOwner(user);
  const limited = await limitWrites('notes:write', owner.personId);
  if (limited) return limited;
  const parsed = z.object({ block_id: z.string().min(1).max(64) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidInput(parsed.error);
  const access = await resolveNoteAccess(owner, id);
  if (!access || access.access === 'view') return jsonError(404, 'not_found');
  if (access.row.locked != null) return jsonError(423, 'note_locked');
  if (!transcriptionConfigured()) return jsonError(503, 'transcribe_disabled');
  const blocks = JSON.parse(access.row.content || '[]') as DocsBlock[];
  const block = findFileBlock(blocks, parsed.data.block_id);
  if (!block || block.type !== 'audio') return jsonError(404, 'not_found');
  if ((block.size ?? 0) > MAX_TRANSCRIBE_BYTES) return jsonError(413, 'audio_too_large');
  const file = await fileBlockResponse(block, { download: true }).catch(() => null);
  if (!file?.ok) return jsonError(404, 'not_found');
  const audio = await readBytesCapped(file, MAX_TRANSCRIBE_BYTES);
  if (!audio) return jsonError(413, 'audio_too_large');
  try {
    const res = await transcribeAudio({
      workspaceId: owner.workspaceId,
      audio: new Uint8Array(audio),
      mimeType: (block.mime || 'audio/webm').split(';')[0],
      fakeSpeakers: true,
    });
    return NextResponse.json({ text: res.text, pieces: res.pieces.map((p) => ({ text: p.text, speaker: p.speaker, startMs: p.startMs })) });
  } catch (err) {
    if (err instanceof AiError) return jsonError(err.code === 'ai_disabled' ? 503 : 429, err.code);
    if (err instanceof VoiceTranscribeError) return jsonError(err.code === 'audio_too_large' ? 413 : err.code === 'transcribe_disabled' ? 503 : 502, err.code);
    throw err;
  }
}
