import { NextRequest, NextResponse } from 'next/server';
import { respondToCommand } from '@/lib/talk-commands';
import { talkError } from '@/lib/talk-http';
import { jsonError, limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * response_url de un slash command: la app responde más tarde con
 * { text, response_type }. El token (de un solo comando, 30 min, 5 usos) es
 * la credencial; no hay sesión.
 */
export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? '';
  const limited = await limitWrites('talk:command-respond', token.slice(0, 16) || 'none', 30);
  if (limited) return limited;
  const raw = await req.text().catch(() => '');
  if (raw.length > 64_000) return jsonError(413, 'too_large');
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonError(400, 'invalid_input');
  }
  try {
    const res = await respondToCommand(token, body);
    return NextResponse.json({ ok: true, posted: !!res.message, ephemeral: !!res.ephemeral });
  } catch (err) {
    return talkError(err);
  }
}
