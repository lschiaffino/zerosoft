/**
 * Voice: sesión de las rutas /api/voice/* (persona logueada y su workspace).
 * Server-only.
 */
import type { NextResponse } from 'next/server';
import { getCurrentUser, type SessionUser } from './session';
import { limitWrites } from './write-limit';
import { voiceOwner, type VoiceOwner } from './voice';
import { voiceJsonError } from './voice-http';

export type VoiceRouteAuth = { user: SessionUser; owner: VoiceOwner; res?: undefined } | { res: NextResponse };

/** Usuario + dueño de Voice; con `write`, además el rate limit de escrituras. */
export async function voiceAuth(write?: { bucket: string; limit?: number }): Promise<VoiceRouteAuth> {
  const user = await getCurrentUser();
  if (!user) return { res: voiceJsonError(401, 'unauthorized') };
  const owner = voiceOwner(user);
  if (write) {
    const limited = await limitWrites(`voice:${write.bucket}`, owner.personId, write.limit ?? 120);
    if (limited) return { res: limited };
  }
  return { user, owner };
}

export async function readBody(req: Request): Promise<Record<string, unknown>> {
  const v = (await req.json().catch(() => null)) as unknown;
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
