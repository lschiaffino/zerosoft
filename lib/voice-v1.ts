/**
 * Voice: auth de la API v1 (la usa la app de escritorio con una key de
 * scope voice:read / voice:write). La key actúa como la persona que la creó.
 * Server-only.
 */
import type { NextResponse } from 'next/server';
import { requireApiUser } from './api-auth';
import type { VoiceOwner } from './voice';

export async function voiceApiAuth(
  req: Request,
  scope: 'voice:read' | 'voice:write',
): Promise<{ owner: VoiceOwner; res?: undefined } | { res: NextResponse }> {
  const auth = await requireApiUser(req, scope);
  if ('res' in auth) return { res: auth.res };
  return { owner: { workspaceId: auth.user.id, personId: auth.personId } };
}

/** Errores de Voice con la forma de la API v1: { error: { code, message } }. */
export function v1Body(code: string): { error: { code: string; message: string } } {
  const MESSAGES: Record<string, string> = {
    not_found: 'Session not found.',
    invalid_input: 'Invalid input.',
    ai_disabled: 'AI is not configured on this server.',
    quota_exceeded: 'The monthly AI quota of this workspace is used up.',
    rate_limited: 'Rate limit exceeded.',
    transcribe_disabled: 'No transcription provider is configured.',
    transcribe_failed: 'The transcription provider failed.',
    audio_too_large: 'The audio is too large.',
    audio_type: 'Unsupported audio type.',
    empty_audio: 'Missing audio.',
  };
  return { error: { code, message: MESSAGES[code] ?? 'Request failed.' } };
}

/** Error de una ruta v1 de Voice → respuesta { error: { code, message } } con el mismo status. */
export async function v1ErrorResponse(err: unknown): Promise<NextResponse> {
  const { NextResponse: Res } = await import('next/server');
  const { voiceErrorResponse } = await import('./voice-http');
  const r = voiceErrorResponse(err);
  const body = (await r.json().catch(() => ({}))) as { error?: string };
  return Res.json(v1Body(body.error ?? 'server_error'), { status: r.status });
}

export async function v1Error(status: number, code: string): Promise<NextResponse> {
  const { NextResponse: Res } = await import('next/server');
  return Res.json(v1Body(code), { status });
}
