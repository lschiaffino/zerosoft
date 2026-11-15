import { NextRequest } from 'next/server';
import { fJson, limit } from '@/lib/fleet/api';
import { ingestEvent, ownerOfToken } from '@/lib/fleet/sessions';
import { normalizeHookPayload } from '@/lib/fleet/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST: un evento del hook de Claude Code (Authorization: Bearer zsf_…). Responde { ok, output }: `output` es lo que
 * el hook imprime (en Stop, {"decision":"block","reason":…} si dejaste una respuesta en cola).
 */
export async function POST(req: NextRequest) {
  const owner = await ownerOfToken(req.headers.get('authorization'));
  if (!owner) return fJson({ error: 'unauthorized' }, 401);
  const limited = await limit(`ingest:${owner.tokenId}`, 240, 60);
  if (limited) return limited;
  const raw = await req.text().catch(() => '');
  if (raw.length > 256 * 1024) return fJson({ error: 'too_large' }, 413);
  let json: unknown = null;
  try {
    json = JSON.parse(raw);
  } catch {
    return fJson({ error: 'invalid_input' }, 400);
  }
  const ev = normalizeHookPayload(json);
  if (!ev) return fJson({ error: 'invalid_input' }, 400);
  const res = await ingestEvent(owner, ev);
  return fJson({ ok: true, session: res.sessionId, status: res.status, delivered: res.delivered, output: res.output });
}
