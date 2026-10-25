import { NextRequest, NextResponse } from 'next/server';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { getCurrentUser } from '@/lib/session';
import { voiceOwner } from '@/lib/voice';
import { voiceBlobEnabled, voiceBlobPrefix } from '@/lib/voice-blob';
import { VOICE_AUDIO_TYPES, VOICE_FILE_MAX_BYTES } from '@/lib/voice-types';
import { limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Token de subida directa a Vercel Blob para una grabación (el archivo no
 * pasa por la función, que corta en 4.5 MB). Solo audio/video, hasta
 * VOICE_FILE_MAX_BYTES, dentro de voice/<persona>/.
 */
export async function POST(req: NextRequest) {
  if (!voiceBlobEnabled()) return NextResponse.json({ error: 'storage_unavailable' }, { status: 503 });
  const body = (await req.json().catch(() => null)) as HandleUploadBody | null;
  if (!body) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        const user = await getCurrentUser();
        if (!user) throw new Error('unauthorized');
        const owner = voiceOwner(user);
        const limited = await limitWrites('voice:upload', owner.personId, 10);
        if (limited) throw new Error('rate_limited');
        if (!pathname.startsWith(voiceBlobPrefix(owner.personId))) throw new Error('invalid_path');
        return {
          allowedContentTypes: [...VOICE_AUDIO_TYPES],
          maximumSizeInBytes: VOICE_FILE_MAX_BYTES,
          addRandomSuffix: true,
        };
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    const code = err instanceof Error && ['unauthorized', 'rate_limited', 'invalid_path'].includes(err.message) ? err.message : 'upload_failed';
    return NextResponse.json({ error: code }, { status: code === 'unauthorized' ? 401 : code === 'rate_limited' ? 429 : 400 });
  }
}
