import { NextRequest, NextResponse } from 'next/server';
import { del, get } from '@vercel/blob';
import { voiceAuth } from '@/lib/voice-route';
import { readAudio, voiceErrorResponse, voiceJsonError } from '@/lib/voice-http';
import { ingestChunk } from '@/lib/voice-service';
import { getDb } from '@/lib/db';
import { getSessionRow, queueNotes, updateSession } from '@/lib/voice';
import { queueNoteAfterResponse } from '@/lib/voice-jobs';
import { transcribeProvider, VoiceTranscribeError } from '@/lib/voice-transcribe';
import { isVoiceAudioType } from '@/lib/voice-types';
import { isVoiceBlobUrl, voiceBlobAccess, voiceBlobEnabled, voiceImportMaxBytes } from '@/lib/voice-blob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;


/**
 * Transcribe una grabación entera (importar un archivo). Body JSON { url } de
 * una subida directa a Vercel Blob (/api/voice/upload), o multipart con el
 * campo "audio" sin Blob (self-host). El archivo de Blob se borra después.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await voiceAuth({ bucket: 'file', limit: 10 });
  if (auth.res) return auth.res;
  const row = await getSessionRow(auth.owner, id);
  if (!row || row.kind !== 'meeting') return voiceJsonError(404, 'not_found');
  const max = voiceImportMaxBytes(transcribeProvider(), voiceBlobEnabled());
  let blobUrl: string | null = null;
  try {
    let bytes: Uint8Array;
    let type: string;
    if ((req.headers.get('content-type') ?? '').includes('application/json')) {
      const body = (await req.json().catch(() => null)) as { url?: unknown } | null;
      const url = typeof body?.url === 'string' ? body.url : '';
      if (!isVoiceBlobUrl(url, auth.owner.personId)) return voiceJsonError(400, 'invalid_input');
      blobUrl = url;
      // Por el SDK de Blob (sin seguir redirecciones a otro lado; los privados van con el token).
      const blob = await get(url, { access: voiceBlobAccess() }).catch(() => null);
      if (!blob || blob.statusCode !== 200 || !blob.stream) return voiceJsonError(400, 'invalid_input');
      if ((blob.blob.size ?? 0) > max) throw new VoiceTranscribeError('audio_too_large');
      type = blob.blob.contentType || 'audio/webm';
      if (!isVoiceAudioType(type)) throw new VoiceTranscribeError('audio_type');
      const res = new Response(blob.stream);
      bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength > max) throw new VoiceTranscribeError('audio_too_large');
    } else {
      const upload = await readAudio(req, Math.min(max, 25 * 1024 * 1024));
      bytes = upload.bytes;
      type = upload.type;
    }
    await updateSession(auth.owner, id, { status: 'processing' });
    await getDb().prepare("UPDATE voice_sessions SET capture = 'file' WHERE id = ?").run(id);
    // Un archivo nuevo reemplaza la transcripción anterior.
    await getDb().prepare('DELETE FROM voice_segments WHERE session_id = ?').run(id);
    await getDb().prepare('DELETE FROM voice_chunks WHERE session_id = ?').run(id);
    const res = await ingestChunk({ owner: auth.owner, sessionId: id, source: 'mixed', seq: 0, offsetMs: 0, durationMs: 0, audio: bytes, type });
    await updateSession(auth.owner, id, { status: 'done' });
    // La nota con IA se arma sola al terminar de transcribir.
    if (await queueNotes(id)) await queueNoteAfterResponse(id);
    return NextResponse.json(res, { status: 201 });
  } catch (err) {
    await updateSession(auth.owner, id, { status: 'done' }).catch(() => {});
    return voiceErrorResponse(err);
  } finally {
    if (blobUrl && process.env.BLOB_READ_WRITE_TOKEN) await del(blobUrl).catch(() => {});
  }
}
